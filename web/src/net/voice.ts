import { create } from 'zustand';
import type { ICEServer, VoicePeer } from './protocol';

/**
 * Voice chat: browser to browser (WebRTC), set up through the room's
 * websocket. The server decides who is linked to whom (see game/voice.go) and
 * sends a roster; this calls each peer on it, sends our microphone to those we
 * may speak to and plays those we may hear.
 *
 * Every call carries one two-way audio channel, set up once. Who may speak
 * changes (spectators muted, a seat taken) only swap the track on it, so the
 * call never has to be set up again. Of each pair, the connection with the
 * lower id places the call; the other answers.
 */

export type PeerState = {
  cid: number;
  name: string;
  seat: number;
  spectator: boolean;
  /** We may hear them / they may hear us (the room's rules). */
  hear: boolean;
  speak: boolean;
  /** Muted by us, on this device only. */
  muted: boolean;
  speaking: boolean;
  connected: boolean;
};

type VoiceStore = {
  on: boolean;
  joining: boolean;
  /** Our microphone is muted. */
  micMuted: boolean;
  /** We are making sound (the mic is picking us up). */
  speaking: boolean;
  error: string;
  peers: Record<number, PeerState>;
};

export const useVoiceStore = create<VoiceStore>(() => ({ on: false, joining: false, micMuted: false, speaking: false, error: '', peers: {} }));

type Signal = { gen: number; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; };

type Call = {
  pc: RTCPeerConnection;
  /** Which attempt this is: a failed call is placed again with the next. */
  gen: number;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  failTimer?: ReturnType<typeof setTimeout>;
};

// How loud counts as talking (WebRTC audio level, 0..1), and how often it is checked.
const SPEAKING_LEVEL = 0.03;
const LEVEL_EVERY_MS = 200;
// A call that stays broken this long is placed again.
const RETRY_MS = 4000;

class Voice {
  private sendRaw: (message: object) => void = () => { };
  private mic: MediaStream | null = null;
  private myCid = 0;
  private ice: RTCIceServer[] = [];
  private calls = new Map<number, Call>();
  private roster = new Map<number, VoicePeer>();
  private levels: ReturnType<typeof setInterval> | null = null;
  private meter: { ctx: AudioContext; analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer>; } | null = null;

  /** How messages reach the server (the session's websocket). */
  setSender(send: (message: object) => void) { this.sendRaw = send; }

