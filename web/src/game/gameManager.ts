import { Vector3 } from 'three';
import { useGameStore } from '@/stores/gameStore';
import { useUIStore } from '@/stores/uiStore';
import { isCard, isPlayer, type Card, type StagingState, type Tile, type TilePiece } from '@/types';
import {
  X_AXIS_NEGATIVE_MAX,
  X_AXIS_POSITIVE_MAX,
  Y_AXIS_NEGATIVE_MAX,
  Y_AXIS_POSITIVE_MAX
} from "@/const";

class GameManager {
  private static instance: GameManager;

  private constructor() { }

  public static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  // --- HELPERS ---
  public canSummon() {
    const { stagingState } = this.gameStore;
    return !stagingState && this.isUsersTurn();
  }
  public getPieceKey(piece: TilePiece) {
    return `${piece.id}`;
  }
  public hasActedThisTurn(piece: TilePiece) {
    const key = this.getPieceKey(piece);
    return this.turnState.actedPieceIds.includes(key);
  }
  public isUsersTurn() {
    const { playerIndex, turnState } = this.gameStore;
    const player = this.gameStore.players[playerIndex];
    if (!player) return false;
    return turnState.playerTurnIndex === playerIndex;
  }
  public isUsersPiece(piece: TilePiece) {
    return piece.owner === "player";
  }
  // --- GETTERS (Convenience) ---
  private get gameStore() {
    return useGameStore.getState();
  }

  private get uiStore() {
    return useUIStore.getState();
  }
  // --- Getters ---
  public get turnState() {
    return this.gameStore.turnState;
  }
  public get playerIndex() {
    return this.gameStore.playerIndex;
  }
  public get player() {
    return this.gameStore.players[this.gameStore.playerIndex];
  }
  public get cards() {
    return this.gameStore.cards;
  }
  public get players() {
    return this.gameStore.players;
  }
  public get summoningState() {
    return this.gameStore.summoningState;
  }
  public get stagingState() {
    return this.gameStore.stagingState;
  }
  public get selectedTilePiece() {
    return this.gameStore.selectedTilePiece;
  }
  public get selectedTile() {
    return this.gameStore.selectedTile;
  }
  public get showHand() {
    return this.gameStore.showHand;
  }
  // --- PRIVATE ACTIONS ---
  private actThisTurn(piece: TilePiece) {
    const key = this.getPieceKey(piece);
    this.gameStore.updateTurnState({
      ...this.turnState,
      actedPieceIds: [...this.turnState.actedPieceIds, key]
    });
  }
  private selectTilePiece(piece: TilePiece) {
    this.gameStore.updateSelectedTilePiece(piece);
  }
  private initStaging(piece: TilePiece) {
    if (!piece) return;
    if (!this.isUsersPiece(piece)) return;
    const newStagingState: StagingState = {
      pieceId: piece.id,
      originalPosition: piece.position.clone(),
      hasMoved: false,
      hasFlipped: false,
      hasChangedPosition: false
    };

    if (isCard(piece)) {
      newStagingState.originalIsFaceDown = piece.isFaceDown;
      newStagingState.originalIsDefenseMode = piece.isDefenseMode;
    }

    this.gameStore.updateStagingState(newStagingState);
  }

  private commitStagingAction(piece: TilePiece) {
    // Mark piece as having acted
    this.actThisTurn(piece);
    this.gameStore.updateStagingState(null);
    this.gameStore.updateSelectedTilePiece(null);
  }

  private cancelStagingAction() {
    const { stagingState } = this.gameStore;
    if (!stagingState) return;

    const piece = [
      ...this.gameStore.cards,
      ...this.gameStore.players
    ].find(p => p.id === stagingState.pieceId);

    if (!piece) return;
    let reverted = { ...piece, position: stagingState.originalPosition };

    if (isCard(reverted) && stagingState.originalIsFaceDown !== undefined) {
      reverted.isFaceDown = stagingState.originalIsFaceDown;
    }
    if (isCard(reverted) && stagingState.originalIsDefenseMode !== undefined) {
      reverted.isDefenseMode = stagingState.originalIsDefenseMode;
    }
    this.gameStore.updateTilePiece(reverted);
    this.gameStore.updateStagingState(null);
    this.gameStore.updateSelectedTilePiece(null);
  }

