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
  const keyBindings = useInputStore((state) => state.keyBindings);
  const cursorPosition = useInputStore((state) => state.cursorPosition);
  const moveCursor = useInputStore((state) => state.moveCursor);
  const selectedTilePiece = useInputStore((state) => state.selectedTilePiece);
  const selectTilePiece = useInputStore((state) => state.selectTilePiece);

  const cards = useGameStore((state) => state.cards);
  const players = useGameStore((state) => state.players);
  const stagingState = useGameStore((state) => state.stagingState);
  const updateTilePiece = useGameStore((state) => state.updateTilePiece);
  const commitAction = useGameStore((state) => state.commitAction);
  const cancelAction = useGameStore((state) => state.cancelAction);

  const setShowDetails = useUIStore((state) => state.setShowDetails);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // PIECE MOVEMENT (WASD) - Check this FIRST when in staging mode
      // This takes priority over cursor movement so selected pieces move instead of cursor
      if (selectedTilePiece && stagingState) {
        // Check if it's an opponent piece
        if (isCard(selectedTilePiece) && selectedTilePiece.owner === 'opponent') {
          // Don't handle WASD for opponent pieces
        } else {
          // Get fresh piece data from store to avoid stale closure
          const freshCards = useGameStore.getState().cards;
          const freshPlayers = useGameStore.getState().players;
          const currentPiece = [...freshCards, ...freshPlayers].find(
            p => p.id === selectedTilePiece.id &&
              (isCard(p) === isCard(selectedTilePiece))
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
            const originalPos = stagingState.originalPosition;
            const deltaX = Math.abs(newPosition.x - originalPos.x);
            const deltaY = Math.abs(newPosition.y - originalPos.y);

            // Only allow if within 1 square in both directions
            if (deltaX <= 1 && deltaY <= 1) {
              if (isCard(currentPiece)) {
                // Yu-Gi-Oh rule: When a card moves, it automatically switches to attack position
                const updatedCard = { ...currentPiece, position: newPosition, isDefenseMode: false };
                updateTilePiece(updatedCard);

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
                updateTilePiece(updatedPlayer);
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
      if (!selectedTilePiece || !stagingState) {
        if (e.key.toLowerCase() === keyBindings.cursorUp.toLowerCase()) {
          moveCursor('up');
          return;
        }
        if (e.key.toLowerCase() === keyBindings.cursorDown.toLowerCase()) {
          moveCursor('down');
          return;
        }
        if (e.key.toLowerCase() === keyBindings.cursorLeft.toLowerCase()) {
          moveCursor('left');
          return;
        }
        if (e.key.toLowerCase() === keyBindings.cursorRight.toLowerCase()) {
          moveCursor('right');
          return;
        }
      }

      // COMMIT ACTION (Enter)
      if (e.key === 'Enter') {
        commitAction();
        selectTilePiece(null);
        return;
      }

      // CANCEL ACTION (Escape or custom bindings)
      if (keyBindings.cancel.includes(e.key)) {
        if (selectedTilePiece && isPlayer(selectedTilePiece)) {
          const closeHand = useGameStore.getState().closeHand;
          closeHand();
        }
        cancelAction();
        selectTilePiece(null);
        setShowDetails(false);
        return;
      }

      // SELECT KEY
      if (e.key.toLowerCase() === keyBindings.select.toLowerCase()) {
        // If already in staging mode, commit the action
        if (selectedTilePiece && stagingState) {
          commitAction();
          return;
        }

        // Otherwise, find and select piece at cursor position
        const pieceAtCursor = [...cards, ...players].find(piece =>
          Math.round(piece.position.x) === cursorPosition.x &&
          Math.round(piece.position.y) === cursorPosition.y
        );

        if (pieceAtCursor) {
          selectTilePiece(pieceAtCursor);
        }
        return;
      }

      // VIEW DETAILS KEY
      if (e.key.toLowerCase() === keyBindings.viewDetails.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece)) {
          setShowDetails(true);
        }
        return;
      }

      // FLIP CARD KEY
      if (e.key.toLowerCase() === keyBindings.flipCard.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece) && stagingState) {
          // Get fresh piece data
          const freshCards = useGameStore.getState().cards;
          const currentPiece = freshCards.find(p => p.id === selectedTilePiece.id);

          if (!currentPiece) return;

          // Yu-Gi-Oh rule: Can't flip a card back down if it was originally face-up
          if (stagingState.originalIsFaceDown === false) {
            return;
          }

          const updated = { ...currentPiece, isFaceDown: !currentPiece.isFaceDown };
          updateTilePiece(updated);

          // Update selected piece in input store to keep it fresh
          useInputStore.getState().updateSelectedPiece(updated);

          // Check if the new state is different from original
          const isDifferentFromOriginal = stagingState.originalIsFaceDown !== undefined &&
            updated.isFaceDown !== stagingState.originalIsFaceDown;

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
      if (e.key.toLowerCase() === keyBindings.changePosition.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece) && stagingState) {
          // Get fresh piece data
          const freshCards = useGameStore.getState().cards;
          const currentPiece = freshCards.find(p => p.id === selectedTilePiece.id);

          if (!currentPiece) return;

          // Can't change position if actually moved to a different position
          if (!currentPiece.position.equals(stagingState.originalPosition)) return;

          const updated = { ...currentPiece, isDefenseMode: !currentPiece.isDefenseMode };
          updateTilePiece(updated);

          // Update selected piece in input store to keep it fresh
          useInputStore.getState().updateSelectedPiece(updated);

          // Check if the new mode is different from original
          const isDifferentFromOriginal = stagingState.originalIsDefenseMode !== undefined &&
            updated.isDefenseMode !== stagingState.originalIsDefenseMode;

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
      if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) {
        if (selectedTilePiece && isPlayer(selectedTilePiece)) {
          const openHand = useGameStore.getState().openHand;
          openHand();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    keyBindings,
    cursorPosition,
    moveCursor,
    selectedTilePiece,
    selectTilePiece,
    cards,
    players,
    stagingState,
    updateTilePiece,
    commitAction,
    cancelAction,
    setShowDetails
  ]);
}
