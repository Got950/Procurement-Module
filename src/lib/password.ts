import { randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { ValidationError } from "@/lib/errors";

const KEY_LEN = 64;
const scryptAsync = promisify(scrypt);

const COMMON = new Set([
  "password",
  "password123",
  "12345678",
  "123456789012",
  "admin@1234",
  "qwerty123456",
  "letmein12345",
]);

/** Minimum 12 characters; rejects a short common-password list. */
export function assertPasswordPolicy(password: string) {
  if (password.length < 12) {
    throw new ValidationError("Password must be at least 12 characters");
  }
  if (COMMON.has(password.toLowerCase())) {
    throw new ValidationError("Choose a less common password");
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored?.startsWith("scrypt:")) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
