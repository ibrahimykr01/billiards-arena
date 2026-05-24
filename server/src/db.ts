import mongoose from "mongoose";
import { env } from "./config/env";

export async function connectDb(): Promise<boolean> {
  if (!env.mongoUri) {
    console.warn("[db] MONGO_URI not set, running in IN-MEMORY user mode (dev only)");
    return false;
  }
  try {
    await mongoose.connect(env.mongoUri);
    console.log("[db] connected to MongoDB");
    return true;
  } catch (e) {
    console.error("[db] connection failed:", (e as Error).message);
    return false;
  }
}
