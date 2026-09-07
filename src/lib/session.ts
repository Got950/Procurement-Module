import { createHash, randomBytes, randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret } from "./session-secret";
import { isRole, type Role } from "./domain-types";
import { query } from "./db";

export const COOKIE = "pharma_session";
export const REFRESH_COOKIE = "pharma_refresh";

const ACCESS_MAX_AGE = 30 * 60;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionPayload = {
  sub: string;
  role: Role;
  name: string;
  jti?: string;
};

export function cookieSecure() {
  if (process.env.FORCE_SECURE_COOKIES === "1") return true;
  if (process.env.FORCE_SECURE_COOKIES === "0") return false;
  return process.env.NODE_ENV === "production";
}

function hashRefresh(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createSessionToken(payload: SessionPayload & { jti: string }) {
  return new SignJWT({ role: payload.role, name: payload.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    const sub = payload.sub;
    const name = payload.name as string | undefined;
    const jti = payload.jti;
    if (!sub || !name || !isRole(payload.role)) return null;
    return { sub, role: payload.role, name, jti };
  } catch {
    return null;
  }
}

async function loadLiveUser(userId: string): Promise<SessionPayload | null> {
  const result = await query<{ id: string; name: string; role: string; is_active: boolean }>(
    `SELECT id, name, role, is_active FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row || !row.is_active || !isRole(row.role)) return null;
  return { sub: row.id, role: row.role, name: row.name };
}

async function sessionRowLive(jti: string) {
  const result = await query<{ jti: string }>(
    `SELECT jti FROM sessions
      WHERE jti = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [jti]
  );
  return result.rows[0] ?? null;
}

export async function establishSession(user: { id: string; role: Role; name: string }) {
  const jti = randomUUID();
  const refresh = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO sessions (jti, user_id, refresh_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
    [jti, user.id, hashRefresh(refresh)]
  );
  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    jti,
  });
  await setSessionCookies(token, refresh);
  return token;
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const parsed = await verifySessionToken(token);
    if (parsed?.jti && (await sessionRowLive(parsed.jti))) {
      const live = await loadLiveUser(parsed.sub);
      if (live) return { ...live, jti: parsed.jti };
    }
  }
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const row = await query<{ jti: string; user_id: string }>(
    `SELECT jti, user_id FROM sessions
      WHERE refresh_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [hashRefresh(refresh)]
  );
  const found = row.rows[0];
  if (!found) return null;
  const live = await loadLiveUser(found.user_id);
  if (!live) return null;
  const access = await createSessionToken({ ...live, jti: found.jti });
  // Cookie writes are only allowed in Route Handlers / Server Actions.
  // getSession() also runs from RSC pages; skip rotation there so / does not 500.
  try {
    await setSessionCookies(access, refresh);
  } catch {
    /* RSC / middleware cannot mutate cookies — session is still valid for this request */
  }
  return { ...live, jti: found.jti };
}

export async function revokeSession(jti?: string | null, userId?: string | null) {
  if (jti) {
    await query(`UPDATE sessions SET revoked_at = NOW() WHERE jti = $1 AND revoked_at IS NULL`, [jti]);
  }
  if (userId) {
    await query(
      `UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }
}

export async function setSessionCookies(accessToken: string, refreshRaw: string) {
  const jar = await cookies();
  const secure = cookieSecure();
  jar.set(COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
  jar.set(REFRESH_COOKIE, refreshRaw, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
  });
}

/** @deprecated use establishSession */
export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  const secure = cookieSecure();
  jar.set(COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  jar.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
