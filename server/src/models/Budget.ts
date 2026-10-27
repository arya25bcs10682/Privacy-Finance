import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IBudget extends Document {
  userId: string;
  month: string; // YYYY-MM
  encryptedPayload: IEncryptedPayload;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<IBudget>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
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

BudgetSchema.index({ userId: 1, month: 1 });

export const Budget = mongoose.model<IBudget>("Budget", BudgetSchema);
