import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IHolding extends Document {
  userId: string;
  assetClass?: string;
  encryptedPayload: IEncryptedPayload;
  createdAt: Date;
  updatedAt: Date;
}

const HoldingSchema = new Schema<IHolding>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    assetClass: {
      type: String,
      required: false,
      index: true,
    },
    encryptedPayload: {
      type: EncryptedPayloadSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

HoldingSchema.index({ userId: 1, assetClass: 1 });

export const Holding = mongoose.model<IHolding>("Holding", HoldingSchema);
