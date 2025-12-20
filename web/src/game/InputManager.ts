import { gameManager } from './gameManager';
import { useGameStore } from '@/stores/gameStore';
import { isCard, isPlayer, type KeyBindings, type Tile, type TilePiece } from '@/types';
import { Vector3 } from 'three';

export type InputAction =
  | 'SELECT'
  | 'CANCEL'
  | 'MOVE_UP'
  | 'MOVE_DOWN'
  | 'MOVE_LEFT'
  | 'MOVE_RIGHT'
  | 'DETAILS'
  | 'PLAY_CARD'
  | 'FLIP'
  | 'CHANGE_POSITION';

export class InputManager {
  private static instance: InputManager;

  private constructor() { }

  public static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  public handleKeyboardEvent(e: KeyboardEvent, keyBindings: KeyBindings) {
    const action = this.mapKeyboardEventToAction(e, keyBindings);
    if (action) {
      this.executeAction(action);
    }
  }

  public handleInteraction(action: InputAction, payload?: { piece?: TilePiece, pos?: Vector3, tile?: Tile; }) {
    this.executeAction(action, payload);
  }

  private mapKeyboardEventToAction(e: KeyboardEvent, keyBindings: KeyBindings): InputAction | null {
    // 1. CANCEL
    if (keyBindings.cancel.includes(e.key)) return 'CANCEL';

    const { selectedTilePiece, stagingState, turnState, playerIndex } = useGameStore.getState();
    const isStaging = selectedTilePiece && stagingState && turnState.playerTurnIndex === playerIndex && selectedTilePiece.owner === 'player';

    // 2. STAGING MODE SPECIFIC
    if (isStaging) {
      if (e.key === 'Enter') return 'SELECT';

      if (isCard(selectedTilePiece)) {
        if (e.key.toLowerCase() === keyBindings.flipCard.toLowerCase()) return 'FLIP';
        if (e.key.toLowerCase() === keyBindings.changePosition.toLowerCase()) return 'CHANGE_POSITION';
      }

      if (isPlayer(selectedTilePiece)) {
        if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) return 'PLAY_CARD';
      }

      // WASD Staging Movement
      if (e.key === 'w') return 'MOVE_UP';
      if (e.key === 's') return 'MOVE_DOWN';
      if (e.key === 'a') return 'MOVE_LEFT';
      if (e.key === 'd') return 'MOVE_RIGHT';
    }

    // 3. CURSOR NAVIGATION (WASD + Arrows)
    // If we are NOT staging, OR if the key wasn't caught above (e.g. arrow keys)
    // Logic from previous handler: "Standard Cursor Movement (Only if NOT in staging mode, or if key wasn't consumed by staging)"
    // Actually, in previous code, WASD moved piece if staging, moved cursor if not.
    // Here, if isStaging is true, 'w' returns MOVE_UP which executes moveStagedPiece.
    // If isStaging is false, 'w' should return MOVE_UP which executes moveCursor.
    // So the Mapping is the same, but the Execution differs based on state?
    // OR we map to different actions like MOVE_CURSOR_UP vs MOVE_PIECE_UP?
    // User wants "input manager... then process it".
    // I think mapping to generic MOVE_UP is fine, executeAction determines context.

    // However, we need to support Arrow keys too.
    if (['w', 'ArrowUp', keyBindings.cursorUp].includes(e.key)) return 'MOVE_UP';
    if (['s', 'ArrowDown', keyBindings.cursorDown].includes(e.key)) return 'MOVE_DOWN';
    if (['a', 'ArrowLeft', keyBindings.cursorLeft].includes(e.key)) return 'MOVE_LEFT';
    if (['d', 'ArrowRight', keyBindings.cursorRight].includes(e.key)) return 'MOVE_RIGHT';

    // 4. GENERAL ACTIONS
    if (e.key.toLowerCase() === keyBindings.select.toLowerCase()) return 'SELECT';
    if (e.key.toLowerCase() === keyBindings.viewDetails.toLowerCase()) return 'DETAILS';
    if (e.key.toLowerCase() === keyBindings.playCard.toLowerCase()) return 'PLAY_CARD';

    return null;
  }

  private executeAction(action: InputAction, payload?: { piece?: TilePiece, pos?: Vector3, tile?: Tile; }) {
    const { stagingState, selectedTilePiece } = useGameStore.getState();

    // We check context here to decide between moving cursor or moving piece
    const isStagingMovement = selectedTilePiece && stagingState && selectedTilePiece.owner === 'player';

    switch (action) {
      case 'CANCEL':
        gameManager.cancel();
        break;
      case 'SELECT':
        if (payload) {
          gameManager.select(payload.piece, payload.pos, payload.tile);
        } else {
          gameManager.select();
        }
        break;
      case 'MOVE_UP':
        if (isStagingMovement) gameManager.moveStagedPiece('up');
        else gameManager.moveCursor('up');
        break;
      case 'MOVE_DOWN':
        if (isStagingMovement) gameManager.moveStagedPiece('down');
        else gameManager.moveCursor('down');
        break;
      case 'MOVE_LEFT':
        if (isStagingMovement) gameManager.moveStagedPiece('left');
        else gameManager.moveCursor('left');
        break;
      case 'MOVE_RIGHT':
        if (isStagingMovement) gameManager.moveStagedPiece('right');
        else gameManager.moveCursor('right');
        break;
      case 'DETAILS':
        gameManager.toggleDetails();
        break;
      case 'PLAY_CARD':
        gameManager.startSummoning();
        break;
      case 'FLIP':
        gameManager.flipCard();
        break;
      case 'CHANGE_POSITION':
        gameManager.orientCard();
        break;
    }
  }
}
