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
  const selectedTilePiece = useInputStore((state) => state.selectedTilePiece);
  const gameStore = useGameStore();

  let card: Card | null = null;
  let player: Player | null = null;
  if (!selectedTilePiece) {
    return null;
  }
  if (isCard(selectedTilePiece)) {
    card = selectedTilePiece;
  } 
  if (isPlayer(selectedTilePiece)) {
    player = selectedTilePiece;
  }

  const hasMoved = gameStore.stagingState
              ? !selectedTilePiece.position.equals(gameStore.stagingState.originalPosition)
              : false
  const wasOriginallyFaceUp = gameStore.stagingState?.originalIsFaceDown === false;
  const hasChangedMode = gameStore.stagingState?.hasChangedPosition || false
  const canCommit = hasMoved || hasChangedMode;
  // Allow changing mode even after moving
  const canChangeMode = !hasMoved;

  const canFlip = !wasOriginallyFaceUp;
  const keyBindings = useInputStore((state) => state.keyBindings);

  return (
    <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 yugiohGradientBackground bg-opacity-80 p-4 rounded-xl flex gap-4 h-20 backdrop-blur-sm border-2 border-yellow-700 shadow-2xl">
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
        {uiStore.showKeyBindings && <Key>{keyBindings.select}</Key>} Commit
      </button>
      
      {/* Cancel Button - Red */}
      <button
        onClick={gameStore.cancelAction}
        className="flex items-center gap-x-1 px-6 py-2 border-2 border-red-600 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold transition-colors"
        title="Cancel and revert changes (Esc)"
      >
        {uiStore.showKeyBindings && <Key>{keyBindings.cancel[0]}</Key>} Cancel
      </button>
      
      <div className="w-8 flex items-center h-full justify-center">
        <span className="h-full w-1 bg-black"></span>
      </div>
      
      { card && (
        <>
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
            {uiStore.showKeyBindings && <Key>{keyBindings.changePosition}</Key>} {card.isDefenseMode ? "Attack" : "Defense"}
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
            {uiStore.showKeyBindings && <Key>{keyBindings.flipCard}</Key>} Flip
          </button>
          
          <div className="w-8 flex items-center h-full justify-center">
            <span className="h-full w-1 bg-black"></span>
          </div>
          
          <button
            onClick={() => uiStore.setShowDetails(true)}
            className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
          >
            {uiStore.showKeyBindings && <Key>{keyBindings.viewDetails}</Key>} Details
          </button>  
        </>
      )}
      {player && (
        <>
          <button
            onClick={() => gameStore.openHand()}
            className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
          >
            {uiStore.showKeyBindings && <Key>{keyBindings.playCard}</Key>} Hand
          </button> 
          <button
            onClick={() => uiStore.setShowDetails(true)}
            className="flex items-center gap-x-1 px-6 py-2 border-2 border-yellow-700 hover:border-yellow-300 rounded-lg font-bold transition-colors"
          >
            {uiStore.showKeyBindings && <Key>{keyBindings.viewDetails}</Key>} Details
          </button> 
        </>
      )}
    </div>
  );
}
