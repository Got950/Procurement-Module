import { beforeEach, expect, it, vi } from "vitest";
import {
  createUser,
  describeDb,
  resetData,
} from "../helpers/db";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  adminSetUserPassword,
  changeOwnPassword,
  requestPasswordReset,
  resetPasswordWithToken,
} from "@/server/password-reset";
import { ValidationError } from "@/lib/errors";

vi.mock("@/server/gmail-service", () => ({
  getGmailClient: vi.fn(async () => null),
  buildMimeMessage: vi.fn(() => "mime"),
  sendMimeEmail: vi.fn(async () => undefined),
}));

describeDb("password reset + settings (BUG-041/042)", () => {
  beforeEach(async () => {
    await resetData();
  });

  it("forgot-password always returns the same message and never reveals existence", async () => {
    const a = await requestPasswordReset("missing@example.com");
    const userId = await createUser("REQUESTER", "Reset User");
    await query(`UPDATE users SET email = $2, password_hash = $3 WHERE id = $1`, [
      userId,
      "real.user@example.com",
      await hashPassword("OldPassword123!"),
    ]);
    const b = await requestPasswordReset("real.user@example.com");
    expect(a.message).toBe(b.message);
    expect(a.message.toLowerCase()).toContain("if an account exists");
  });

  it("creates a hashed token for a real user and rejects invalid/expired tokens", async () => {
    const userId = await createUser("REQUESTER");
    await query(`UPDATE users SET email = $2, password_hash = $3 WHERE id = $1`, [
      userId,
      "reset.me@example.com",
      await hashPassword("OldPassword123!"),
    ]);
    await requestPasswordReset("reset.me@example.com");
    const tokens = await query<{ token_hash: string }>(
      `SELECT token_hash FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
    expect(tokens.rows.length).toBe(1);
    // Raw token is never stored — only the hash.
    expect(tokens.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);

    await expect(resetPasswordWithToken("totally-invalid-token-value-here", "NewPassword123!")).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("reset token is single-use and revokes sessions", async () => {
    const userId = await createUser("REQUESTER");
    await query(`UPDATE users SET email = $2, password_hash = $3 WHERE id = $1`, [
      userId,
      "once@example.com",
      await hashPassword("OldPassword123!"),
    ]);
    // Insert a known raw token by hashing the same way the service does.
    const { createHash, randomBytes } = await import("crypto");
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [userId, hash]
    );
    await query(
      `INSERT INTO sessions (jti, user_id, refresh_hash, expires_at)
       VALUES ('jti-old', $1, 'rh', NOW() + INTERVAL '1 day')`,
      [userId]
    );

    await resetPasswordWithToken(raw, "BrandNewPass123!");
    await expect(resetPasswordWithToken(raw, "AnotherPass1234!")).rejects.toBeInstanceOf(
      ValidationError
    );

    const sessions = await query<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM sessions WHERE user_id = $1`,
      [userId]
    );
    expect(sessions.rows.every((s) => s.revoked_at != null)).toBe(true);

    const { verifyPassword } = await import("@/lib/password");
    const row = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    expect(await verifyPassword("BrandNewPass123!", row.rows[0].password_hash)).toBe(true);
  });

  it("changeOwnPassword requires current password; adminSetUserPassword works", async () => {
    const userId = await createUser("REQUESTER");
    const adminId = await createUser("ADMIN");
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      userId,
      await hashPassword("CurrentPass123!"),
    ]);

    await expect(
      changeOwnPassword(userId, "wrong-password-xx", "NewerPass1234!")
    ).rejects.toBeInstanceOf(ValidationError);

    await changeOwnPassword(userId, "CurrentPass123!", "NewerPass1234!", "keep-jti");
    await adminSetUserPassword(adminId, userId, "AdminSetPass123!");

    const { verifyPassword } = await import("@/lib/password");
    const row = await query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    expect(await verifyPassword("AdminSetPass123!", row.rows[0].password_hash)).toBe(true);
  });
});
