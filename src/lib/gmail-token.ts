import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

function keyFromSecret() {
  const secret = process.env.GMAIL_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("GMAIL_TOKEN_SECRET must be set");
  }
  // Prefer a per-deployment salt. Default retained for backward compatibility with
  // tokens encrypted before GMAIL_TOKEN_SALT was introduced (changing salt requires
  // reconnecting Gmail OAuth).
  const salt = process.env.GMAIL_TOKEN_SALT?.trim() || "gmail-salt";
  return scryptSync(secret, salt, 32);
}

export function encryptRefreshToken(plain: string) {
  const key = keyFromSecret();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptRefreshToken(payload: string) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = keyFromSecret();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
