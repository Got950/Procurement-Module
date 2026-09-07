import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { loginBody } from "@/lib/schemas";
import { verifyUserPassword } from "@/lib/auth-users";
import { establishSession, clearSessionCookie, revokeSession } from "@/lib/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { appendAudit } from "@/server/audit-service";
import { UnauthorizedError, RateLimitError } from "@/lib/errors";

const WINDOW_MS = 15 * 60 * 1000;

/** Shared-NAT staging may see many legitimate logins from one IP. */
function loginIpLimit() {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_PER_IP ?? 150);
  return Number.isFinite(raw) && raw >= 20 ? Math.min(2000, Math.trunc(raw)) : 150;
}

/** Per-account cap still blocks credential stuffing. */
function loginIdLimit() {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_PER_ID ?? 12);
  return Number.isFinite(raw) && raw >= 5 ? Math.min(100, Math.trunc(raw)) : 12;
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const POST = withApiHandler({
  auth: false,
  body: loginBody,
  rateLimit: false,
})(async ({ req, body }) => {
  const identifier = body.identifier.trim();
  const password = body.password;

  const ip = clientIp(req);
  const ipLimit = consumeRateLimit(`login:ip:${ip}`, loginIpLimit(), WINDOW_MS);
  const idLimit = consumeRateLimit(
    `login:id:${identifier.toLowerCase()}`,
    loginIdLimit(),
    WINDOW_MS
  );
  if (!ipLimit.ok || !idLimit.ok) {
    const retry = Math.max(ipLimit.ok ? 0 : ipLimit.retryAfterSec, idLimit.ok ? 0 : idLimit.retryAfterSec);
    await appendAudit({
      entityType: "Session",
      entityId: identifier.toLowerCase(),
      action: "LOGIN_RATE_LIMITED",
      diff: { ip },
    });
    throw new RateLimitError("Too many login attempts. Try again later.", retry);
  }

  const user = await verifyUserPassword(identifier, password);
  if (!user) {
    await appendAudit({
      entityType: "Session",
      entityId: identifier.toLowerCase(),
      action: "LOGIN_FAILURE",
      diff: { ip },
    });
    throw new UnauthorizedError("Invalid email/username or password");
  }

  await establishSession({
    id: user.id,
    role: user.role,
    name: user.name,
  });
  await appendAudit({
    entityType: "Session",
    entityId: user.id,
    action: "LOGIN_SUCCESS",
    actorId: user.id,
    diff: { ip },
  });
  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
  });
});

export const DELETE = withApiHandler({ auth: false, body: false })(async ({ session }) => {
  if (session?.jti) await revokeSession(session.jti);
  await clearSessionCookie();
  if (session) {
    await appendAudit({
      entityType: "Session",
      entityId: session.sub,
      action: "LOGOUT",
      actorId: session.sub,
    });
  }
  return NextResponse.json({ ok: true });
});
