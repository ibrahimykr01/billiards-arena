import { Room, RoomMode } from "./Room";

export class MatchManager {
  rooms: Map<string, Room> = new Map();
  matchmakingQueue: { socketId: string; rating: number }[] = [];

  newId(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  createRoom(mode: RoomMode, id?: string): Room {
    const rid = id || this.newId();
    const room = new Room(rid, mode);
    this.rooms.set(rid, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  destroy(id: string) {
    const r = this.rooms.get(id);
    if (r) r.stopShotClock();
    this.rooms.delete(id);
  }

  publicRooms() {
    return [...this.rooms.values()]
      .filter(r => r.mode !== "ai" && r.mode !== "private")
      .map(r => ({
        id: r.id,
        mode: r.mode,
        players: r.players.map(p => p ? { name: p.name, rating: p.rating } : null),
        spectators: r.spectators.size,
      }));
  }

  enqueue(socketId: string, rating: number): Room | null {
    // simple FIFO matchmaking with rating window expansion
    for (let i = 0; i < this.matchmakingQueue.length; i++) {
      const opp = this.matchmakingQueue[i];
      if (opp.socketId === socketId) continue;
      if (Math.abs(opp.rating - rating) < 400) {
        this.matchmakingQueue.splice(i, 1);
        return this.createRoom("ranked");
      }
    }
    this.matchmakingQueue.push({ socketId, rating });
    return null;
  }

  dequeue(socketId: string) {
    this.matchmakingQueue = this.matchmakingQueue.filter(q => q.socketId !== socketId);
  }
}
