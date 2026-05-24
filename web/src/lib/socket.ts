"use client";
import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(token: string | null, guestName?: string): Socket {
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  const url = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
  socket = io(url, {
    transports: ["websocket"],
    auth: { token: token || undefined, guestName },
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function closeSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
