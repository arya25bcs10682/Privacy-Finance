import mongoose, { Document, Schema, type Types } from "mongoose";
import { EncryptedPayloadSchema, type IEncryptedPayload } from "./common.js";

export interface IStatementFile extends Document {
  userId: string;
  bank?: string; // HDFC, ICICI, SBI (Rule 6)
  month?: string; // YYYY-MM
  encryptedPayload: IEncryptedPayload;
  gridFsFileId?: Types.ObjectId; // Pointer to encrypted blob in GridFS
  fileSize?: number;
  createdAt: Date;
  updatedAt: Date;
}

const StatementFileSchema = new Schema<IStatementFile>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    bank: {
      type: String,
      required: false,
      enum: ["HDFC", "ICICI", "SBI"],
    },
    month: {
      type: String,
      required: false,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
      index: true,
    },
    encryptedPayload: {
      type: EncryptedPayloadSchema,
      required: true,
    },
    gridFsFileId: {
      type: Schema.Types.ObjectId,
      required: false,
    },
    fileSize: {
      type: Number,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

StatementFileSchema.index({ userId: 1, month: 1 });

export const StatementFile = mongoose.model<IStatementFile>("StatementFile", StatementFileSchema);
