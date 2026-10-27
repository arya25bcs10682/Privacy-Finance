import mongoose, { Document, Schema } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IWrappedKey {
  ciphertext: string;
  iv?: string;
}

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  keySalt: string;
  wrappedDataKey: IWrappedKey;
  wrappedDataKeyByRecovery: IWrappedKey | string;
  refreshTokens: string[];
  encryptedMappings?: IEncryptedPayload;
  encryptedRules?: IEncryptedPayload;
  createdAt: Date;
  updatedAt: Date;
}

const WrappedKeySchema = new Schema<IWrappedKey>(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: false },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    keySalt: {
      type: String,
      required: true,
    },
    wrappedDataKey: {
      type: WrappedKeySchema,
      required: true,
    },
    wrappedDataKeyByRecovery: {
      type: Schema.Types.Mixed,
      required: true,
    },
    refreshTokens: {
      type: [String],
      default: [],
    },
    encryptedMappings: {
      type: EncryptedPayloadSchema,
      required: false,
    },
    encryptedRules: {
      type: EncryptedPayloadSchema,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUser>("User", UserSchema);
