import { google } from "googleapis";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { decryptRefreshToken, encryptRefreshToken } from "@/lib/gmail-token";
import { getSessionSecret } from "@/lib/session-secret";
import { ValidationError } from "@/lib/errors";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export async function signGmailOauthState(userId: string) {
  return new SignJWT({ purpose: "gmail_oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSessionSecret());
}

export async function verifyGmailOauthState(state: string, userId: string) {
  try {
    const { payload } = await jwtVerify(state, getSessionSecret());
    return payload.sub === userId && payload.purpose === "gmail_oauth";
  } catch {
    return false;
  }
}

function headerValue(value: string, max = 200) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function encodeHeader(value: string, max = 200) {
  const clean = headerValue(value, max);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

export function assertMailAddress(address: string) {
  const to = headerValue(address, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new ValidationError("Invalid recipient address");
  }
  return to;
}

/** OAuth callback URL — matches the host you use in the browser (localhost or LAN IP). */
export function resolveGmailRedirectUri(req?: Request): string {
  // Prefer explicit env so reverse-proxy / loopback request URLs cannot override staging/prod.
  const configured = process.env.GMAIL_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (req) {
    try {
      const origin = new URL(req.url).origin;
      if (origin.startsWith("http://") || origin.startsWith("https://")) {
        return `${origin}/api/integrations/gmail/callback`;
      }
    } catch {
      /* fall through */
    }
  }
  const fromApp = process.env.APP_URL?.trim()?.replace(/\/$/, "");
  if (fromApp) return `${fromApp}/api/integrations/gmail/callback`;
  throw new Error("GMAIL_REDIRECT_URI missing");
}

export function oauth2Client(redirectUri?: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const uri = redirectUri ?? process.env.GMAIL_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !uri) {
    throw new Error("Gmail OAuth env vars missing");
  }
  return new google.auth.OAuth2(clientId, clientSecret, uri);
}

type CachedAccess = { refresh: string; access: string; expiry: number };
let accessCache: CachedAccess | null = null;

export function clearGmailAccessCache() {
  accessCache = null;
}

export async function clearGmailCredentials() {
  accessCache = null;
  await prisma.gmailCredential.deleteMany();
}

export class GmailReconnectRequiredError extends Error {
  constructor() {
    super(
      "Gmail session expired or was revoked. Click Disconnect, then Connect Gmail again and complete Google consent."
    );
    this.name = "GmailReconnectRequiredError";
  }
}

export function isGmailInvalidGrantError(e: unknown): boolean {
  const maybe = e as { message?: string; response?: { data?: { error?: string } } };
  if (maybe?.response?.data?.error === "invalid_grant") return true;
  return String(maybe?.message ?? e).includes("invalid_grant");
}

export function formatGmailApiError(e: unknown): string {
  if (e instanceof GmailReconnectRequiredError) return e.message;
  const maybe = e as { message?: string; response?: { data?: unknown } };
  if (isGmailInvalidGrantError(e)) {
    return new GmailReconnectRequiredError().message;
  }
  return maybe?.message ?? "Gmail error";
}

export async function getStoredGmailEmail(): Promise<string | null> {
  const row = await prisma.gmailCredential.findFirst();
  return row?.email ? String(row.email) : null;
}

export async function getStoredRefreshToken(): Promise<string | null> {
  const row = await prisma.gmailCredential.findFirst();
  if (!row) return null;
  return decryptRefreshToken(row.refreshEnc);
}

export async function saveTokens(refreshToken: string, email: string) {
  const enc = encryptRefreshToken(refreshToken);
  const existing = await prisma.gmailCredential.findFirst();
  if (existing) {
    await prisma.gmailCredential.update({
      where: { id: existing.id },
      data: { refreshEnc: enc, email },
    });
  } else {
    await prisma.gmailCredential.create({ data: { refreshEnc: enc, email } });
  }
}

export async function getGmailClient() {
  const refresh = await getStoredRefreshToken();
  if (!refresh) return null;
  const client = oauth2Client();
  const marginMs = 60_000;
  if (accessCache && accessCache.refresh === refresh && accessCache.expiry - marginMs > Date.now()) {
    client.setCredentials({
      refresh_token: refresh,
      access_token: accessCache.access,
      expiry_date: accessCache.expiry,
    });
    return google.gmail({ version: "v1", auth: client, timeout: 15_000 });
  }
  const row = await prisma.gmailCredential.findFirst();
  if (row?.accessEnc && row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() - marginMs > Date.now()) {
    try {
      const access = decryptRefreshToken(row.accessEnc);
      accessCache = { refresh, access, expiry: new Date(row.accessExpiresAt).getTime() };
      client.setCredentials({ refresh_token: refresh, access_token: access, expiry_date: accessCache.expiry });
      return google.gmail({ version: "v1", auth: client, timeout: 15_000 });
    } catch {
      /* decrypt failed — refresh */
    }
  }
  client.setCredentials({ refresh_token: refresh });
  try {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials({ ...client.credentials, ...credentials });
    const expiry = Number(credentials.expiry_date ?? Date.now() + 50 * 60_000);
    const access = credentials.access_token;
    if (access) {
      accessCache = { refresh, access, expiry };
      if (row) {
        await prisma.gmailCredential.update({
          where: { id: row.id },
          data: {
            accessEnc: encryptRefreshToken(access),
            accessExpiresAt: new Date(expiry),
          },
        });
      }
    }
  } catch (e) {
    if (isGmailInvalidGrantError(e)) {
      accessCache = null;
      await clearGmailCredentials();
      throw new GmailReconnectRequiredError();
    }
    throw e;
  }
  return google.gmail({ version: "v1", auth: client, timeout: 15_000 });
}

export async function sendMimeEmail(rawMime: string) {
  const gmail = await getGmailClient();
  if (!gmail) {
    throw new ValidationError(
      "Gmail not connected. An administrator must connect Gmail under the mailbox controls, then retry."
    );
  }
  const encoded = Buffer.from(rawMime).toString("base64url");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

export function buildMimeMessage(params: {
  to: string;
  subject: string;
  bodyText: string;
  from?: string;
}) {
  const to = assertMailAddress(params.to);
  const subject = encodeHeader(params.subject, 200);
  const boundary = "boundary_" + Math.random().toString(36).slice(2);
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    params.bodyText,
    "",
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

function splitBase64Lines(b64: string, lineLen = 76): string[] {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += lineLen) out.push(b64.slice(i, i + lineLen));
  return out;
}

/** multipart/mixed: plain body + optional PDF (or other) attachments */
export function buildMimeMultipartWithAttachments(params: {
  to: string;
  subject: string;
  bodyText: string;
  attachments?: { filename: string; mimeType: string; content: Buffer }[];
}): string {
  const attachments = params.attachments?.filter((a) => a.content.length > 0) ?? [];
  if (attachments.length === 0) {
    return buildMimeMessage({
      to: params.to,
      subject: params.subject,
      bodyText: params.bodyText,
    });
  }
  const to = assertMailAddress(params.to);
  const subject = encodeHeader(params.subject, 200);
  const rootBoundary = "root_" + Math.random().toString(36).slice(2);
  const altBoundary = "alt_" + Math.random().toString(36).slice(2);
  const lines: string[] = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${rootBoundary}"`,
    "",
    `--${rootBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    params.bodyText,
    "",
    `--${altBoundary}--`,
  ];
  for (const a of attachments) {
    const b64 = a.content.toString("base64");
    const fn = headerValue(a.filename.replace(/[\r\n"]/g, "_"), 180);
    const mimeType = headerValue(a.mimeType, 80);
    lines.push(
      `--${rootBoundary}`,
      `Content-Type: ${mimeType}; name="${fn}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${fn}"`,
      "",
      ...splitBase64Lines(b64),
      ""
    );
  }
  lines.push(`--${rootBoundary}--`);
  return lines.join("\r\n");
}
