import mongoose, { Schema, InferSchemaType, Model } from "mongoose";

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" },
    rating: { type: Number, default: 1000 },
    coins: { type: Number, default: 500 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export type User = InferSchemaType<typeof UserSchema> & { _id: mongoose.Types.ObjectId };
export const UserModel: Model<User> = mongoose.models.User || mongoose.model<User>("User", UserSchema);
