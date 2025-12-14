import { useEffect } from 'react';
import { gameManager } from '@/game/GameManager';
import { useGameStore } from '@/stores/gameStore';
import { isCard, isPlayer } from '@/types';
import { useKeyBindings } from '@/hooks/useKeyBindings';

/**
 * Consolidated keyboard handler hook that delegates to GameManager.
 */
export function useKeyboardHandler() {
  const { keyBindings } = useKeyBindings();
  useEffect(() => {
    const handleKeydownEvent = (e: KeyboardEvent) => {
      const { stagingState, turnState, playerIndex, selectedTilePiece } = useGameStore.getState();
      // 1. CANCEL (Escape / bound keys)
      if (keyBindings.cancel.includes(e.key)) {
        gameManager.cancel();
        return;
      }

      // 2. STAGING MODE (Piece Movement / Actions)
      if (selectedTilePiece && stagingState && turnState.playerTurnIndex === playerIndex) {
        // Restricted to own pieces
        if (selectedTilePiece.owner === 'player') {
          // ENTER -> Commit
          if (e.key === 'Enter') {
            gameManager.select();
            return;
          }

          // Card specific actions
          if (isCard(selectedTilePiece)) {
            if (e.key.toLowerCase() === keyBindings.flipCard.toLowerCase()) {
              gameManager.flipCard();
              return;
            }
            if (e.key.toLowerCase() === keyBindings.changePosition.toLowerCase()) {
              gameManager.orientCard();
              return;
            }
          }

          // Player specific actions
          if (isPlayer(selectedTilePiece)) {
            if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) {
              gameManager.startSummoning();
              return;
            }
          }

          // WASD Movement (Staging)
          if (['w', 'a', 's', 'd'].includes(e.key)) {
            let direction: 'up' | 'down' | 'left' | 'right' | null = null;
            if (e.key === 'w') direction = 'up';
            if (e.key === 's') direction = 'down';
            if (e.key === 'a') direction = 'left';
            if (e.key === 'd') direction = 'right';

            if (direction) {
              gameManager.moveStagedPiece(direction);
              return;
            }
          }
        }
      }

      // 3. CURSOR & MENU NAVIGATION
      const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
      const isWASD = ['w', 'a', 's', 'd'].includes(e.key);

      if (isArrow || isWASD) {
        // Standard Cursor Movement (Only if NOT in staging mode, or if key wasn't consumed by staging)
        if (!selectedTilePiece || !stagingState) {
          let direction: 'up' | 'down' | 'left' | 'right' | null = null;
          if (e.key === 'ArrowUp' || e.key === 'w') direction = 'up';
          if (e.key === 'ArrowDown' || e.key === 's') direction = 'down';
          if (e.key === 'ArrowLeft' || e.key === 'a') direction = 'left';
          if (e.key === 'ArrowRight' || e.key === 'd') direction = 'right';

          if (direction) {
            gameManager.moveCursor(direction);
            return;
          }
        }
      }

      // 4. SELECT
      if (e.key.toLowerCase() === keyBindings.select.toLowerCase()) {
        console.log("select");
        gameManager.select();
        return;
      }

      // 5. VIEW DETAILS
      if (e.key.toLowerCase() === keyBindings.viewDetails.toLowerCase()) {
        gameManager.toggleDetails();
        return;
      }

      // 6. START SUMMON (Global J key)
      if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) {
        gameManager.startSummoning();
        return;
      }
    };

    window.addEventListener('keydown', handleKeydownEvent);
    return () => window.removeEventListener('keydown', handleKeydownEvent);
  }, []);
};
