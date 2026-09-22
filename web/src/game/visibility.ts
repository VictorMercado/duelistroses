import type { Card, TilePiece } from '@/types';
import { useGameStore } from '@/stores/gameStore';

/**
 * Which side the local client plays: the side of the seat the server gave us.
 * Spectators, and anyone not in a room, get null and therefore own nothing.
 */
export function viewerOwner(): Card['owner'] | null {
  const { players, playerIndex } = useGameStore.getState();
  return players[playerIndex]?.owner ?? null;
}

export function isViewersPiece(piece: TilePiece, owner = viewerOwner()): boolean {
  return owner !== null && piece.owner === owner;
}

/**
 * A card is anonymous to the viewer while it is face down and belongs to
 * somebody else - the viewer should only ever see the mystery card for it.
 * `hidden` is set by the server, which strips the identity of such cards before
 * they are ever sent; this check also covers solo play, where nothing is
 * stripped.
 */
export function isCardAnonymous(card: Card, owner = viewerOwner()): boolean {
  return !!card.hidden || (card.isFaceDown && !isViewersPiece(card, owner));
}

/** Reactive version for components: re-renders when the seat changes. */
export function useViewerOwner(): Card['owner'] | null {
  return useGameStore((state) => state.players[state.playerIndex]?.owner ?? null);
}
