// In-memory fallback store (used when MongoDB is not configured).
// Production deployments should always set MONGO_URI.
import bcrypt from "bcryptjs";
import { UserModel } from "../models/User";
import mongoose from "mongoose";

let dbReady = false;
export function setDbReady(v: boolean) { dbReady = v; }

interface MemUser {
  _id: string;
  email: string;
  name: string;
  passwordHash: string;
  rating: number;
  coins: number;
  xp: number;
  level: number;
  wins: number;
  losses: number;
  avatar: string;
  bio: string;
}
const mem: Map<string, MemUser> = new Map();

function makeId() {
  return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function createUser(email: string, name: string, password: string) {
  email = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(password, 10);
  if (dbReady) {
    const exists = await UserModel.findOne({ email });
    if (exists) throw new Error("Email already registered");
    const u = await UserModel.create({ email, name, passwordHash });
    return { id: u._id.toString(), email: u.email, name: u.name, rating: u.rating };
  }
  for (const u of mem.values()) if (u.email === email) throw new Error("Email already registered");
  const u: MemUser = {
    _id: makeId(),
    email,
    name,
    passwordHash,
    rating: 1000,
    coins: 500,
    xp: 0,
    level: 1,
    wins: 0,
    losses: 0,
    avatar: "",
    bio: "",
  };
  mem.set(u._id, u);
  return { id: u._id, email: u.email, name: u.name, rating: u.rating };
}

export async function verifyLogin(email: string, password: string) {
  email = email.toLowerCase().trim();
  if (dbReady) {
    const u = await UserModel.findOne({ email });
    if (!u) return null;
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) return null;
    return { id: u._id.toString(), email: u.email, name: u.name, rating: u.rating };
  }
  for (const u of mem.values()) {
    if (u.email === email) {
      const ok = await bcrypt.compare(password, u.passwordHash);
      if (!ok) return null;
      return { id: u._id, email: u.email, name: u.name, rating: u.rating };
    }
  }
  return null;
}

export async function getUserById(id: string) {
  if (dbReady) {
    if (!mongoose.isValidObjectId(id)) return null;
    const u = await UserModel.findById(id);
    if (!u) return null;
    return {
      id: u._id.toString(), email: u.email, name: u.name, rating: u.rating,
      coins: u.coins, xp: u.xp, level: u.level, wins: u.wins, losses: u.losses,
      avatar: u.avatar, bio: u.bio,
    };
  }
  const u = mem.get(id);
  if (!u) return null;
  return { ...u, id: u._id, passwordHash: undefined };
}

export async function recordMatchResult(winnerId: string, loserId: string, ratingDelta = 16) {
  if (dbReady) {
    await UserModel.findByIdAndUpdate(winnerId, { $inc: { wins: 1, rating: ratingDelta, xp: 50, coins: 100 } });
    await UserModel.findByIdAndUpdate(loserId, { $inc: { losses: 1, rating: -ratingDelta, xp: 20, coins: 25 } });
    return;
  }
  const w = mem.get(winnerId); const l = mem.get(loserId);
  if (w) { w.wins++; w.rating += ratingDelta; w.xp += 50; w.coins += 100; }
  if (l) { l.losses++; l.rating -= ratingDelta; l.xp += 20; l.coins += 25; }
}

export async function leaderboard(limit = 50) {
  if (dbReady) {
    const list = await UserModel.find().sort({ rating: -1 }).limit(limit);
    return list.map(u => ({ id: u._id.toString(), name: u.name, rating: u.rating, wins: u.wins, losses: u.losses }));
  }
  return [...mem.values()]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
    .map(u => ({ id: u._id, name: u.name, rating: u.rating, wins: u.wins, losses: u.losses }));
}
