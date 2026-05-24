import { Server, Socket } from "socket.io";
import { verifyToken } from "../middleware/auth";
import { MatchManager } from "../game/MatchManager";
import { Room, RoomMode } from "../game/Room";
import { aiPlaceCue, planAIShot, AIDifficulty } from "../game/AIPlayer";
import { recordMatchResult } from "../services/userStore";
import { PlayerInfo, ShotInput } from "../../../shared/src";

interface AuthedSocket extends Socket {
  userInfo?: PlayerInfo;
}

export function attachSocket(io: Server) {
  const mm = new MatchManager();

  // chat history per room (in-memory ring)
  const chatLogs = new Map<string, { from: string; text: string; t: number }[]>();

  io.use((socket: AuthedSocket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      // allow guest with provided guest name
      const guestName = (socket.handshake.auth?.guestName as string) || `Guest-${socket.id.slice(0, 4)}`;
      socket.userInfo = { id: "guest_" + socket.id, name: guestName, rating: 1000 };
      return next();
    }
    const payload = verifyToken(token);
    if (!payload) return next(new Error("Invalid token"));
    socket.userInfo = { id: payload.sub, name: payload.name, rating: 1000 };
    next();
  });

  io.on("connection", (socket: AuthedSocket) => {
    const me = socket.userInfo!;
    socket.emit("hello", { you: me });

    socket.on("rooms:list", () => socket.emit("rooms:list", mm.publicRooms()));

    socket.on("room:create", ({ mode = "casual" as RoomMode, isPrivate = false } = {}) => {
      const m: RoomMode = isPrivate ? "private" : (mode as RoomMode);
      const room = mm.createRoom(m);
      joinRoom(socket, room);
    });

    socket.on("room:join", ({ id }: { id: string }) => {
      const room = mm.getRoom(id?.toUpperCase?.() || id);
      if (!room) return socket.emit("error:msg", "Oda bulunamadı");
      joinRoom(socket, room);
    });

    socket.on("matchmaking:join", () => {
      // Find a waiting opponent in queue with similar rating
      const oppEntry = mm.matchmakingQueue.find(q => q.socketId !== socket.id && Math.abs(q.rating - me.rating) < 400);
      if (oppEntry) {
        mm.matchmakingQueue = mm.matchmakingQueue.filter(q => q.socketId !== oppEntry.socketId && q.socketId !== socket.id);
        const room = mm.createRoom("ranked");
        // seat me
        joinRoom(socket, room);
        // seat opponent if still connected
        const oppSocket = io.sockets.sockets.get(oppEntry.socketId) as AuthedSocket | undefined;
        if (oppSocket) {
          const oppMe = oppSocket.userInfo!;
          room.addPlayer(oppSocket.id, oppMe);
          oppSocket.join(room.id);
          oppSocket.emit("room:joined", { id: room.id, seat: 1, snapshot: room.snapshot() });
          io.to(room.id).emit("game:state", { state: room.state });
          io.to(room.id).emit("room:players", room.players);
        }
      } else {
        mm.matchmakingQueue.push({ socketId: socket.id, rating: me.rating });
        socket.emit("matchmaking:waiting");
      }
    });

    socket.on("matchmaking:cancel", () => mm.dequeue(socket.id));

    socket.on("ai:start", ({ difficulty = "medium" as AIDifficulty } = {}) => {
      const room = mm.createRoom("ai");
      room.isAI = true;
      room.players[1] = { id: "ai_" + difficulty, name: `AI (${difficulty})`, rating: 900 };
      (room as any).aiDifficulty = difficulty;
      joinRoom(socket, room);
      maybeRunAI(io, room);
    });

    socket.on("game:shoot", ({ id, shot }: { id: string; shot: ShotInput }) => {
      const room = mm.getRoom(id);
      if (!room) return;
      const seat = room.isSeated(socket.id);
      if (seat === null) return;
      // snapshot pre-shot ball positions for animation playback
      const initialBalls = room.state.balls.map(b => ({ id: b.id, x: b.pos.x, y: b.pos.y, pocketed: b.pocketed }));
      const res = room.performShot(seat, shot);
      if (!res) return;
      io.to(room.id).emit("game:shot", {
        shot,
        initialBalls,
        frames: res.frames,
        sounds: res.sounds,
        duration: res.duration,
        finalState: room.state,
        events: res.events,
        foul: res.foul,
        reason: res.reason,
      });
      // schedule canonical state broadcast + next turn (AI) after the animation completes
      const delay = Math.ceil(res.duration * 1000) + 50;
      setTimeout(() => {
        io.to(room.id).emit("game:state", { state: room.state });
        if (res.winner !== null) finishMatch(io, room, res.winner);
        else maybeRunAI(io, room);
      }, delay);
    });

    socket.on("game:placeCue", ({ id, x, y }: { id: string; x: number; y: number }) => {
      const room = mm.getRoom(id);
      if (!room) return;
      const seat = room.isSeated(socket.id);
      if (seat === null) return;
      const ok = room.placeCue(seat, x, y);
      if (ok) {
        io.to(room.id).emit("game:state", { state: room.state });
        maybeRunAI(io, room);
      }
    });

    socket.on("pink:activate", ({ id }: { id: string }) => {
      const room = mm.getRoom(id);
      if (!room) return;
      const seat = room.isSeated(socket.id);
      if (seat === null) return;
      io.to(id).emit("pink:seat", { seat });
    });

    socket.on("chat:send", ({ id, text }: { id: string; text: string }) => {
      if (!text || text.length > 240) return;
      const room = mm.getRoom(id);
      if (!room) return;
      const log = chatLogs.get(id) || [];
      const msg = { from: me.name, text: text.slice(0, 240), t: Date.now() };
      log.push(msg);
      if (log.length > 100) log.shift();
      chatLogs.set(id, log);
      io.to(id).emit("chat:msg", msg);
    });

    socket.on("disconnect", () => {
      mm.dequeue(socket.id);
      // mark disconnected in any room
      for (const room of mm.rooms.values()) {
        const { seat, empty } = room.removeBySocket(socket.id);
        if (seat !== null) {
          io.to(room.id).emit("player:left", { seat, name: me.name });
        }
        if (empty) mm.destroy(room.id);
      }
    });

    function joinRoom(socket: AuthedSocket, room: Room) {
      const seat = room.addPlayer(socket.id, me);
      socket.join(room.id);
      if (seat === null) {
        room.spectators.add(socket.id);
        socket.emit("room:joined", { id: room.id, seat: null, snapshot: room.snapshot() });
      } else {
        socket.emit("room:joined", { id: room.id, seat, snapshot: room.snapshot() });
      }
      io.to(room.id).emit("game:state", { state: room.state });
      io.to(room.id).emit("room:players", room.players);
      const log = chatLogs.get(room.id) || [];
      socket.emit("chat:history", log);
    }
  });

  function maybeRunAI(io: Server, room: Room) {
    if (!room.isAI) return;
    if (room.state.winner !== null) return;
    if (room.state.turn !== 1) return;
    const difficulty: AIDifficulty = (room as any).aiDifficulty || "medium";
    setTimeout(() => {
      if (room.state.ballInHand) {
        const p = aiPlaceCue(room.state);
        room.placeCue(1, p.x, p.y);
        io.to(room.id).emit("game:state", { state: room.state });
      }
      const shot = planAIShot(room.state, 1, difficulty);
      const initialBalls = room.state.balls.map(b => ({ id: b.id, x: b.pos.x, y: b.pos.y, pocketed: b.pocketed }));
      const res = room.performShot(1, shot);
      if (!res) return;
      io.to(room.id).emit("game:shot", {
        shot,
        initialBalls,
        frames: res.frames,
        sounds: res.sounds,
        duration: res.duration,
        finalState: room.state,
        events: res.events,
        foul: res.foul,
        reason: res.reason,
      });
      const delay = Math.ceil(res.duration * 1000) + 50;
      setTimeout(() => {
        io.to(room.id).emit("game:state", { state: room.state });
        if (res.winner !== null) finishMatch(io, room, res.winner);
        else maybeRunAI(io, room);
      }, delay);
    }, 1200 + Math.random() * 1200);
  }

  async function finishMatch(io: Server, room: Room, winnerSeat: 0 | 1) {
    const winner = room.players[winnerSeat];
    const loser = room.players[winnerSeat === 0 ? 1 : 0];
    io.to(room.id).emit("game:over", { winner, loser });
    if (winner && loser && !winner.id.startsWith("guest_") && !winner.id.startsWith("ai_") &&
        !loser.id.startsWith("guest_") && !loser.id.startsWith("ai_")) {
      try { await recordMatchResult(winner.id, loser.id); } catch {}
    }
  }
}
