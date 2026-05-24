import { GameState, PlayerInfo, RoomSnapshot, ShotInput } from "../../../shared/src";
import { createInitialState, executeShot, placeCueAt } from "../../../shared/src";
import { SHOT_CLOCK_SECONDS } from "../../../shared/src/constants";

export type RoomMode = "casual" | "ranked" | "private" | "ai";

export class Room {
  id: string;
  mode: RoomMode;
  state: GameState;
  players: (PlayerInfo | null)[] = [null, null];
  socketIds: (string | null)[] = [null, null];
  spectators = new Set<string>();
  createdAt: number;
  lastShotAt: number;
  shotTimer: NodeJS.Timeout | null = null;
  onAutoShot?: () => void;
  isAI = false;

  constructor(id: string, mode: RoomMode) {
    this.id = id;
    this.mode = mode;
    this.state = createInitialState();
    // 50/50 break: either player can open
    this.state.turn = Math.random() < 0.5 ? 0 : 1;
    this.createdAt = Date.now();
    this.lastShotAt = Date.now();
  }

  addPlayer(socketId: string, player: PlayerInfo): 0 | 1 | null {
    for (let i = 0; i < 2; i++) {
      if (this.players[i] === null) {
        this.players[i] = player;
        this.socketIds[i] = socketId;
        return i as 0 | 1;
      }
      if (this.players[i]?.id === player.id) {
        // reconnect: replace socketId
        this.socketIds[i] = socketId;
        return i as 0 | 1;
      }
    }
    return null;
  }

  removeBySocket(socketId: string): { seat: 0 | 1 | null; empty: boolean } {
    let seat: 0 | 1 | null = null;
    for (let i = 0; i < 2; i++) {
      if (this.socketIds[i] === socketId) {
        this.socketIds[i] = null;
        seat = i as 0 | 1;
      }
    }
    this.spectators.delete(socketId);
    const empty = this.socketIds.every(s => s === null) && this.spectators.size === 0;
    return { seat, empty };
  }

  isSeated(socketId: string): 0 | 1 | null {
    if (this.socketIds[0] === socketId) return 0;
    if (this.socketIds[1] === socketId) return 1;
    return null;
  }

  ready(): boolean {
    return this.players[0] !== null && (this.players[1] !== null || this.isAI);
  }

  performShot(seat: 0 | 1, shot: ShotInput) {
    if (this.state.winner !== null) return null;
    if (this.state.turn !== seat) return null;
    if (this.state.shotInProgress) return null;
    if (this.state.ballInHand) return null;
    const result = executeShot(this.state, shot);
    this.lastShotAt = Date.now();
    return result;
  }

  placeCue(seat: 0 | 1, x: number, y: number): boolean {
    if (this.state.winner !== null) return false;
    if (this.state.turn !== seat) return false;
    if (!this.state.ballInHand) return false;
    return placeCueAt(this.state, x, y);
  }

  startShotClock(onExpire: () => void) {
    this.stopShotClock();
    this.state.shotClock = SHOT_CLOCK_SECONDS;
    this.shotTimer = setInterval(() => {
      this.state.shotClock -= 1;
      if (this.state.shotClock <= 0) {
        this.stopShotClock();
        onExpire();
      }
    }, 1000);
  }

  stopShotClock() {
    if (this.shotTimer) clearInterval(this.shotTimer);
    this.shotTimer = null;
  }

  snapshot(): RoomSnapshot {
    return {
      id: this.id,
      state: this.state,
      players: this.players,
      spectators: this.spectators.size,
    };
  }
}
