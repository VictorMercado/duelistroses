import { useEffect, useState } from "react";
import { loadProfile, type Profile } from "@/net/api";
import { useMenuStore } from "@/stores/menuStore";
import { useSessionStore } from "@/stores/sessionStore";

const ghost = " border border-white/25 px-3 py-2 text-sm hover:border-white active:border-yellow-400 pointer-coarse:min-h-11";

/** Our initial in a round badge: the button that opens the profile modal. */
export function AvatarButton({ onClick, className = "" }: { onClick: () => void; className?: string; }) {
  const name = useSessionStore((s) => s.user?.name ?? "");
  return (
    <button
      onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center border-2 border-yellow-400 bg-yellow-900/60 text-lg font-bold uppercase text-yellow-200 hover:bg-yellow-800/70 pointer-coarse:size-11 ${className}`}
      title="Profile"
      aria-label="Profile"
      aria-haspopup="dialog"
    >
      {name.trim().charAt(0) || "?"}
    </button>
  );
}

/** Who we are, our record at a glance, and where to go from here. */
export default function ProfileModal({ onClose }: { onClose: () => void; }) {
  const token = useSessionStore((s) => s.token);
  const user = useSessionStore((s) => s.user);
  const setSession = useSessionStore((s) => s.setSession);
  const { setScreen, showProfile } = useMenuStore();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!token || user?.guest) return;
    let live = true;
    loadProfile(token).then((p) => live && setProfile(p)).catch(() => { });
    return () => { live = false; };
  }, [token, user?.guest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!user) return null;
  const go = (action: () => void) => { onClose(); action(); };
  const r = profile?.record;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 p-3 pt-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] font-mono text-white" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        className="flex w-full max-w-sm flex-col gap-4 border border-white/15 bg-zinc-950/95 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-14 shrink-0 items-center justify-center border-2 border-yellow-400 bg-yellow-900/60 text-2xl font-bold uppercase text-yellow-200">
            {user.name.trim().charAt(0) || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-yellow-300">{user.name}</p>
            <p className="text-xs text-white/60">
              {user.guest ? "Guest" : "Duelist"}
              {user.admin && <span className="text-fuchsia-300"> · admin</span>}
            </p>
          </div>
          <button className="self-start px-2 text-white/50 hover:text-white pointer-coarse:min-h-10" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        {user.guest ? (
          <p className="text-sm text-white/60">Guests have no record. Create an account to keep your stats, decks and friends.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Duels" value={r ? String(r.games) : "…"} />
            <Stat label="Wins" value={r ? String(r.wins) : "…"} />
            <Stat label="Win rate" value={r ? (r.games ? `${Math.round((r.wins / r.games) * 100)}%` : "–") : "…"} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!user.guest && <button className={`${ghost} col-span-2`} onClick={() => go(() => showProfile())}>👤 Full profile</button>}
          <button className={ghost} onClick={() => go(() => setScreen("decks"))}>🃏 Deck builder</button>
          <button className={ghost} onClick={() => go(() => setScreen("maps"))}>🗺️ Map editor</button>
          {user.admin && <button className={`${ghost} col-span-2`} onClick={() => go(() => setScreen("admin"))}>🛡️ Admin</button>}
          <button className={`${ghost} col-span-2 text-rose-300`} onClick={() => go(() => setSession(null, null))}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string; }) {
  return (
    <div className="border border-white/10 bg-black/50 p-2">
      <p className="text-lg font-bold tabular-nums text-yellow-200">{value}</p>
      <p className="text-[10px] uppercase text-white/50">{label}</p>
    </div>
  );
}
