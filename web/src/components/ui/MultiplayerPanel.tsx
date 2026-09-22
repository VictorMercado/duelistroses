import { useState } from 'react';
import { netManager } from '@/net/netManager';
import { useNetStore } from '@/stores/netStore';
import { useGameStore } from '@/stores/gameStore';
import { gameManager } from '@/game/gameManager';
import type { NetRole } from '@/net/protocol';

const STATUS_COLOR: Record<string, string> = {
  idle: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-yellow-500 animate-pulse',
  open: 'bg-green-500',
  closed: 'bg-red-500',
};

export default function MultiplayerPanel() {
  const [expanded, setExpanded] = useState(false);

  const status = useNetStore((s) => s.status);
  const roomId = useNetStore((s) => s.roomId);
  const playerName = useNetStore((s) => s.playerName);
  const requestedRole = useNetStore((s) => s.requestedRole);
  const lastError = useNetStore((s) => s.lastError);
  const eventLog = useNetStore((s) => s.eventLog);
  const users = useNetStore((s) => s.users);
  const me = useNetStore((s) => s.me);

  const isOnline = useGameStore((s) => s.isOnline);
  const players = useGameStore((s) => s.players);
  const turnState = useGameStore((s) => s.turnState);

  const activePlayer = players[turnState.playerTurnIndex];
  const playerCount = users.filter((user) => user.role === 'player').length;
  const spectatorCount = users.length - playerCount;
  const isUsersTurn = gameManager.isUsersTurn();
  const connected = status === 'open';

  return (
    <div className="absolute top-20 left-4 z-70 font-mono text-xs text-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 bg-black/80 border border-white/20 hover:border-yellow-500 rounded-lg px-3 py-2"
      >
        <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[status] ?? 'bg-gray-500'}`} />
        <span>{connected ? `${roomId}` : 'Offline'}</span>
      </button>

      {/* Turn banner - shown whenever we are in a networked room */}
      {isOnline && (
        <div
          className={`mt-2 px-3 py-2 rounded-lg border ${isUsersTurn
            ? 'border-green-500 bg-green-900/70'
            : 'border-white/20 bg-black/80'
            }`}
        >
          {isUsersTurn
            ? 'Your turn'
            : `Turn: ${activePlayer?.name ?? '—'}`}
        </div>
      )}

      {expanded && (
        <div className="mt-2 bg-black/90 border border-white/20 rounded-lg p-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-white/60">Room</span>
            <input
              value={roomId}
              disabled={connected}
              onChange={(e) => useNetStore.getState().setRoomId(e.target.value)}
              className="bg-black border border-white/20 rounded px-2 py-1 disabled:opacity-50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-white/60">Name</span>
            <input
              value={playerName}
              disabled={connected}
              onChange={(e) => useNetStore.getState().setPlayerName(e.target.value)}
              className="bg-black border border-white/20 rounded px-2 py-1 disabled:opacity-50"
            />
          </label>

          {/* One view of the room: how many are here, who they are, and what
              each of them is. The role picker sits with it, since it decides
              what you will show up as. */}
          <div className="flex flex-col gap-2 p-2 rounded border border-white/15 bg-black/50">
            <div className="flex items-baseline justify-between">
              <span className="text-white/60">In this room</span>
              <span className="px-1.5 rounded-full border border-white/20 text-white/70">
                {users.length}
              </span>
            </div>

            <div className="flex items-center gap-2 text-white/40">
              <span className="text-green-400">
                {playerCount} {playerCount === 1 ? 'player' : 'players'}
              </span>
              <span className="text-white/20">|</span>
              <span>{spectatorCount} watching</span>
            </div>

            {users.length === 0 ? (
              <span className="text-white/30">Nobody here yet</span>
            ) : (
              <ul className="max-h-40 overflow-y-auto flex flex-col gap-1">
                {users.map((user) => {
                  const isMe = user.id === me?.id;
                  const isPlayer = user.role === 'player';
                  const hasTurn = isPlayer && user.id === activePlayer?.id;

                  return (
                    <li
                      key={user.id}
                      className={`flex items-center justify-between gap-2 px-1.5 py-1 rounded ${isMe ? 'bg-yellow-500/10' : 'bg-white/5'
                        }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlayer ? 'bg-green-500' : 'bg-white/40'
                            }`}
                        />
                        <span className={`truncate ${isMe ? 'text-yellow-500' : 'text-white/90'}`}>
                          {user.name}
                        </span>
                        {isMe && <span className="text-white/40 shrink-0">(you)</span>}
                      </span>

                      <span className="flex items-center gap-1 shrink-0">
                        {hasTurn && <span className="text-yellow-500">turn</span>}
                        {isPlayer && user.clan && (
                          <span className="text-white/40">{user.clan}</span>
                        )}
                        <span
                          className={`px-1 rounded border ${isPlayer
                            ? 'border-green-600 text-green-400'
                            : 'border-white/20 text-white/50'
                            }`}
                        >
                          {user.role}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <label className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
              <span className="text-white/60">Join as</span>
              <select
                value={requestedRole}
                disabled={connected}
                onChange={(e) => useNetStore.getState().setRequestedRole(e.target.value as NetRole)}
                className="bg-black border border-white/20 rounded px-2 py-1 disabled:opacity-50"
              >
                <option value="player">Player</option>
                <option value="spectator">Spectator</option>
              </select>
            </label>
          </div>

          {lastError && (
            <div className="text-red-400 wrap-break-word">{lastError}</div>
          )}
          {/* Event Log */}
          <div className="max-h-32 overflow-y-auto text-white/40 flex flex-col gap-0.5">
            {eventLog.map((entry, index) => (
              <span key={`${entry}-${index}`}>{entry}</span>
            ))}
          </div>
          {connected ? (
            <button
              onClick={() => netManager.disconnect()}
              className="border-2 border-red-600 bg-red-700 hover:bg-red-600 rounded-md py-1 font-bold"
            >
              Leave room
            </button>
          ) : (
            <button
              onClick={() => netManager.connect()}
              className="border-2 border-green-600 bg-green-700 hover:bg-green-600 rounded-md py-1 font-bold"
            >
              Join room
            </button>
          )}

          {connected && (
            <button
              onClick={() => gameManager.endTurn()}
              disabled={!isUsersTurn}
              className={`border-2 rounded-md py-1 font-bold ${isUsersTurn
                ? 'border-blue-600 bg-blue-700 hover:bg-blue-600'
                : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
            >
              End turn
            </button>
          )}
        </div>
      )}
    </div>
  );
}
