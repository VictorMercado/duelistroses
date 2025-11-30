import { useEffect } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { useInputStore } from '@/stores/inputStore';
import { useUIStore } from '@/stores/uiStore';
import { isCard, isPlayer } from '@/types';

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
    const handleKeyDown = (e: KeyboardEvent) => {
      // PIECE MOVEMENT (WASD) - Check this FIRST when in staging mode
      // This takes priority over cursor movement so selected pieces move instead of cursor
      if (inputStore.selectedTilePiece && gameStore.stagingState) {
        // Check if it's an opponent piece
        if (inputStore.selectedTilePiece.owner === 'player') {
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
              newPosition.y = Math.min(newPosition.y + 1, 5);
              moved = true;
              break;
            case 's':
              newPosition.y = Math.max(newPosition.y - 1, -5);
              moved = true;
              break;
            case 'a':
              newPosition.x = Math.max(newPosition.x - 1, -5);
              moved = true;
              break;
            case 'd':
              newPosition.x = Math.min(newPosition.x + 1, 5);
              moved = true;
              break;
          }

          if (moved) {
            // Check if new position is within 1 square of ORIGINAL position
            const originalPos = gameStore.stagingState.originalPosition;
            const deltaX = Math.abs(newPosition.x - originalPos.x);
            const deltaY = Math.abs(newPosition.y - originalPos.y);

            // Only allow if within 1 square in both directions
            if (deltaX <= 1 && deltaY <= 1) {
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

      // COMMIT ACTION (Enter)
      if (e.key === 'Enter') {
        gameStore.commitAction();
        inputStore.selectTilePiece(null);
        return;
      }

      // CANCEL ACTION (Escape or custom bindings)
      if (inputStore.keyBindings.cancel.includes(e.key)) {
        if (inputStore.selectedTilePiece && isPlayer(inputStore.selectedTilePiece)) {
          const closeHand = gameStore.closeHand;
          closeHand();
        }
        gameStore.cancelAction();
        inputStore.selectTilePiece(null);
        uiStore.setShowDetails(false);
        return;
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

      // FLIP CARD KEY
      if (e.key.toLowerCase() === inputStore.keyBindings.flipCard.toLowerCase()) {
        if (inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece) && gameStore.stagingState) {
          // Get fresh piece data
          const freshCards = gameStore.cards;
          const currentPiece = freshCards.find(p => p.id === inputStore.selectedTilePiece!.id);

          if (!currentPiece) return;

          // Yu-Gi-Oh rule: Can't flip a card back down if it was originally face-up
          if (gameStore.stagingState.originalIsFaceDown === false) {
            return;
          }

          const updated = { ...currentPiece, isFaceDown: !currentPiece.isFaceDown };
          gameStore.updateTilePiece(updated);

          // Update selected piece in input store to keep it fresh
          useInputStore.getState().updateSelectedPiece(updated);

          // Check if the new state is different from original
          const isDifferentFromOriginal = gameStore.stagingState.originalIsFaceDown !== undefined &&
            updated.isFaceDown !== gameStore.stagingState.originalIsFaceDown;

          // Mark as flipped in staging only if different from original
          useGameStore.setState((state) => ({
            stagingState: state.stagingState
              ? { ...state.stagingState, hasFlipped: isDifferentFromOriginal }
              : null
          }));
        }
        return;
      }

      // CHANGE POSITION KEY
      if (e.key.toLowerCase() === inputStore.keyBindings.changePosition.toLowerCase()) {
        if (inputStore.selectedTilePiece && isCard(inputStore.selectedTilePiece) && gameStore.stagingState) {
          // Get fresh piece data
          const freshCards = gameStore.cards;
          const currentPiece = freshCards.find(p => p.id === inputStore.selectedTilePiece!.id);

          if (!currentPiece) return;

          // Can't change position if actually moved to a different position
          if (!currentPiece.position.equals(gameStore.stagingState.originalPosition)) return;

          const updated = { ...currentPiece, isDefenseMode: !currentPiece.isDefenseMode };
          gameStore.updateTilePiece(updated);

          // Update selected piece in input store to keep it fresh
          useInputStore.getState().updateSelectedPiece(updated);

          // Check if the new mode is different from original
          const isDifferentFromOriginal = gameStore.stagingState.originalIsDefenseMode !== undefined &&
            updated.isDefenseMode !== gameStore.stagingState.originalIsDefenseMode;

          // Mark as changed position in staging only if different from original
          useGameStore.setState((state) => ({
            stagingState: state.stagingState
              ? { ...state.stagingState, hasChangedPosition: isDifferentFromOriginal }
              : null
          }));
        }
        return;
      }

      // PLAY CARD KEY (placeholder)
      if (e.key.toLowerCase() === inputStore.keyBindings.playCard.toLowerCase()) {
        if (inputStore.selectedTilePiece && isPlayer(inputStore.selectedTilePiece)) {
          gameStore.openHand();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    inputStore,
    gameStore,
    uiStore
  ]);
}
