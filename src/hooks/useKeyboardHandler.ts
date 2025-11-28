import { useEffect } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { useInputStore } from '@/stores/inputStore';
import { useUIStore } from '@/stores/uiStore';
import { isCard } from '@/types';

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
                // Prevent position change if defense mode was toggled
                if (stagingState.originalIsDefenseMode !== undefined &&
                  currentPiece.isDefenseMode !== stagingState.originalIsDefenseMode) {
                  return;
                }
                const updatedCard = { ...currentPiece, position: newPosition, isDefenseMode: false };
                updateTilePiece(updatedCard);
              } else {
                updateTilePiece({ ...currentPiece, position: newPosition });
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
        return;
      }

      // CANCEL ACTION (Escape or custom bindings)
      if (keyBindings.cancel.includes(e.key)) {
        cancelAction();
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
          const updated = { ...selectedTilePiece, isFaceDown: !selectedTilePiece.isFaceDown };
          updateTilePiece(updated);

          // Mark as flipped in staging
          useGameStore.setState((state) => ({
            stagingState: state.stagingState
              ? { ...state.stagingState, hasFlipped: true }
              : null
          }));
        }
        return;
      }

      // CHANGE POSITION KEY
      if (e.key.toLowerCase() === keyBindings.changePosition.toLowerCase()) {
        if (selectedTilePiece && isCard(selectedTilePiece) && stagingState) {
          // Can't change position if actually moved to a different position
          if (!selectedTilePiece.position.equals(stagingState.originalPosition)) return;

          const updated = { ...selectedTilePiece, isDefenseMode: !selectedTilePiece.isDefenseMode };
          updateTilePiece(updated);

          // Mark as changed position in staging
          useGameStore.setState((state) => ({
            stagingState: state.stagingState
              ? { ...state.stagingState, hasChangedPosition: true }
              : null
          }));
        }
        return;
      }

      // PLAY CARD KEY (placeholder)
      if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) {
        console.log('Play card action - not yet implemented');
        return;
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
