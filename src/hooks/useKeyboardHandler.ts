import { useEffect } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { useInputStore } from '@/stores/inputStore';
import { useUIStore } from '@/stores/uiStore';
import { isCard, isPlayer } from '@/types';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX
} from "@/const";

/**
 * Consolidated keyboard handler hook that manages ALL keyboard interactions:
 * - Cursor movement (WASD or custom bindings)
 * - Piece movement (WASD) when in staging mode
 * - Action keys (Enter, select, flip, change position, etc.)
 * - Cancel keys (Escape, custom bindings)
 */
export function useKeyboardHandler() {
  const inputStore = useInputStore();
  const gameStore = useGameStore();
  const uiStore = useUIStore();

  useEffect(() => {
    const handleKeydownEvent = (e: KeyboardEvent) => {
      // PIECE MOVEMENT (WASD) - Check this FIRST when in staging mode
      // This takes priority over cursor movement so selected pieces move instead of cursor
      if (inputStore.selectedTilePiece && gameStore.stagingState) {
        // Check if it's an opponent piece
        if (inputStore.selectedTilePiece.owner === 'player') {
          // CANCEL ACTION (Escape or custom bindings)
          if (inputStore.keyBindings.cancel.includes(e.key)) {
            if (isPlayer(inputStore.selectedTilePiece) && gameStore.showHand) {
              gameStore.closeHand();
              return;
            }
            gameStore.cancelAction();
            inputStore.selectTilePiece(null);
            uiStore.setShowDetails(false);
            return;
          }
          // COMMIT ACTION (Enter)
          if (e.key === 'Enter') {
            gameStore.commitAction();
            inputStore.selectTilePiece(null);
            return;
          }
          // CARD ACTIONS
          if (isCard(inputStore.selectedTilePiece)) {
            // FLIP CARD ACTION
            if (e.key.toLowerCase() === inputStore.keyBindings.flipCard.toLowerCase()) {
              gameStore.flipSelectedCard();
              return;
            }
            // CHANGE POSITION ACTION
            if (e.key.toLowerCase() === inputStore.keyBindings.changePosition.toLowerCase()) {
              gameStore.changePosition();
              return;
            }
          }
          // PLAYER ACTIONS
          if (isPlayer(inputStore.selectedTilePiece)) {
            // PLAY CARD KEY (placeholder)
            if (e.key.toLowerCase() === inputStore.keyBindings.playCard.toLowerCase()) {
              gameStore.openHand();
              return;
            }
          }
          // TODO: Move most of this logic to gameStore
          const freshCards = gameStore.cards;
          const freshPlayers = gameStore.players;
          const currentPiece = [...freshCards, ...freshPlayers].find(
            p => p.id === inputStore.selectedTilePiece!.id &&
              (isCard(p) === isCard(inputStore.selectedTilePiece!))
          );

          if (!currentPiece) return;

          const newPosition = currentPiece.position.clone();
          let moved = false;

          switch (e.key) {
            case 'w':
              newPosition.y = Math.min(newPosition.y + 1, Y_AXIS_POSITIVE_MAX);
              moved = true;
              break;
            case 's':
              newPosition.y = Math.max(newPosition.y - 1, Y_AXIS_NEGATIVE_MAX);
              moved = true;
              break;
            case 'a':
              newPosition.x = Math.max(newPosition.x - 1, X_AXIS_NEGATIVE_MAX);
              moved = true;
              break;
            case 'd':
              newPosition.x = Math.min(newPosition.x + 1, X_AXIS_POSITIVE_MAX);
              moved = true;
              break;
          }

          // TODO: Move most of this logic to gameStore
          if (moved) {
            // Get valid move positions from gameStore (cardinal directions only)
            const validPositions = gameStore.getValidMovePositions();
            const targetX = Math.round(newPosition.x);
            const targetY = Math.round(newPosition.y);

            // Check if the new position is in the list of valid positions
            const isValidMove = validPositions.some(([x, y]) => x === targetX && y === targetY);

            if (isValidMove) {
              if (isCard(currentPiece)) {
                // Yu-Gi-Oh rule: When a card moves, it automatically switches to attack position
                const updatedCard = { ...currentPiece, position: newPosition, isDefenseMode: false };
                gameStore.updateTilePiece(updatedCard);

                // Update selected piece in input store to keep it fresh
                useInputStore.getState().updateSelectedPiece(updatedCard);

                // Reset hasChangedPosition since movement overrides position change
                useGameStore.setState((state) => ({
                  stagingState: state.stagingState
                    ? { ...state.stagingState, hasChangedPosition: false }
                    : null
                }));
              } else {
                const updatedPlayer = { ...currentPiece, position: newPosition };
                gameStore.updateTilePiece(updatedPlayer);
                useInputStore.getState().updateSelectedPiece(updatedPlayer);
              }

              // Update cursor to follow the card's movement
              const setCursorPosition = useInputStore.getState().setCursorPosition;
              setCursorPosition({
                x: Math.round(newPosition.x),
                y: Math.round(newPosition.y)
              });
            }
            return;
          }
        }
      }

      // CURSOR MOVEMENT (WASD or custom bindings)
      // Only handle cursor movement if NOT in staging mode (otherwise piece movement takes priority)
      if (!inputStore.selectedTilePiece || !gameStore.stagingState) {
        if (e.key.toLowerCase() === inputStore.keyBindings.cursorUp.toLowerCase()) {
          inputStore.moveCursor('up');
          return;
        }
        if (e.key.toLowerCase() === inputStore.keyBindings.cursorDown.toLowerCase()) {
          inputStore.moveCursor('down');
          return;
        }
        if (e.key.toLowerCase() === inputStore.keyBindings.cursorLeft.toLowerCase()) {
          inputStore.moveCursor('left');
          return;
        }
        if (e.key.toLowerCase() === inputStore.keyBindings.cursorRight.toLowerCase()) {
          inputStore.moveCursor('right');
          return;
        }
      }

      // SELECT KEY
      if (e.key.toLowerCase() === inputStore.keyBindings.select.toLowerCase()) {
        // If already in staging mode, commit the action
        if (inputStore.selectedTilePiece && gameStore.stagingState) {
          gameStore.commitAction();
          inputStore.selectTilePiece(null);
          return;
        }

        // Otherwise, find and select piece at cursor position
        const pieceAtCursor = [...gameStore.cards, ...gameStore.players].find(piece =>
          Math.round(piece.position.x) === inputStore.cursorPosition.x &&
          Math.round(piece.position.y) === inputStore.cursorPosition.y
        );

        if (pieceAtCursor) {
          inputStore.selectTilePiece(pieceAtCursor);
        }
        return;
      }

      // VIEW DETAILS KEY
      if (e.key.toLowerCase() === inputStore.keyBindings.viewDetails.toLowerCase()) {
        if (inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece)) {
          uiStore.setShowDetails(true);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeydownEvent);
    return () => window.removeEventListener('keydown', handleKeydownEvent);
  }, [
    inputStore,
    gameStore,
    uiStore
  ]);
}
