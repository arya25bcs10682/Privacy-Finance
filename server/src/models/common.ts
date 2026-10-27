import { Schema } from "mongoose";

export interface IEncryptedPayload {
  iv: string;
  ct: string;
  ciphertext?: string;
}

export const EncryptedPayloadSchema = new Schema<IEncryptedPayload>(
  {
    iv: { type: String, required: true },
    ct: {
      type: String,
      required: true,
      // Normalize 'ciphertext' to 'ct' if provided
      set: function (val: string) {
        return val;
      },
    },
    ciphertext: { type: String, required: false },
  },
  { _id: false }
);

// Pre-validate hook to ensure ct is populated if ciphertext was sent
EncryptedPayloadSchema.pre("validate", function (next) {
  if (!this.ct && this.ciphertext) {
    this.ct = this.ciphertext;
  }
  if (!this.ciphertext && this.ct) {
    this.ciphertext = this.ct;
  }
  next();
});
