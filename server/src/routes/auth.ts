import { Router } from "express";
import { z } from "zod";
import { signToken, requireAuth, AuthedRequest } from "../middleware/auth";
import { createUser, verifyLogin, getUserById } from "../services/userStore";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(24),
  password: z.string().min(6).max(72),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", issues: parsed.error.issues });
    return;
  }
  try {
    const u = await createUser(parsed.data.email, parsed.data.name, parsed.data.password);
    const token = signToken({ sub: u.id, name: u.name });
    res.json({ token, user: u });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const u = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!u) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = signToken({ sub: u.id, name: u.name });
  res.json({ token, user: u });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const u = await getUserById(req.userId!);
  if (!u) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ user: u });
});