  private cancelSummoning() {
    if (!this.isUsersTurn()) return;
    const { summoningState } = this.gameStore;
    if (!summoningState) return;

    this.gameStore.updateSummoningState(null);
    this.gameStore.closeHand();
    this.gameStore.setHandSelectedIndex(-1);
  }

  private confirmSummonTarget(mouseClick?: Vector3) {
    const { summoningState, cursorPosition } = this.gameStore;
    if (!summoningState || summoningState.phase !== 'target') return;

    const cursor = mouseClick || cursorPosition;
    const target = new Vector3(cursor.x, cursor.y, 0.06);

    // Validate position
    const validPositions = this.gameStore.getValidSummonPositions();
    const isValid = validPositions.some((p: Vector3) => p.x === cursor.x && p.y === cursor.y);

    if (isValid) {
      this.gameStore.updateSummoningState({
        ...summoningState,
        phase: 'card',
        targetTile: target
      });
      this.openHand();
    }
  }

  private selectCardForSummon(card?: Card) {
    const { summoningState, handCards, handSelectedIndex } = this.gameStore;
    if (!summoningState || summoningState.phase !== 'card') return;
    let selectedIndex = handSelectedIndex;
    if (card) {
      selectedIndex = handCards.findIndex(c => c.id === card.id);
    }
    if (selectedIndex >= 0 && selectedIndex < handCards.length) {
      const card = handCards[selectedIndex];
      this.gameStore.updateSummoningState({
        ...summoningState,
        phase: 'confirm',
        selectedCardId: card.id
      });
      this.gameStore.closeHand(); // Hide hand to show preview
    }
  }

  private confirmSummon() {
    const { summoningState, handCards, playerIndex } = this.gameStore;
    if (!summoningState) return;
    const { selectedCardId, targetTile } = summoningState;

    if (!selectedCardId || !targetTile) return;

    const card = handCards.find(c => c.id === selectedCardId);
    if (!card) return;

    const finalCard = {
      ...card,
      isFaceDown: true,
      isDefenseMode: false,
      position: targetTile
    };

    this.summonCard(finalCard, playerIndex);
  }

  private summonCard(card: Card, playerIndex: number) {
    const { cards, handCards, summoningState, players } = this.gameStore;

    if (!summoningState || summoningState.phase !== 'confirm' || !summoningState.targetTile) return;

    if (!this.isUsersTurn()) return;

    const handIndex = players[playerIndex].hand.indexOf(card.id);
    if (handIndex === -1) return;

    const newHandIds = [...players[playerIndex].hand];
    newHandIds.splice(handIndex, 1);
    const updatedPlayer = {
      ...players[playerIndex],
      hand: newHandIds,
      cardsInPlay: [...players[playerIndex].cardsInPlay, card.id]
    };
    const newHandCards = handCards.filter(c => c.id !== card.id);
    const summonedCard: Card = {
      ...card,
      position: summoningState.targetTile,
      // isFaceDown and isDefenseMode are now taken from the passed 'card' object
      // which allows confirmSummonPosition to set them correctly.
      // If called directly with a hand card, it will use that card's state (usually Face Up Attack).
    };

    this.gameStore.updatePlayer(updatedPlayer);
    this.gameStore.updateHandCards(newHandCards);
    this.gameStore.updateSummoningState(null);
    this.gameStore.updateCards([...cards, summonedCard]);
    this.gameStore.setCursorPosition({
      x: summoningState.targetTile.x,
      y: summoningState.targetTile.y
    });
    this.gameStore.updateSelectedTilePiece(null);
  }

  // --- PUBLIC ACTIONS ---
  public flipCard() {
    if (!this.isUsersTurn()) return;
    const { selectedTilePiece, stagingState, cards } = this.gameStore;

    if (!selectedTilePiece || !isCard(selectedTilePiece)) return;
    if (!stagingState) return;

    // Get fresh piece data
    const currentPiece = cards.find(p => p.id === selectedTilePiece.id);
    if (!currentPiece) return;

    // Rule: Can't flip back down if originally face up
    if (stagingState.originalIsFaceDown === false) {
      return;
    }

    const updated = { ...currentPiece, isFaceDown: !currentPiece.isFaceDown };
    this.gameStore.updateTilePiece(updated);
    this.gameStore.updateSelectedTilePiece(updated);
    const isDifferentFromOriginal = stagingState.originalIsFaceDown !== undefined &&
      updated.isFaceDown !== stagingState.originalIsFaceDown;
    this.gameStore.updateStagingState({
      ...stagingState,
      hasFlipped: isDifferentFromOriginal
    });
  }

