import { Router } from "express";
import { getUserById, leaderboard } from "../services/userStore";

export const usersRouter = Router();

usersRouter.get("/leaderboard", async (_req, res) => {
  res.json({ items: await leaderboard(50) });
});

usersRouter.get("/:id", async (req, res) => {
  const u = await getUserById(req.params.id);
  if (!u) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ user: u });
});
