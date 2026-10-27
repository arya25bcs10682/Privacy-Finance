import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IAccount extends Document {
  userId: string;
  encryptedPayload: IEncryptedPayload;
  accountType?: string; // Optional high-level classification
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    encryptedPayload: {
      type: EncryptedPayloadSchema,
      required: true,
    },
    accountType: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

AccountSchema.index({ userId: 1, createdAt: -1 });

export const Account = mongoose.model<IAccount>("Account", AccountSchema);
