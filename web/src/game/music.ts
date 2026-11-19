/*
 * Duel music, played through Web Audio so a track is seamless: an intro hands
 * over to its loop, and the loop goes round, to the exact sample, with no gap.
 *
 * An <audio> element cannot do that: the loop only starts loading once the
 * intro has ended, and an element's own looping leaves a gap on MP3. Here both
 * clips are decoded ahead, the loop is scheduled to start on the very sample
 * the intro ends on, and it repeats sample-accurately (loopStart / loopEnd).
 *
 * The clips are also trimmed of the digital silence at their edges (exported
 * with the file, or encoder padding a browser leaves in), which would
 * otherwise play as a pause at each join. Only true silence is cut: anything
 * from quiet music up is kept.
 */

/**
 * Track files, as paths under the asset server (see useGameAudio). With loop
 * points (seconds into `loop`), the file plays from its start and then repeats
 * loopStart..loopEnd: one file, so neither join is at a file's edge.
 */
export interface MusicFiles { intro?: string; loop: string; loopStart?: number; loopEnd?: number; }

/** Below this a sample counts as silence: -80 dBFS. */
const SILENCE = 1e-4;
/**
 * The short fade a clip is often exported with (to avoid a click) is cut too:
 * the quiet stretch at an edge below FADE_LEVEL (-40 dBFS), at most FADE_MAX
 * seconds of it, so real music is never lost. Two such fades back to back
 * leave an audible dip at a join.
 */
const FADE_LEVEL = 0.01;
const FADE_MAX = 0.03;
/** Loudness is judged over windows this long (seconds). */
const WINDOW = 0.002;
/** Scheduled a moment ahead, so the first sample is never late. */
const LEAD = 0.05;

/**
 * Where the sound is in a buffer, in samples: the digital silence at either
 * end left out, and an edge fade trimmed (see FADE_LEVEL), each cut moved to
 * where the wave crosses zero so the join does not click.
 */
export function audibleRange(buffer: AudioBuffer): { start: number; end: number; } {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i: number) => channels.some((data) => Math.abs(data[i]) > SILENCE);
  let start = 0;
  while (start < buffer.length && !loud(start)) start++;
  let end = buffer.length;
  while (end > start && !loud(end - 1)) end--;
  // All silence (or nothing): play it as it is.
  if (end <= start) return { start: 0, end: buffer.length };

  const window = Math.max(1, Math.round(WINDOW * buffer.sampleRate));
  const most = Math.round(FADE_MAX * buffer.sampleRate);
  // The loudest channel's RMS over [from, from + window).
  const level = (from: number) => {
    let peak = 0;
    for (const data of channels) {
      let sum = 0;
      for (let i = from; i < from + window; i++) sum += data[i] * data[i];
      peak = Math.max(peak, Math.sqrt(sum / window));
    }
    return peak;
  };
  let head = start;
  while (head - start < most && head + window < end && level(head) < FADE_LEVEL) head += window;
  let tail = end;
  while (end - tail < most && tail - window > head && level(tail - window) < FADE_LEVEL) tail -= window;

  // An edge that was trimmed is cut where the first channel crosses zero,
  // within a couple of milliseconds. One that was not stays to the sample: a
  // loop cut exactly from a longer recording must keep its exact length.
  const headTrimmed = head > 0;
  const tailTrimmed = tail < buffer.length;
  const wave = channels[0];
  const reach = window;
  const crossing = (at: number, step: 1 | -1) => {
    for (let i = at, n = 0; n < reach && i > 0 && i < buffer.length; i += step, n++) {
      if ((wave[i - 1] <= 0 && wave[i] > 0) || (wave[i - 1] >= 0 && wave[i] < 0)) return i;
    }
    return at;
  };
  return { start: headTrimmed ? crossing(head, 1) : head, end: tailTrimmed ? crossing(tail, -1) : tail };
}

type Ctx = AudioContext;
const AudioCtx: typeof AudioContext | undefined = typeof window !== 'undefined'
  ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext; }).webkitAudioContext
  : undefined;

export class Music {
  private ctx: Ctx | null = null;
  private gain: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  /** Decoded clips, by URL: only the playing track's are kept. */
  private buffers = new Map<string, Promise<AudioBuffer>>();
  /** Bumped by every play and stop, so a clip that finished decoding late is not started. */
  private run = 0;
  private volume = 0.7;
  private paused = false;

