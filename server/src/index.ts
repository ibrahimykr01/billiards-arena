import http from "http";
import express from "express";
import cors from "cors";
import { Server as IOServer } from "socket.io";
import { env } from "./config/env";
import { connectDb } from "./db";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { attachSocket } from "./socket";
import { setDbReady } from "./services/userStore";

async function main() {
  const ready = await connectDb();
  setDbReady(ready);

  const app = express();
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, db: ready }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);

  const server = http.createServer(app);
  const io = new IOServer(server, {
    cors: { origin: env.corsOrigin, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });
  attachSocket(io);

  server.listen(env.port, () => {
    console.log(`[server] listening http://localhost:${env.port}`);
  });
}

main().catch(err => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
