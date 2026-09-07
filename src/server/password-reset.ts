import { createHash, randomBytes } from "crypto";
import { query } from "@/lib/db";
import { assertPasswordPolicy, hashPassword } from "@/lib/password";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { appendAudit } from "@/server/audit-service";
import { revokeSession } from "@/lib/session";
import { buildMimeMessage, getGmailClient, sendMimeEmail } from "@/server/gmail-service";
import { log } from "@/lib/logger";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_OK =
  "If an account exists for that email, password reset instructions have been sent.";

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function appOrigin() {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * Request a password reset. Always returns the same message so callers cannot
 * probe whether an email is registered. Tokens are hashed at rest.
 */
export async function requestPasswordReset(emailRaw: string): Promise<{ message: string }> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    // Same generic message for malformed addresses that look like emails;
    // Zod on the route already rejects clearly invalid shapes.
    return { message: GENERIC_OK };
  }

  const userRow = await query<{ id: string; email: string; name: string; is_active: boolean }>(
    `SELECT id, email, name, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email]
  );
  const user = userRow.rows[0];
  if (!user || !user.is_active) {
    await appendAudit({
      entityType: "User",
      entityId: email,
      action: "PASSWORD_RESET_REQUESTED",
      diff: { found: false },
    });
    return { message: GENERIC_OK };
  }

  // Invalidate prior unused tokens for this user.
  await query(
    `UPDATE password_reset_tokens SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [user.id]
  );

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt.toISOString()]
  );

  const resetUrl = `${appOrigin()}/reset-password?token=${rawToken}`;
  let emailed = false;
  try {
    const gmail = await getGmailClient();
    if (gmail) {
      const mime = buildMimeMessage({
        to: user.email,
        subject: "MedFlow — password reset",
        bodyText: [
          `Hello ${user.name},`,
          "",
          "A password reset was requested for your MedFlow account.",
          "Open this link within one hour to choose a new password:",
          "",
          resetUrl,
          "",
          "If you did not request this, you can ignore this email.",
          "",
          "— MedFlow",
        ].join("\n"),
      });
      await sendMimeEmail(mime);
      emailed = true;
    } else {
      log.info("password reset token created; Gmail not connected — email not sent", {
        userId: user.id,
      });
    }
  } catch (e) {
    log.error("password reset email failed", {
      userId: user.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await appendAudit({
    entityType: "User",
    entityId: user.id,
    action: "PASSWORD_RESET_REQUESTED",
    actorId: user.id,
    diff: { found: true, emailed },
  });

  return { message: GENERIC_OK };
}

/**
 * Consume a reset token and set a new password. Revokes all sessions for the user.
 * Never logs the token or password.
 */
export async function resetPasswordWithToken(rawToken: string, newPassword: string) {
  const token = rawToken.trim();
  if (!token || token.length < 32 || token.length > 128) {
    throw new ValidationError("Invalid or expired reset link");
  }
  assertPasswordPolicy(newPassword);

  const tokenHash = hashToken(token);
  const found = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );
  const row = found.rows[0];
  if (!row) throw new ValidationError("Invalid or expired reset link");

  const passwordHash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [
    row.user_id,
    passwordHash,
  ]);
  await query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
  // Burn any other outstanding tokens for this user.
  await query(
    `UPDATE password_reset_tokens SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [row.user_id]
  );
  await revokeSession(null, row.user_id);

  await appendAudit({
    entityType: "User",
    entityId: row.user_id,
    action: "PASSWORD_RESET_COMPLETED",
    actorId: row.user_id,
  });

  return { ok: true as const };
}

/** Authenticated user changes their own password (requires current password). */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentJti?: string | null
) {
  assertPasswordPolicy(newPassword);
  const row = await query<{ password_hash: string | null }>(
    `SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE`,
    [userId]
  );
  const user = row.rows[0];
  if (!user?.password_hash) throw new ValidationError("Account has no password set");

  const { verifyPassword } = await import("@/lib/password");
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new ValidationError("Current password is incorrect");
  }
  if (currentPassword === newPassword) {
    throw new ValidationError("New password must be different from the current password");
  }

  const passwordHash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [
    userId,
    passwordHash,
  ]);
  // Keep the current session; revoke every other session for this user.
  if (currentJti) {
    await query(
      `UPDATE sessions SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL AND jti <> $2`,
      [userId, currentJti]
    );
  } else {
    await revokeSession(null, userId);
  }

  await appendAudit({
    entityType: "User",
    entityId: userId,
    action: "PASSWORD_CHANGED",
    actorId: userId,
  });

  return { ok: true as const };
}

/** Admin sets a user's password (no current-password check). Revokes their sessions. */
export async function adminSetUserPassword(adminId: string, targetUserId: string, newPassword: string) {
  assertPasswordPolicy(newPassword);
  const target = await query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1`,
    [targetUserId]
  );
  if (!target.rows[0]) throw new NotFoundError("User not found");

  const passwordHash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [
    targetUserId,
    passwordHash,
  ]);
  await revokeSession(null, targetUserId);
  await query(
    `UPDATE password_reset_tokens SET used_at = NOW()
      WHERE user_id = $1 AND used_at IS NULL`,
    [targetUserId]
  );

  await appendAudit({
    entityType: "User",
    entityId: targetUserId,
    action: "PASSWORD_SET_BY_ADMIN",
    actorId: adminId,
  });

  return { ok: true as const };
}