  public orientCard() {
    if (!this.isUsersTurn()) return;
    const { selectedTilePiece, stagingState } = this.gameStore;

    if (!selectedTilePiece || !isCard(selectedTilePiece) || !stagingState) return;

    // Rule: Can only change position if we haven't moved
    if (!selectedTilePiece.position.equals(stagingState.originalPosition)) return;

    const updated = { ...selectedTilePiece, isDefenseMode: !selectedTilePiece.isDefenseMode };
    this.gameStore.updateTilePiece(updated);
    this.gameStore.updateSelectedTilePiece(updated);
    const isDifferentFromOriginal = stagingState.originalIsDefenseMode !== undefined &&
      updated.isDefenseMode !== stagingState.originalIsDefenseMode;
    this.gameStore.updateStagingState({
      ...stagingState,
      hasChangedPosition: isDifferentFromOriginal
    });
  }
  public openHand() {
    this.gameStore.openHand();
  }
  public closeHand() {
    this.gameStore.closeHand();
  }
  public startSummoning() {
    if (!this.isUsersTurn()) return;
    const { stagingState, playerIndex, turnState } = this.gameStore;
    const player = this.gameStore.players[playerIndex];
    if (!player) return;
    if (turnState.playerTurnIndex !== playerIndex) return;
    if (stagingState) return;

    this.gameStore.updateSummoningState({
      phase: 'target',
      targetTile: null,
      selectedCardId: null,
      playerIndex
    });
    this.gameStore.setCursorPosition({
      x: player.position.x,
      y: player.position.y
    });
  }

  public select(piece?: TilePiece, pos?: Vector3, tile?: Tile) {
    pos && this.gameStore.setCursorPosition({ x: pos.x, y: pos.y });

    if (tile) {
      this.gameStore.updateSelectedTile(tile);
      this.gameStore.setCursorPosition({
        x: tile.position.x,
        y: tile.position.y
      });
      this.gameStore.updateSelectedTilePiece(null);
      this.cancelStagingAction();
      return;
    }

    const { cursorPosition } = this.gameStore;
    const { selectedTilePiece, summoningState, stagingState, cards, players } = this.gameStore;
    // check for mouse click or keyboard cursor navigation
    const targetX = pos?.x ?? cursorPosition.x;
    const targetY = pos?.y ?? cursorPosition.y;

    // Summoning Confirmations - Delegating to methods that now contain validation
    if (summoningState) {
      const { phase } = summoningState;

      // Restrict Interaction: During 'card' or 'confirm' phases, disallow clicking tiles/positions directly.
      // We only allow interaction via the UI buttons or keyboard Enter (which passes no args).
      if ((phase === 'card' || phase === 'confirm') && (tile || pos)) {
        return;
      }

      if (phase === 'target') {
        this.confirmSummonTarget(pos);
      } else if (phase === 'card') {
        const card = piece as Card;
        this.selectCardForSummon(card);
      } else if (phase === 'confirm') {
        this.confirmSummon();
      }
      return;
    }
    // Commit Action if Staging
    if (selectedTilePiece && stagingState && !this.hasActedThisTurn(selectedTilePiece)) {
      const isSamePos = Math.round(selectedTilePiece.position.x) === targetX &&
        Math.round(selectedTilePiece.position.y) === targetY;

      if (isSamePos) {
        // Prevent committing if we haven't actually moved from the start
        // const isAtOriginal = Math.round(stagingState.originalPosition.x) === targetX &&
        //   Math.round(stagingState.originalPosition.y) === targetY;

        // if (isAtOriginal) {
        //   return;
        // }

        this.commitStagingAction(selectedTilePiece);
        return;
      }

      // Check if it's a valid move (Mouse click on yellow tile)
      const validPositions = this.gameStore.getValidMovePositions();
      const isValidMove = validPositions.some(([x, y]) => x === targetX && y === targetY);

      if (isValidMove) {
        // Move the piece instead of committing
        this.performStagingMove(new Vector3(targetX, targetY, selectedTilePiece.position.z));
        return;
      }
    }
    // If clicking the same piece, do nothing
    if (piece && piece.id === selectedTilePiece?.id) return;
    // mouse click card and not users turn just select
    if (!this.isUsersTurn()) {
      if (piece) {
        this.selectTilePiece(piece);
        return;
      }
      const pieceAtCursor = [...cards, ...players].find(piece =>
        Math.round(piece.position.x) === targetX &&
        Math.round(piece.position.y) === targetY
      );
      // could be null if cursor is not on a tile piece
      pieceAtCursor && this.selectTilePiece(pieceAtCursor);
      return;
    }

    if (piece && !this.hasActedThisTurn(piece)) {
      this.selectTilePiece(piece);
      this.initStaging(piece);
      return;
    }
    // Select Piece at Cursor
    const pieceAtCursor = [...cards, ...players].find(piece =>
      Math.round(piece.position.x) === cursorPosition.x &&
      Math.round(piece.position.y) === cursorPosition.y
    );
    if (pieceAtCursor && !this.hasActedThisTurn(pieceAtCursor)) {
      this.selectTilePiece(pieceAtCursor);
      this.initStaging(pieceAtCursor);
    }
    piece && this.selectTilePiece(piece);
    pieceAtCursor && this.selectTilePiece(pieceAtCursor);
  }

