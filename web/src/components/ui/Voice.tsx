import { SEAT_COLORS } from "@/const";
import { session } from "@/net/session";
import { useVoiceStore, voice } from "@/net/voice";

/**
 * Joins the room's voice chat, then mutes and unmutes our microphone. A ring
 * shows while the mic picks us up. Leaving is in the voice list (VoicePanel).
 */
export function VoiceButton({ className = "" }: { className?: string; }) {
  const on = useVoiceStore((s) => s.on);
  const joining = useVoiceStore((s) => s.joining);
  const micMuted = useVoiceStore((s) => s.micMuted);
  const speaking = useVoiceStore((s) => s.speaking);
  if (session.isDisplay) return null;
  const label = !on ? "Join voice chat" : micMuted ? "Unmute your microphone" : "Mute your microphone";
  return (
    <button
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center border text-base ${!on ? "border-white/20 bg-black/80 hover:border-white/50" : micMuted ? "border-rose-400 bg-rose-950/90" : speaking ? "border-emerald-300 bg-emerald-900/90 shadow-[0_0_10px_rgba(110,231,183,0.6)]" : "border-emerald-500/60 bg-black/80"} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={on ? !micMuted : undefined}
      disabled={joining}
      onClick={() => (on ? voice.setMicMuted(!micMuted) : void voice.join())}
    >
      {joining ? "…" : "🎙"}
      {on && micMuted && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-black text-rose-400" aria-hidden>╱</span>}
    </button>
  );
}

/** Who is in voice with us: talking lights up, and each can be muted (for us only). */
export function VoicePanel() {
  const on = useVoiceStore((s) => s.on);
  const error = useVoiceStore((s) => s.error);
  const peers = Object.values(useVoiceStore((s) => s.peers));
  if (error) {
    return (
      <p className="mt-1 flex items-start gap-1 border-t border-white/10 pt-1 text-rose-300">
        <span className="flex-1">🎙 {error}</span>
        <button className="text-white/50 hover:text-white" aria-label="Dismiss" onClick={() => useVoiceStore.setState({ error: "" })}>✕</button>
      </p>
    );
  }
  if (!on) return null;
  return (
    <div className="mt-1 border-t border-white/10 pt-1">
      <div className="flex items-center gap-1">
        <span className="text-emerald-300">🎙 Voice</span>
        {peers.length === 0 && <span className="text-white/40">nobody else yet</span>}
        <button className="ml-auto border border-white/20 px-1.5 text-white/60 hover:border-rose-400 hover:text-rose-300" onClick={() => voice.leave()}>Leave voice</button>
      </div>
      {peers.map((p) => (
        <div key={p.cid} className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 shrink-0 ${p.speaking ? "ring-2 ring-emerald-300" : ""}`}
            style={{ background: p.spectator ? "#d0d7de" : SEAT_COLORS[p.seat] ?? "#d0d7de", opacity: p.connected ? 1 : 0.35 }}
            aria-hidden
          />
          <span className={`truncate ${p.speaking ? "text-emerald-200" : "text-white/75"}`}>
            {p.name}{p.spectator ? " (spectator)" : ""}
          </span>
          {!p.connected && <span className="text-white/35">connecting…</span>}
          {!p.hear && <span className="text-white/35" title="They can hear you, but you can't hear them: spectators are muted, or they watch the other side">listening only</span>}
          {!p.speak && <span className="text-white/35" title="You can hear them, but they can't hear you: spectators are muted, or you watch the other side">can't hear you</span>}
          {p.hear && (
            <button
              className={`ml-auto px-1 ${p.muted ? "text-rose-300" : "text-white/50 hover:text-white"}`}
              title={p.muted ? `Unmute ${p.name}` : `Mute ${p.name} (just for you)`}
              aria-label={p.muted ? `Unmute ${p.name}` : `Mute ${p.name}`}
              aria-pressed={p.muted}
              onClick={() => voice.setPeerMuted(p.cid, !p.muted)}
            >
              {p.muted ? "🔇" : "🔊"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
