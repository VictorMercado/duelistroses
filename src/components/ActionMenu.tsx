import { useInputStore } from "@/stores/inputStore";
import { Key } from "@/components/Key";
import { useUIStore } from "@/stores/uiStore";
import { useGameStore } from "@/stores/gameStore";
import { isCard, isPlayer, type Card, type Player } from "@/types";

interface ActionMenuProps {
  // onMove: () => void;
  // onAttack: () => void;
}

export default function ActionMenu({ }: ActionMenuProps) {
  const uiStore = useUIStore();
  const inputStore = useInputStore();
  const gameStore = useGameStore();

  let card: Card | null = null;
  let player: Player | null = null;
  let hasMoved = false;
  // if (!inputStore.selectedTilePiece) return null;
  if (inputStore.selectedTilePiece) {
    if (isCard(inputStore.selectedTilePiece)) {
      card = inputStore.selectedTilePiece;
    } else if (isPlayer(inputStore.selectedTilePiece)) {
      player = inputStore.selectedTilePiece;
    }
    if (gameStore.stagingState) {
      hasMoved = !inputStore.selectedTilePiece.position.equals(gameStore.stagingState.originalPosition);
    }
  }
  
  const viewDetailsHandler = () => {
    if (card) {
      uiStore.setShowDetails(true);
      return;
    }
    if (player) {
      uiStore.setShowPlayerDetails(true);
      return;
    }
  }
  const viewDetailsInHandHandler = () => {
    uiStore.setShowDetails(true);
    return;
  }

  const wasOriginallyFaceUp = gameStore.stagingState?.originalIsFaceDown === false;
  const hasChangedMode = gameStore.stagingState?.hasChangedPosition || false
  const canCommit = hasMoved || hasChangedMode;
  // Allow changing mode even after moving
  const canChangeMode = !hasMoved;
  const canSelect = true;
  const canFlip = !wasOriginallyFaceUp;
  const handMenu = gameStore.showHand;
  const tilePieceMenu = !handMenu && (card || player);
  const defaultMenu = !handMenu && !tilePieceMenu;

  const handMenuActions = () => {
    return (
      <>
        <button
          onClick={gameStore.closeHand}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
          title="Cancel and revert changes (Esc)"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.cancel[0]}</Key>} Cancel
        </button>
        <div className="w-8 flex items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
        <button
          onClick={gameStore.selectCardForSummon}
          disabled={!canSelect}
          className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
            canSelect
              ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canSelect ? "No card selected" : "Select the card (Enter)"}
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.select}</Key>} Select
        </button>
        <button
          onClick={viewDetailsInHandHandler}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.viewDetails}</Key>} Details
        </button>
      </>
    )
  }
  const cardActions = () => {
    if (!card) return null;
    return(
      <>
        {/* Commit Action Button - Green, prominent */}
        <button
          onClick={gameStore.commitAction}
          disabled={!canCommit}
          className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
            canCommit
              ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canCommit ? "No action taken" : "Commit the action (Enter)"}
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.select}</Key>} Commit
        </button>
        
        {/* Cancel Button - Red */}
        <button
          onClick={gameStore.cancelAction}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
          title="Cancel and revert changes (Esc)"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.cancel[0]}</Key>} Cancel
        </button>
        <div className="w-8 flex items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
        <button
          onClick={gameStore.changePosition}
          disabled={!canChangeMode}
          className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
            canChangeMode
              ? 'border-yellow-700 hover:border-yellow-300'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canChangeMode ? "Can't change position after moving" : ""}
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.changePosition}</Key>} {card.isDefenseMode ? "Attack" : "Defense"}
        </button>
        <button
          onClick={gameStore.flipSelectedCard}
          disabled={!canFlip}
          className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
            canFlip
              ? 'border-yellow-700 hover:border-yellow-300'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={
            wasOriginallyFaceUp 
              ? "Can't flip face-up cards back down" 
              : !canFlip 
                ? "Can't flip after moving" 
                : "Toggle face-up/face-down"
          }
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.flipCard}</Key>} Flip
        </button>
        <div className="w-8 flex items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
        <button
          onClick={viewDetailsHandler}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.viewDetails}</Key>} Details
        </button>
      </>
    )
  }
  const playerActions = () => {
    if (!player) return null;
    if (player.owner === 'player') {
      return (
        <>
          {/* Commit Action Button - Green, prominent */}
          <button
            onClick={gameStore.commitAction}
            disabled={!canCommit}
            className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
              canCommit
                ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
                : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
            title={!canCommit ? "No action taken" : "Commit the action (Enter)"}
          >
            {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.select}</Key>} Commit
          </button>
          
          {/* Cancel Button - Red */}
          <button
            onClick={gameStore.cancelAction}
            className="flex items-center gap-x-1 px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
            title="Cancel and revert changes (Esc)"
          >
            {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.cancel[0]}</Key>} Cancel
          </button>
          <div className="w-8 flex items-center h-full justify-center">
            <span className="h-full w-1 bg-black"></span>
          </div>
          <button
              onClick={() => gameStore.showHand ? gameStore.closeHand() : gameStore.openHand()}
              className="flex items-center gap-x-1 px-6 py-2 border-2 border-green-600 bg-green-700 hover:bg-green-600 text-white rounded-lg font-bold transition-colors"
              title={gameStore.showHand ? "Hide your hand" : "View your hand cards"}
          >
              {/* No specific key binding for toggle shown, maybe generic or just text */}
              {gameStore.showHand ? 'Hide Hand' : 'Show Hand'}
          </button> 
          <button
              onClick={() => gameStore.enterSummoningMode()}
              disabled={!gameStore.canSummon()}
              className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
                gameStore.canSummon()
                  ? 'border-purple-600 bg-purple-700 hover:bg-purple-600'
                  : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
              title="Play a card from your hand (J)"
          >
              {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.playCard}</Key>} Play Card
          </button>
          <div className="w-8 flex items-center h-full justify-center">
            <span className="h-full w-1 bg-black"></span>
          </div>
          <button
            onClick={viewDetailsHandler}
            className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
          >
            {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.viewDetails}</Key>} Details
          </button>
        </>
      );
    };
    return(
      <>
        <button
          onClick={gameStore.cancelAction}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
          title="Cancel and revert changes (Esc)"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.cancel[0]}</Key>} Cancel
        </button>
        <button
          onClick={viewDetailsHandler}
          className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
        >
          {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.viewDetails}</Key>} Details
        </button>
      </>
    )
  }
  const tilePieceMenuActions = () => {
    return(
      <>
        { card && cardActions()}
        {player && playerActions()}
      </>      
    )
  }
  const defaultMenuActions = () => {
    return (
      <>
        <button
            onClick={() => gameStore.enterSummoningMode()}
            disabled={!gameStore.canSummon()}
            className={`flex items-center gap-x-1 px-6 py-2 border-2 rounded-lg font-bold transition-colors ${
              gameStore.canSummon()
                ? 'border-yellow-700 hover:bg-yellow-700'
                : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
            title="Play a card from your hand (J)"
        >
            {uiStore.showKeyBindings && <Key>{inputStore.keyBindings.playCard}</Key>} Play Card
        </button>
      </>
    )
  }
  return (
    <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 yugiohGradientBackground bg-opacity-80 p-4 rounded-xl flex gap-4 h-20 backdrop-blur-sm border-2 border-yellow-700 shadow-2xl">
      {handMenu && handMenuActions()}
      {tilePieceMenu && tilePieceMenuActions()}
      {defaultMenu && defaultMenuActions()}
    </div>
  );
}