  public cancel() {
    if (!this.isUsersTurn()) return;
    const { summoningState, showHand } = this.gameStore;

    if (summoningState) {
      if (summoningState.phase === 'confirm') {
        this.gameStore.returnToHand();
        return;
      }
      if (summoningState.phase === 'card') {
        this.gameStore.returnToTarget();
        return;
      }
      this.cancelSummoning();
      return;
    }

    if (showHand) {
      this.closeHand();
      return;
    }

    // Default cancel behavior
    if (this.gameStore.selectedTilePiece) {
      this.cancelStagingAction();
      this.gameStore.updateSelectedTilePiece(null);
      this.uiStore.setShowDetails(false);
      return;
    }
  }

  private performStagingMove(newPosition: Vector3) {
    const { selectedTilePiece, stagingState } = this.gameStore;
    if (!selectedTilePiece || !stagingState) return;

    const freshCards = this.gameStore.cards;
    const freshPlayers = this.gameStore.players;
    const currentPiece = [...freshCards, ...freshPlayers].find(
      p => p.id === selectedTilePiece.id &&
        (isCard(p) === isCard(selectedTilePiece))
    );

    if (!currentPiece) return;

    if (isCard(currentPiece)) {
      // Yu-Gi-Oh rule: Move -> Attack Position
      const updatedCard = { ...currentPiece, position: newPosition, isDefenseMode: false };
      this.gameStore.updateTilePiece(updatedCard);
      this.gameStore.updateSelectedTilePiece(updatedCard);

      // Reset hasChangedPosition
      useGameStore.setState((state) => ({
        stagingState: state.stagingState
          ? { ...state.stagingState, hasChangedPosition: false }
          : null
      }));
    } else {
      const updatedPlayer = { ...currentPiece, position: newPosition };
      this.gameStore.updateTilePiece(updatedPlayer);
      this.gameStore.updateSelectedTilePiece(updatedPlayer);
    }

    // Update cursor to follow
    this.gameStore.setCursorPosition({
      x: Math.round(newPosition.x),
      y: Math.round(newPosition.y)
    });
  }

