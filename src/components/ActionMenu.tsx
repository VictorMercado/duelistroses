import { Key } from "@/components/Key";
import { useUIStore } from "@/stores/uiStore";
import { isCard, isPlayer, type Card, type Player } from "@/types";
import { gameManager } from "@/game/GameManager";
import { useKeyBindings } from "@/hooks/useKeyBindings";
import { useGameStore } from "@/stores/gameStore";

interface ActionMenuProps {
  // onMove: () => void;
  // onAttack: () => void;
}

export default function ActionMenu({ }: ActionMenuProps) {
  const uiStore = useUIStore();
  const selectedTilePiece = useGameStore((state)=> state.selectedTilePiece);
  const {keyBindings} = useKeyBindings();

  let card: Card | null = null;
  let player: Player | null = null;
  let hasMoved = false;
  let canAct = true;
  let isUsersPiece = false;
  // if (!inputStore.selectedTilePiece) return null;
  if (selectedTilePiece) {
    if (isCard(selectedTilePiece)) {
      card = selectedTilePiece;
    } else if (isPlayer(selectedTilePiece)) {
      player = selectedTilePiece;
    }
    if (gameManager.stagingState) {
      hasMoved = !selectedTilePiece.position.equals(gameManager.stagingState.originalPosition);
    }
    canAct = !gameManager.hasActedThisTurn(selectedTilePiece);
    isUsersPiece = gameManager.isUsersPiece(selectedTilePiece);
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

  const wasOriginallyFaceUp = gameManager.stagingState?.originalIsFaceDown === false;
  const hasChangedMode = gameManager.stagingState?.hasChangedPosition || false
  const canCommit = hasMoved || hasChangedMode;
  // Allow changing mode even after moving
  const canChangeMode = !hasMoved;
  const canSelect = true;
  const canFlip = !wasOriginallyFaceUp;
  const handMenu = gameManager.showHand;
  const tilePieceMenu = !handMenu && (card || player);
  const defaultMenu = !handMenu && !tilePieceMenu;

  const handMenuActions = () => {
    return (
      <>
        <button
          onClick={() => gameManager.closeHand()}
          className="flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors"
          title="Cancel and revert changes (Esc)"
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.cancel[0]}</Key>} 
          Cancel
        </button>
        <div className="hidden md:flex w-8 items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
        <button
          onClick={() => gameManager.select()}
          disabled={!canSelect}
          className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
            canSelect
              ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canSelect ? "No card selected" : "Select the card (Enter)"}
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.select}</Key>} 
          Select
        </button>
        <button
          onClick={viewDetailsInHandHandler}
          className="flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 border-yellow-700 hover:border-yellow-300 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors"
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.viewDetails}</Key>} 
          Details
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
          onClick={() => gameManager.select()}
          disabled={!canCommit}
          className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
            canCommit
              ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canCommit ? "No action taken" : "Commit the action (Enter)"}
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.select}</Key>} 
          Commit
        </button>
        
        <div className="hidden md:flex w-8 items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
        <button
          onClick={() => gameManager.orientCard()}
          disabled={!canChangeMode}
          className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
            canChangeMode
              ? 'border-yellow-700 hover:border-yellow-300'
              : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={!canChangeMode ? "Can't change position after moving" : ""}
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.changePosition}</Key>} 
          {card.isDefenseMode ? "Attack" : "Defense"}
        </button>
        <button
          onClick={() => gameManager.flipCard()}
          disabled={!canFlip}
          className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
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
          {uiStore.showKeyBindings && <Key>{keyBindings.flipCard}</Key>} 
          Flip
        </button>
        <div className="hidden md:flex w-8 items-center h-full justify-center">
          <span className="h-full w-1 bg-black"></span>
        </div>
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
            onClick={() => gameManager.select()}
            disabled={!canCommit}
            className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
              canCommit
                ? 'border-green-600 bg-green-700 hover:bg-green-600 text-white'
                : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
            title={!canCommit ? "No action taken" : "Commit the action (Enter)"}
          >
            {uiStore.showKeyBindings && <Key>{keyBindings.select}</Key>} 
            Commit
          </button>
          <div className="hidden md:flex w-8 items-center h-full justify-center">
            <span className="h-full w-1 bg-black"></span>
          </div>
          <button
              onClick={() => gameManager.showHand ? gameManager.closeHand() : gameManager.openHand()}
              className="flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 border-green-600 bg-green-700 hover:bg-green-600 text-white rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors"
              title={gameManager.showHand ? "Hide your hand" : "View your hand cards"}
          >
              {/* No specific key binding for toggle shown, maybe generic or just text */}
              {gameManager.showHand ? 'Hide Hand' : 'Show Hand'}
          </button> 
          <button
              onClick={() => gameManager.startSummoning()}
              disabled={!gameManager.canSummon()}
              className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
                gameManager.canSummon()
                  ? 'border-purple-600 bg-purple-700 hover:bg-purple-600'
                  : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
              title="Play a card from your hand (J)"
          >
              {uiStore.showKeyBindings && <Key>{keyBindings.playCard}</Key>} 
              Play Card
          </button>
          <div className="hidden md:flex w-8 items-center h-full justify-center">
            <span className="h-full w-1 bg-black"></span>
          </div>
        </>
      );
    };
    return(null)
  }
  const tilePieceMenuActions = () => {
    return(
      <>
        <button
          onClick={() => gameManager.cancel()}
          className="flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors"
          title="Cancel and revert changes (Esc)"
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.cancel[0]}</Key>} 
          Cancel
        </button>
        {isUsersPiece && canAct && card && cardActions()}
        {isUsersPiece && canAct && player && playerActions()}
        <button
          onClick={viewDetailsHandler}
          className="flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 border-yellow-700 hover:border-yellow-300 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors"
        >
          {uiStore.showKeyBindings && <Key>{keyBindings.viewDetails}</Key>} 
          Details
        </button>
      </>      
    )
  }
  const defaultMenuActions = () => {
    return (
      <>
          <button
            onClick={() => gameManager.startSummoning()}
            disabled={!gameManager.canSummon()}
            className={`flex items-center justify-center gap-x-1 px-2 py-2 md:px-6 md:py-2 border md:border-2 rounded-md md:rounded-lg text-sm md:text-base font-bold transition-colors ${
              gameManager.canSummon()
                ? 'border-yellow-700 hover:bg-yellow-700'
                : 'border-gray-600 bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
            title="Play a card from your hand (J)"
        >
            {uiStore.showKeyBindings && <Key>{keyBindings.playCard}</Key>} Play Card
        </button>
      </>
    )
  }
  return (
    <div className="absolute bottom-4 md:bottom-8 left-1/2 transform -translate-x-1/2 yugiohGradientBackground bg-opacity-90 md:bg-opacity-80 p-2 md:p-4 rounded-lg md:rounded-xl grid grid-cols-3 md:flex w-[95%] md:w-auto gap-2 md:gap-4 h-auto md:h-20 backdrop-blur-sm border md:border-2 border-yellow-700 shadow-2xl z-50">
      {handMenu && handMenuActions()}
      {tilePieceMenu && tilePieceMenuActions()}
      {defaultMenu && defaultMenuActions()}
    </div>
  );
}
