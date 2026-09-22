import { Vector3 } from 'three';
import { useGameStore } from '@/stores/gameStore';
import { useNetStore } from '@/stores/netStore';
import { GameSocket, type ConnectOptions, type ConnectionStatus } from './gameSocket';
import { toNetVector3 } from './mappers';
import {
  NetEvent,
  type CardChangedPositionPayload,
  type EndTurnPayload,
  type ErrorPayload,
  type IncomingMessage,
  type InitStatePayload,
  type MoveCardPayload,
  type NetRole,
  type UserPayload,
} from './protocol';

interface PendingMove {
  cardId: number;
  from: Vector3;
  to: Vector3;
}

/**
 * Bridges the websocket transport and the game stores.
 *
 * Moves are applied optimistically so the local board stays responsive, and the
 * server broadcast (which every client in the room receives, including the
 * sender) is the authority that confirms them. If the server answers with an
 * ERROR instead, the outstanding optimistic moves are rolled back.
 */
class NetManager {
  private socket = new GameSocket();
  private pendingMoves: PendingMove[] = [];
  private wired = false;

  public connect(options?: Partial<ConnectOptions>) {
    const net = useNetStore.getState();
    const roomId = (options?.roomId ?? net.roomId).trim() || 'lobby';
    const role: NetRole = options?.role ?? net.requestedRole;
    const name = options?.name ?? net.playerName;

    this.wire();
    this.pendingMoves = [];

    net.setRoomId(roomId);
    net.setRequestedRole(role);
    net.setLastError(null);
    net.pushEvent(`connecting to room "${roomId}" as ${role}`);

    this.socket.connect({ roomId, role, name });
  }

  public disconnect() {
    this.socket.disconnect();
    this.pendingMoves = [];
    // Nothing is generated client side any more, so leaving empties the board.
    useGameStore.getState().clearGameState();
    useNetStore.getState().setAssignment(null, null);
    useNetStore.getState().setUsers([]);
    useNetStore.getState().setMe(null);
    useNetStore.getState().pushEvent('disconnected');
  }

  public get isConnected() {
    return this.socket.isConnected();
  }

  public get isOnline() {
    return useGameStore.getState().isOnline && this.socket.isConnected();
  }

  // --- Outgoing ---

  /** `from` is kept so the move can be rolled back if the server rejects it. */
  public sendCardMove(cardId: number, from: Vector3, to: Vector3) {
    this.pendingMoves.push({ cardId, from: from.clone(), to: to.clone() });
    const payload: MoveCardPayload = { cardId, targetTile: toNetVector3(to) };
    this.socket.send(NetEvent.MOVE_CARD, payload);
  }

  public sendCardOrientation(cardId: number, isDefenseMode: boolean, isFaceDown: boolean) {
    const payload: CardChangedPositionPayload = { cardId, isDefenseMode, isFaceDown };
    this.socket.send(NetEvent.CARD_CHANGED_POSITION, payload);
  }

  public sendEndTurn(nextPlayerId = 0) {
    // The server decides who is next; nextPlayerId is informational.
    this.socket.send(NetEvent.END_TURN, { nextPlayerId });
  }

  // --- Incoming ---

  private wire() {
    if (this.wired) return;
    this.wired = true;

    this.socket.onStatus((status, detail) => this.handleStatus(status, detail));
    this.socket.onMessage((message) => this.handleMessage(message));
  }

  private handleStatus(status: ConnectionStatus, detail?: string) {
    const net = useNetStore.getState();
    net.setStatus(status);

    if (detail) {
      net.setLastError(detail);
      net.pushEvent(`${status}: ${detail}`);
    } else {
      net.pushEvent(status);
    }

    if (status === 'closed') {
      this.pendingMoves = [];
      useGameStore.getState().resetNetworkState();
    }
  }