  public moveStagedPiece(direction: 'up' | 'down' | 'left' | 'right') {
    const { stagingState, selectedTilePiece } = this.gameStore;

    // Must have a selected piece and be in staging mode
    if (!selectedTilePiece || !stagingState) return;
    if (selectedTilePiece.owner !== 'player') return;

    const freshCards = this.gameStore.cards;
    const freshPlayers = this.gameStore.players;
    const currentPiece = [...freshCards, ...freshPlayers].find(
      p => p.id === selectedTilePiece.id &&
        (isCard(p) === isCard(selectedTilePiece))
    );

    if (!currentPiece) return;

    const newPosition = currentPiece.position.clone();
    let moved = false;

    switch (direction) {
      case 'up':
        newPosition.y = Math.min(newPosition.y + 1, Y_AXIS_POSITIVE_MAX);
        moved = true;
        break;
      case 'down':
        newPosition.y = Math.max(newPosition.y - 1, Y_AXIS_NEGATIVE_MAX);
        moved = true;
        break;
      case 'left':
        newPosition.x = Math.max(newPosition.x - 1, X_AXIS_NEGATIVE_MAX);
        moved = true;
        break;
      case 'right':
        newPosition.x = Math.min(newPosition.x + 1, X_AXIS_POSITIVE_MAX);
        moved = true;
        break;
    }

    if (moved) {
      // Get valid move positions from gameStore
      const validPositions = this.gameStore.getValidMovePositions();
      const targetX = Math.round(newPosition.x);
      const targetY = Math.round(newPosition.y);

      // Check validation
      const isValidMove = validPositions.some(([x, y]) => x === targetX && y === targetY);

      if (isValidMove) {
        this.performStagingMove(newPosition);
      }
    }
  }

  public moveCursor(direction: 'up' | 'down' | 'left' | 'right') {
    const gameStore = this.gameStore;
    const { cursorPosition } = gameStore;

    const validPositions = gameStore.getValidMovePositions();
    const isInStagingMode = gameStore.selectedTilePiece && gameStore.stagingState;

    // HAND NAVIGATION
    if (gameStore.showHand) {
      if (direction === 'left' || direction === 'right') {
        const handSize = gameStore.handCards.length;
        if (handSize === 0) return;

        let newIndex = gameStore.handSelectedIndex;
        if (newIndex === -1) newIndex = 0; // Initialize selection if none

        if (direction === 'left') {
          newIndex = Math.max(0, newIndex - 1);
        } else {
          newIndex = Math.min(handSize - 1, newIndex + 1);
        }
        gameStore.setHandSelectedIndex(newIndex);
      }
      return;
    }

    // SUMMONING MODE BOARD NAVIGATION
    if (gameStore.summoningState) {
      if (gameStore.summoningState.phase === 'confirm') return;

      let newX = cursorPosition.x;
      let newY = cursorPosition.y;

      switch (direction) {
        case 'up': newY += 1; break;
        case 'down': newY -= 1; break;
        case 'left': newX -= 1; break;
        case 'right': newX += 1; break;
      }

      const validSummonPositions = gameStore.getValidSummonPositions();
      const isValid = validSummonPositions.some(([x, y]) => x === newX && y === newY);

      if (isValid) {
        gameStore.setCursorPosition({ x: newX, y: newY });
      }
      return;
    }

    let newX = cursorPosition.x;
    let newY = cursorPosition.y;

    switch (direction) {
      case 'up':
        newY = Math.min(Y_AXIS_POSITIVE_MAX, cursorPosition.y + 1);
        break;
      case 'down':
        newY = Math.max(Y_AXIS_NEGATIVE_MAX, cursorPosition.y - 1);
        break;
      case 'left':
        newX = Math.max(X_AXIS_NEGATIVE_MAX, cursorPosition.x - 1);
        break;
      case 'right':
        newX = Math.min(X_AXIS_POSITIVE_MAX, cursorPosition.x + 1);
        break;
    }

    // Only move if not in staging mode OR the position is valid
    const isValidPosition = validPositions.some(([x, y]) => x === newX && y === newY);
    if (!isInStagingMode || isValidPosition) {
      gameStore.setCursorPosition({ x: newX, y: newY });
    }
    const tileAtCursor = gameStore.tiles.find(t =>
      Math.round(t.position.x) === newX &&
      Math.round(t.position.y) === newY
    );
    tileAtCursor && gameStore.updateSelectedTile(tileAtCursor);
  }

  public toggleDetails() {
    const { handSelectedIndex } = this.gameStore;
    const { showHand, summoningState, selectedTilePiece } = this.gameStore;

    const isHandOpen = showHand || (summoningState && summoningState.phase === 'card');

    if (isHandOpen && handSelectedIndex >= 0) {
      this.uiStore.setShowDetails(true);
      return;
    }

    if (selectedTilePiece) {
      if (isCard(selectedTilePiece)) {
        this.uiStore.setShowDetails(true);
      } else if (isPlayer(selectedTilePiece)) {
        this.uiStore.setShowPlayerDetails(true);
      }
    }
  }
}

export const gameManager = GameManager.getInstance();