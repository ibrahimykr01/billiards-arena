import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  mongoUri: process.env.MONGO_URI || "",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(","),
  isProd: process.env.NODE_ENV === "production",
};