  private handleMessage(message: IncomingMessage) {
    const game = useGameStore.getState();
    const net = useNetStore.getState();

    switch (message.type) {
      case NetEvent.INIT_STATE:
      case NetEvent.STATE_SYNC: {
        // Both carry the full per-client state; STATE_SYNC is sent when the
        // roster changes (someone took or left a seat).
        const payload = message.payload as InitStatePayload;
        this.pendingMoves = [];
        game.applyServerInit(payload);
        net.setAssignment(payload.yourId, payload.yourRole);
        net.setMe(payload.you ?? null);
        net.setUsers(payload.users ?? []);
        net.setLastError(null);
        net.pushEvent(message.type === NetEvent.INIT_STATE
          ? `joined as ${payload.yourRole} (id ${payload.yourId})`
          : 'room roster changed, state re-synced');
        break;
      }

      case NetEvent.MOVE_CARD: {
        const payload = message.payload as MoveCardPayload;
        this.resolvePendingMove(payload);
        game.applyRemoteMove(payload.cardId, payload.targetTile);
        net.pushEvent(`card ${payload.cardId} -> (${payload.targetTile.x}, ${payload.targetTile.y})`);
        break;
      }

      case NetEvent.END_TURN: {
        const payload = message.payload as EndTurnPayload;
        this.pendingMoves = [];
        game.setTurnToPlayerId(payload.nextPlayerId);
        const next = useGameStore.getState().players.find(p => p.id === payload.nextPlayerId);
        net.pushEvent(`turn -> ${next?.name ?? payload.nextPlayerId}`);
        break;
      }

      case NetEvent.CARD_CHANGED_POSITION: {
        const payload = message.payload as CardChangedPositionPayload;
        game.applyRemoteOrientation(payload);
        break;
      }

      case NetEvent.CARD_DESTROYED: {
        const payload = message.payload as { cardId: number; };
        game.applyRemoteDestroy(payload.cardId);
        net.pushEvent(`card ${payload.cardId} destroyed`);
        break;
      }

      case NetEvent.USER_JOINED:
      case NetEvent.USER_LEFT: {
        // The room tells everyone who arrived or left and what they are; the
        // payload carries the resulting roster, so no local bookkeeping.
        const payload = message.payload as UserPayload;
        net.setUsers(payload.users ?? []);
        const verb = message.type === NetEvent.USER_JOINED ? 'joined' : 'left';
        net.pushEvent(`${payload.user.name} (${payload.user.role}) ${verb}`);
        break;
      }

      case NetEvent.ERROR: {
        const payload = message.payload as ErrorPayload;
        this.rollbackPendingMoves();
        net.setLastError(payload.message);
        net.pushEvent(`error: ${payload.message}`);
        break;
      }

      default:
        // DRAW_CARD / CARD_PLAYED / CARD_ATTACKED / CARD_ACTIVATED are relayed by
        // the server but the client does not simulate them yet.
        net.pushEvent(`unhandled ${message.type}`);
        break;
    }
  }

  private resolvePendingMove(payload: MoveCardPayload) {
    const index = this.pendingMoves.findIndex(m =>
      m.cardId === payload.cardId &&
      m.to.x === payload.targetTile.x &&
      m.to.y === payload.targetTile.y
    );
    if (index !== -1) this.pendingMoves.splice(index, 1);
  }

  /**
   * The server's ERROR payload is a plain message with no correlation id, so
   * every optimistic move still in flight is reverted. A player can only have
   * one committed move in flight at a time in practice.
   */
  private rollbackPendingMoves() {
    if (this.pendingMoves.length === 0) return;

    const reverted = this.pendingMoves;
    this.pendingMoves = [];

    useGameStore.setState((state) => {
      const revertedIds = new Set(reverted.map(m => String(m.cardId)));
      return {
        cards: state.cards.map((card) => {
          const move = reverted.find(m => m.cardId === card.id);
          return move ? { ...card, position: move.from.clone() } : card;
        }),
        turnState: {
          ...state.turnState,
          actedPieceIds: state.turnState.actedPieceIds.filter(id => !revertedIds.has(id))
        },
        stagingState: null,
        selectedTilePiece: null,
      };
    });
  }
}

export const netManager = new NetManager();
