import mongoose, { Schema, InferSchemaType, Model } from "mongoose";

const MatchSchema = new Schema(
  {
    players: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    winner: { type: Schema.Types.ObjectId, ref: "User" },
    mode: { type: String, enum: ["casual", "ranked", "private", "ai"], default: "casual" },
    durationSec: { type: Number, default: 0 },
    ratingChange: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type Match = InferSchemaType<typeof MatchSchema> & { _id: mongoose.Types.ObjectId };
export const MatchModel: Model<Match> = mongoose.models.Match || mongoose.model<Match>("Match", MatchSchema);
