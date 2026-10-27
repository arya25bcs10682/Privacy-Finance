import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface ITransaction extends Document {
  userId: string;
  txHash: string;
  encryptedPayload: IEncryptedPayload;
  month: string; // YYYY-MM plaintext for partial/range queries
  accountId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      required: true,
    },
    encryptedPayload: {
      type: EncryptedPayloadSchema,
      required: true,
    },
    month: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/, // YYYY-MM validation
      index: true,
    },
    accountId: {
      type: String,
      required: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index on (userId, txHash) to ensure uniqueness per user while allowing identical hashes across different users
TransactionSchema.index({ userId: 1, txHash: 1 }, { unique: true });
// Compound index for fast month queries scoped by user
TransactionSchema.index({ userId: 1, month: 1 });

export const Transaction = mongoose.model<ITransaction>("Transaction", TransactionSchema);