  /** Whether a track is loaded (playing or paused). */
  get loaded() { return this.sources.length > 0 || this.ctx !== null; }

  private context(): Ctx {
    if (!this.ctx) {
      if (!AudioCtx) throw new Error('This browser has no Web Audio');
      this.ctx = new AudioCtx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private load(ctx: Ctx, url: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(url);
    if (!buffer) {
      buffer = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); })
        .then((data) => ctx.decodeAudioData(data));
      buffer.catch(() => this.buffers.delete(url));
      this.buffers.set(url, buffer);
    }
    return buffer;
  }

  private source(ctx: Ctx, buffer: AudioBuffer): AudioBufferSourceNode {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.gain!);
    this.sources.push(node);
    return node;
  }

  /** Starts the loop at `when`, repeating its sound with the silence at its ends cut. */
  private startLoop(ctx: Ctx, buffer: AudioBuffer, when: number) {
    const { start, end } = audibleRange(buffer);
    const node = this.source(ctx, buffer);
    node.loop = true;
    node.loopStart = start / buffer.sampleRate;
    node.loopEnd = end / buffer.sampleRate;
    node.start(when, node.loopStart);
  }

  /**
   * Plays a track: the intro once, then the loop for ever. Resolves once it is
   * playing; rejects when the browser will not play sound until the page is
   * touched (then call resume() from a tap or key).
   */
  async play(files: MusicFiles, base: string) {
    this.stopSources();
    const run = ++this.run;
    this.paused = false;
    const ctx = this.context();
    const introUrl = files.intro ? `${base}/${files.intro}` : undefined;
    const loopUrl = `${base}/${files.loop}`;
    // Only this track's clips stay decoded: they are large.
    for (const url of this.buffers.keys()) if (url !== introUrl && url !== loopUrl) this.buffers.delete(url);
    // Both load at once; the intro starts as soon as it is ready, the loop when it ends.
    const loop = this.load(ctx, loopUrl);
    if (introUrl) {
      const intro = await this.load(ctx, introUrl);
      if (run !== this.run) return;
      const { end } = audibleRange(intro);
      const at = ctx.currentTime + LEAD;
      this.source(ctx, intro).start(at, 0, end / intro.sampleRate);
      const handover = at + end / intro.sampleRate;
      loop.then((buffer) => {
        if (run !== this.run) return;
        // Normally decoded long before the intro ends; on a slow connection, as soon as it is.
        this.startLoop(ctx, buffer, Math.max(handover, ctx.currentTime + LEAD));
      }).catch((e) => console.error('music: loading the loop failed', e));
    } else if (files.loopEnd) {
      // Exact loop points: played as given, nothing trimmed.
      const buffer = await loop;
      if (run !== this.run) return;
      const node = this.source(ctx, buffer);
      node.loop = true;
      node.loopStart = files.loopStart ?? 0;
      node.loopEnd = Math.min(files.loopEnd, buffer.duration);
      node.start(ctx.currentTime + LEAD, 0);
    } else {
      const buffer = await loop;
      if (run !== this.run) return;
      this.startLoop(ctx, buffer, ctx.currentTime + LEAD);
    }
    await this.resume();
  }

  /** Lets the sound out; rejects when the browser is still blocking it (no tap yet). */
  async resume() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.paused = false;
    // Without a user gesture some browsers leave the promise pending: do not wait on it for ever.
    await Promise.race([ctx.resume(), new Promise((done) => setTimeout(done, 300))]);
    if (ctx.state !== 'running') throw new Error('Audio is blocked until the page is touched');
  }

  /** Holds the music where it is; resume() carries on from there. */
  pause() {
    this.paused = true;
    void this.ctx?.suspend();
  }

  get isPaused() { return this.paused; }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }

  private stopSources() {
    for (const node of this.sources) {
      try { node.stop(); } catch { /* never started */ }
      node.disconnect();
    }
    this.sources = [];
  }

  /** Stops and lets go of everything: the audio device sleeps, the decoded clips are freed. */
  stop() {
    this.run++;
    this.stopSources();
    this.buffers.clear();
    this.paused = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    void ctx?.close();
  }
}
