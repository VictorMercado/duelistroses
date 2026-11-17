import { useCallback, useEffect, useState } from "react";
import { playSfx } from "@/game/sfx";
import { friendAction, friendsList, type FriendsList } from "@/net/api";
import { useSessionStore } from "@/stores/sessionStore";
import { session } from "@/net/session";
import { useMenuStore } from "@/stores/menuStore";
import { poll, POLL } from "@/net/poll";

const small = " border border-white/25 px-2 py-0.5 text-xs hover:border-yellow-400 active:border-yellow-400 disabled:opacity-40 pointer-coarse:min-h-9 pointer-coarse:px-3";

/**
 * The friends list: add by name, answer requests, see who is around, and
 * invite friends to the lobby you are in (or join the one you were invited to).
 */
export default function Friends({ inRoom }: { inRoom: boolean; }) {
  const token = useSessionStore((s) => s.token);
  const guest = useSessionStore((s) => s.user?.guest ?? true);
  const [list, setList] = useState<FriendsList | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const showProfile = useMenuStore((s) => s.showProfile);

  const refresh = useCallback(() => {
    if (!token || guest) return;
    friendsList(token).then(setList).catch(() => { });
  }, [token, guest]);

  // Polling keeps the list fresh, and tells the server we are online.
  useEffect(() => poll(refresh, POLL.friends), [refresh]);

  if (guest || !token) {
    return <p className="text-xs text-white/50">Create an account to add friends and invite them to a lobby. Guests can still join by room name or link.</p>;
  }

  const act = async (action: "request" | "accept" | "remove" | "invite", body: { name?: string; id?: string; }, done?: string) => {
    try {
      const result = await friendAction(token, action, body);
      setNote(done ?? (action === "request" ? (result.friends ? "You are now friends." : "Request sent.") : ""));
      refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <div className="border border-white/15 bg-black/40 p-3 text-sm">
      <p className="mb-2 font-bold text-yellow-200">Friends</p>

      {list?.invites.map((invite) => (
        <p key={invite.from.id} className="mb-2 flex items-center justify-between bg-emerald-900/50 px-2 py-1">
          <span><b>{invite.from.name}</b> invited you to a lobby</span>
          <button className={small} onClick={() => session.connect(invite.roomId)}>Join</button>
        </p>
      ))}

      {list?.incoming.map((person) => (
        <p key={person.id} className="mb-1 flex items-center justify-between">
          <span><b>{person.name}</b> wants to be friends</span>
          <span className="flex gap-1">
            <button className={small} onClick={() => act("accept", { id: person.id }, `You and ${person.name} are now friends.`)}>Accept</button>
            <button className={small} onClick={() => act("remove", { id: person.id })}>Decline</button>
          </span>
        </p>
      ))}

      {list?.friends.length === 0 && <p className="text-xs text-white/50">No friends yet. Add one by their duelist name.</p>}
      {list?.friends.map((friend) => (
        <p key={friend.id} className="flex items-center justify-between border-t border-white/10 py-1">
          <span>
            <span className={`mr-2 inline-block h-2 w-2 ${friend.online ? "bg-green-400" : "bg-white/20"}`} />
            {/* In a room the menu's screens are out of reach, so the name is only a link from the menu. */}
            {inRoom ? friend.name : <button className="underline decoration-white/30 underline-offset-2 hover:text-yellow-200" title={`${friend.name}'s profile`} onClick={() => showProfile(friend.name)}>{friend.name}</button>}
            <span className="text-xs text-white/40">{friend.roomId ? " · in a room" : friend.online ? " · online" : " · offline"}</span>
          </span>
          <span className="flex gap-1">
            {/* Watching goes through the friend: you see the duel as their team does. */}
            {!inRoom && friend.roomId && <button className={small} onClick={() => session.connect(friend.roomId!, `user:${friend.id}`)}>Watch</button>}
            {inRoom && (
              <button
                className={small}
                disabled={invited.includes(friend.id)}
                onClick={() => { setInvited((ids) => [...ids, friend.id]); act("invite", { id: friend.id }, `Invited ${friend.name}.`); }}
              >
                {invited.includes(friend.id) ? "Invited" : "Invite"}
              </button>
            )}
            <button className={small} title="Remove friend" onClick={() => { if (confirm(`Remove ${friend.name} from your friends?`)) act("remove", { id: friend.id }); }}>✕</button>
          </span>
        </p>
      ))}

      {list?.outgoing.map((person) => (
        <p key={person.id} className="flex items-center justify-between py-0.5 text-xs text-white/50">
          <span>Request sent to {person.name}</span>
          <button className={small} onClick={() => { playSfx("cancel", 0.4); act("remove", { id: person.id }); }}>Cancel</button>
        </p>
      ))}

      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { act("request", { name: name.trim() }); setName(""); } }}>
        <input className="min-w-0 flex-1 border border-white/20 bg-black/60 px-2 py-1 text-sm outline-none focus:border-yellow-400" placeholder="Add a friend by name" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        <button className={small} disabled={!name.trim()}>Add</button>
      </form>
      {note && <p className="mt-1 text-xs text-white/60">{note}</p>}
    </div>
  );
}
