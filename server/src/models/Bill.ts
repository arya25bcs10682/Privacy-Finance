import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IBill extends Document {
  userId: string;
  dueDateMonth?: string; // YYYY-MM optional query metadata
  encryptedPayload: IEncryptedPayload;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    dueDateMonth: {
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

BillSchema.index({ userId: 1, dueDateMonth: 1 });

export const Bill = mongoose.model<IBill>("Bill", BillSchema);