  /** Asks for the microphone and joins the room's voice chat. Call from a tap: browsers want one for both. */
  async join() {
    const store = useVoiceStore.getState();
    if (store.on || store.joining) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      useVoiceStore.setState({ error: 'Voice chat is not supported in this browser.' });
      return;
    }
    useVoiceStore.setState({ joining: true, error: '' });
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      useVoiceStore.setState({ joining: false, error: denied ? 'Microphone access was refused. Allow it in your browser settings to talk.' : 'No microphone could be opened.' });
      return;
    }
    this.mic.getAudioTracks().forEach((t) => { t.enabled = !useVoiceStore.getState().micMuted; });
    this.startMeter();
    useVoiceStore.setState({ on: true, joining: false });
    this.sendRaw({ t: 'voice', on: true });
    this.levels = setInterval(() => this.readLevels(), LEVEL_EVERY_MS);
  }

  /** Hangs up on everyone and lets go of the microphone. */
  leave(tellServer = true) {
    if (tellServer && useVoiceStore.getState().on) this.sendRaw({ t: 'voice', on: false });
    for (const cid of [...this.calls.keys()]) this.hangUp(cid);
    this.roster.clear();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    if (this.levels) clearInterval(this.levels);
    this.levels = null;
    void this.meter?.ctx.close().catch(() => { });
    this.meter = null;
    useVoiceStore.setState({ on: false, joining: false, speaking: false, peers: {} });
  }

  /** A new connection to the room (a reconnect): it starts out of voice, so ask again. */
  rejoin() {
    if (!useVoiceStore.getState().on) return;
    for (const cid of [...this.calls.keys()]) this.hangUp(cid);
    this.roster.clear();
    useVoiceStore.setState({ peers: {} });
    this.sendRaw({ t: 'voice', on: true });
  }

  setMicMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    useVoiceStore.setState({ micMuted: muted, ...(muted ? { speaking: false } : {}) });
  }

  setPeerMuted(cid: number, muted: boolean) {
    const call = this.calls.get(cid);
    const peer = useVoiceStore.getState().peers[cid];
    if (!peer) return;
    if (call) call.audio.muted = muted || !peer.hear;
    this.patchPeer(cid, { muted });
  }

  /** The server's list of whom we are linked to (see Room.sendVoiceRosters). */
  onRoster(myCid: number, peers: VoicePeer[], ice?: ICEServer[]) {
    if (!useVoiceStore.getState().on) return;
    this.myCid = myCid;
    if (ice) this.ice = ice;
    const next = new Map(peers.map((p) => [p.cid, p]));
    for (const cid of [...this.calls.keys()]) if (!next.has(cid)) this.hangUp(cid);
    this.roster = next;
    const old = useVoiceStore.getState().peers;
    const states: Record<number, PeerState> = {};
    for (const p of peers) {
      states[p.cid] = {
        cid: p.cid, name: p.name, seat: p.seat, spectator: !!p.spectator, hear: p.hear, speak: p.speak,
        muted: old[p.cid]?.muted ?? false, speaking: old[p.cid]?.speaking ?? false, connected: old[p.cid]?.connected ?? false,
      };
    }
    useVoiceStore.setState({ peers: states });
    for (const p of peers) {
      const call = this.calls.get(p.cid);
      if (call) this.applyRules(p.cid, call);
      else if (this.places(p.cid)) void this.call(p.cid, 1);
    }
  }

  /** A call setup message from a peer, relayed by the server. */
  async onSignal(from: number, signal: Signal) {
    if (!useVoiceStore.getState().on || !this.roster.has(from) || !signal) return;
    let call = this.calls.get(from);
    try {
      if (signal.sdp) {
        if (signal.sdp.type === 'offer') {
          // A new attempt from the caller replaces our side of the old one.
          if (call && call.gen !== signal.gen) { this.hangUp(from, false); call = undefined; }
          call ??= this.open(from, signal.gen);
          await call.pc.setRemoteDescription(signal.sdp);
          const transceiver = call.pc.getTransceivers()[0];
          if (transceiver) transceiver.direction = 'sendrecv';
          this.applyRules(from, call);
          await call.pc.setLocalDescription(await call.pc.createAnswer());
          this.signal(from, { gen: call.gen, sdp: call.pc.localDescription!.toJSON() });
        } else if (call && call.gen === signal.gen) {
          await call.pc.setRemoteDescription(signal.sdp);
        }
        if (call) for (const c of call.pending.splice(0)) await call.pc.addIceCandidate(c).catch(() => { });
      } else if (signal.candidate && call && call.gen === signal.gen) {
        if (call.pc.remoteDescription) await call.pc.addIceCandidate(signal.candidate).catch(() => { });
        else call.pending.push(signal.candidate);
      }
    } catch (error) {
      console.warn('voice: call setup with', from, 'failed', error);
    }
  }

  // --- calls ---------------------------------------------------------------

  /** We place the call to peers with a higher connection id; they call us otherwise. */
  private places(cid: number) { return this.myCid < cid; }

  private async call(cid: number, gen: number) {
    const call = this.open(cid, gen);
    call.pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.applyRules(cid, call);
    try {
      await call.pc.setLocalDescription(await call.pc.createOffer());
      this.signal(cid, { gen, sdp: call.pc.localDescription!.toJSON() });
    } catch (error) {
      console.warn('voice: could not call', cid, error);
    }
  }

  private open(cid: number, gen: number): Call {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const audio = new Audio();
    audio.autoplay = true;
    const call: Call = { pc, gen, audio, pending: [] };
    this.calls.set(cid, call);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(cid, { gen, candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => { });
    };
    pc.onconnectionstatechange = () => {
      if (this.calls.get(cid) !== call) return;
      const state = pc.connectionState;
      this.patchPeer(cid, { connected: state === 'connected' });
      if (call.failTimer) clearTimeout(call.failTimer);
      call.failTimer = undefined;
      // Broken (a network change, say): the caller places the call again.
      if ((state === 'failed' || state === 'disconnected') && this.places(cid)) {
        call.failTimer = setTimeout(() => {
          if (this.calls.get(cid) !== call || !this.roster.has(cid)) return;
          this.hangUp(cid, false);
          void this.call(cid, gen + 1);
        }, state === 'failed' ? 0 : RETRY_MS);
      }
    };
    return call;
  }

  /** Sends our microphone only to those who may hear us, and plays only those we may hear. */
  private applyRules(cid: number, call: Call) {
    const peer = this.roster.get(cid);
    const state = useVoiceStore.getState().peers[cid];
    const sender = call.pc.getTransceivers()[0]?.sender;
    const track = peer?.speak ? this.mic?.getAudioTracks()[0] ?? null : null;
    if (sender && sender.track !== track) void sender.replaceTrack(track).catch(() => { });
    call.audio.muted = !peer?.hear || !!state?.muted;
  }

  private hangUp(cid: number, forget = true) {
    const call = this.calls.get(cid);
    if (!call) return;
    if (call.failTimer) clearTimeout(call.failTimer);
    call.pc.onicecandidate = call.pc.ontrack = call.pc.onconnectionstatechange = null;
    call.pc.close();
    call.audio.srcObject = null;
    this.calls.delete(cid);
    if (forget) this.patchPeer(cid, { connected: false, speaking: false });
  }

  private signal(to: number, data: Signal) { this.sendRaw({ t: 'rtc', to, data }); }

  private patchPeer(cid: number, patch: Partial<PeerState>) {
    useVoiceStore.setState((s) => (s.peers[cid] ? { peers: { ...s.peers, [cid]: { ...s.peers[cid], ...patch } } } : s));
  }

  // --- who is talking -------------------------------------------------------

  private startMeter() {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(this.mic!).connect(analyser);
      this.meter = { ctx, analyser, buffer: new Float32Array(analyser.fftSize) };
    } catch {
      this.meter = null; // no indicator for ourselves, voice still works
    }
  }

  private readLevels() {
    const store = useVoiceStore.getState();
    if (this.meter && !store.micMuted) {
      this.meter.analyser.getFloatTimeDomainData(this.meter.buffer);
      let sum = 0;
      for (const v of this.meter.buffer) sum += v * v;
      const speaking = Math.sqrt(sum / this.meter.buffer.length) > SPEAKING_LEVEL / 2;
      if (speaking !== store.speaking) useVoiceStore.setState({ speaking });
    }
    for (const [cid, call] of this.calls) {
      const receiver = call.pc.getReceivers()[0];
      const level = receiver?.getSynchronizationSources?.()[0]?.audioLevel ?? 0;
      const peer = useVoiceStore.getState().peers[cid];
      const speaking = !!peer?.hear && level > SPEAKING_LEVEL;
      if (peer && peer.speaking !== speaking) this.patchPeer(cid, { speaking });
    }
  }
}

export const voice = new Voice();
