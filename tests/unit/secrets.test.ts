import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionSecret } from "@/lib/session-secret";
import { hashPassword, verifyPassword, assertPasswordPolicy } from "@/lib/password";
import { decryptRefreshToken, encryptRefreshToken } from "@/lib/gmail-token";
import { assertDestructiveAllowed } from "../../scripts/destructive-guard";
import { redactLogFields } from "@/lib/logger";

describe("session secret loader", () => {
  const original = process.env.SESSION_SECRET;
  afterEach(() => {
    process.env.SESSION_SECRET = original;
    vi.unstubAllEnvs();
  });

  it("loads a sufficiently long secret", () => {
    process.env.SESSION_SECRET = "a".repeat(32);
    expect(getSessionSecret()).toEqual(new TextEncoder().encode("a".repeat(32)));
  });

  it("throws when unset, with no development fallback", () => {
    delete process.env.SESSION_SECRET;
    vi.stubEnv("NODE_ENV", "development");
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/);
  });

  it("throws on a short secret", () => {
    process.env.SESSION_SECRET = "too-short";
    expect(() => getSessionSecret()).toThrow(/SESSION_SECRET/);
  });
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("Correct horse battery staple");
    expect(await verifyPassword("Correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("salts, so equal passwords do not share a hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects missing or malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt:only-two-parts")).toBe(false);
  });

  it("rejects short and common passwords", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(/12/);
    expect(() => assertPasswordPolicy("qwerty123456")).toThrow(/common/);
    expect(() => assertPasswordPolicy("Correct horse battery staple")).not.toThrow();
  });
});

describe("gmail refresh token encryption", () => {
  beforeEach(() => {
    process.env.GMAIL_TOKEN_SECRET = "f".repeat(64);
  });

  it("round-trips", () => {
    const token = "1//0gRefreshTokenValue";
    expect(decryptRefreshToken(encryptRefreshToken(token))).toBe(token);
  });

  it("detects tampering via the GCM auth tag", () => {
    const payload = Buffer.from(encryptRefreshToken("token"), "base64");
    payload[payload.length - 1] ^= 0xff;
    expect(() => decryptRefreshToken(payload.toString("base64"))).toThrow();
  });

  it("fails closed when the secret is absent", () => {
    delete process.env.GMAIL_TOKEN_SECRET;
    expect(() => encryptRefreshToken("token")).toThrow(/GMAIL_TOKEN_SECRET/);
  });
});

describe("destructive script guard", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.ALLOW_DESTRUCTIVE = "1";
    vi.stubEnv("NODE_ENV", "development");
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/pharma_procurement";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows a local database with the opt-in", () => {
    expect(() => assertDestructiveAllowed("test")).not.toThrow();
  });

  it("refuses without the opt-in", () => {
    delete process.env.ALLOW_DESTRUCTIVE;
    expect(() => assertDestructiveAllowed("test")).toThrow(/ALLOW_DESTRUCTIVE/);
  });

  it("refuses in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertDestructiveAllowed("test")).toThrow(/production/);
  });

  it("refuses a remote database that is not named for dev/test", () => {
    process.env.DATABASE_URL = "postgresql://u:p@prod.rds.amazonaws.com:5432/pharma_procurement";
    expect(() => assertDestructiveAllowed("test")).toThrow(/refused/);
  });

  it("allows a remote database explicitly named for test", () => {
    process.env.DATABASE_URL = "postgresql://u:p@staging.rds.amazonaws.com:5432/pharma_test";
    expect(() => assertDestructiveAllowed("test")).not.toThrow();
  });
});

describe("logger redaction (SEC-010)", () => {
  it("redacts tokens, api keys, and session material", () => {
    const out = redactLogFields({
      token: "secret-token",
      accessToken: "jwt",
      apiKey: "sk-test",
      session: "sid",
      password: "x",
      safe: "ok",
    });
    expect(out.token).toBe("[redacted]");
    expect(out.accessToken).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.session).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.safe).toBe("ok");
  });
});
