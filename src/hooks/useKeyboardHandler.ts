import { useEffect } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { useInputStore } from '@/stores/inputStore';
import { useUIStore } from '@/stores/uiStore';
import { isCard, isPlayer } from '@/types';
import { SUMMON_OPTIONS } from '@/components/SummonOptions';
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
      // GLOBAL CANCEL (Escape or custom bindings)
      if (inputStore.keyBindings.cancel.includes(e.key)) {
        if (gameStore.summoningState.active) {
          if (gameStore.summoningState.phase === 'position') {
            gameStore.returnToHand();
            inputStore.resetSummonOptionIndex();
            return;
          }
          if (gameStore.summoningState.phase === 'card') {
            gameStore.returnToTarget();
            return;
          }
          gameStore.cancelSummoning();
          return;
        }

        if (gameStore.showHand) {
          gameStore.closeHand();
          return;
        }

        // Default cancel behavior
        if (inputStore.selectedTilePiece) {
          gameStore.cancelAction();
          inputStore.selectTilePiece(null);
          uiStore.setShowDetails(false);
          return;
        }
      }

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
              gameStore.enterSummoningMode(); // New flow
              return;
            }
          }
          // TODO: Move most of this logic to gameStore
          const freshCards = useGameStore.getState().cards;
          const freshPlayers = useGameStore.getState().players;
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

      // --- MOVEMENT ---
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) {
        if (gameStore.summoningState.active && gameStore.summoningState.phase === 'position') {
          const currentIndex = inputStore.summonOptionIndex;
          let newIndex = currentIndex;
          if (e.key === 'ArrowUp' || e.key === 'w') newIndex = Math.max(0, currentIndex - 1);
          if (e.key === 'ArrowDown' || e.key === 's') newIndex = Math.min(SUMMON_OPTIONS.length - 1, currentIndex + 1);
          inputStore.setSummonOptionIndex(newIndex);
          return; // Don't move cursor
        } else {
          // Standard cursor movement
          // Only handle cursor movement if NOT in staging mode (otherwise piece movement takes priority)
          if (!inputStore.selectedTilePiece || !gameStore.stagingState) {
            const direction =
              (e.key === 'ArrowUp' || e.key === 'w') ? 'up' :
                (e.key === 'ArrowDown' || e.key === 's') ? 'down' :
                  (e.key === 'ArrowLeft' || e.key === 'a') ? 'left' : 'right';

            inputStore.moveCursor(direction);
            return;
          }
        }
      }

      // --- SELECT (Confirm) ---
      if (e.key.toLowerCase() === inputStore.keyBindings.select.toLowerCase()) {
        if (gameStore.summoningState.active) {
          const { phase } = gameStore.summoningState;

          if (phase === 'target') {
            gameStore.confirmSummonTarget();
          } else if (phase === 'card') {
            gameStore.selectCardForSummon();
          } else if (phase === 'position') {
            const index = inputStore.summonOptionIndex;
            const options = SUMMON_OPTIONS[index];
            if (options) {
              gameStore.confirmSummonPosition(options);
            }
          }
          return;
        }

        // Standard Select Logic (existing)
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
        const isHandOpen = gameStore.showHand || (gameStore.summoningState.active && gameStore.summoningState.phase === 'card');

        if (isHandOpen && inputStore.handSelectedIndex >= 0) {
          uiStore.setShowDetails(true);
          return;
        }

        if (inputStore.selectedTilePiece) {
          if (isCard(inputStore.selectedTilePiece)) {
            uiStore.setShowDetails(true);
          } else if (isPlayer(inputStore.selectedTilePiece)) {
            uiStore.setShowPlayerDetails(true);
          }
        }
        return;
      }

      // PLAY CARD KEY (J) - Enter Summoning Mode
      if (e.key.toLowerCase() === inputStore.keyBindings.playCard.toLowerCase()) {
        gameStore.enterSummoningMode();
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
};
