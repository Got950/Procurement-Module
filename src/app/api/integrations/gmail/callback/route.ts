import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withApiHandler } from "@/lib/api-handler";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  oauth2Client,
  resolveGmailRedirectUri,
  saveTokens,
  verifyGmailOauthState,
} from "@/server/gmail-service";
import { appendAudit } from "@/server/audit-service";

function appBase(req: Request) {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export const GET = withApiHandler({ auth: false, body: false })(async ({ req, session }) => {
  const url = new URL(req.url);
  const base = appBase(req);
  const fail = (reason: string) =>
    NextResponse.redirect(`${base}/dashboard?gmail=error&reason=${encodeURIComponent(reason)}`);

  if (!session || session.role !== "ADMIN") return fail("unauthorized");

  const oauthError = url.searchParams.get("error");
  if (oauthError) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const cookieState = jar.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  jar.set(GMAIL_OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  if (!code || !state || !cookieState || state !== cookieState) return fail("invalid_state");
  if (!(await verifyGmailOauthState(state, session.sub))) return fail("invalid_state");

  try {
    const redirectUri = resolveGmailRedirectUri(req);
    const client = oauth2Client(redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) return fail("no_refresh_token");
    client.setCredentials(tokens);
    const gmail = (await import("googleapis")).google.gmail({ version: "v1", auth: client });
    const prof = await gmail.users.getProfile({ userId: "me" });
    const email = prof.data.emailAddress ?? "unknown";
    await saveTokens(tokens.refresh_token, email);
    await appendAudit({
      entityType: "GmailCredential",
      entityId: email,
      action: "GMAIL_CONNECTED",
      actorId: session.sub,
      diff: { email },
    });
    return NextResponse.redirect(`${base}/dashboard?gmail=connected&email=${encodeURIComponent(email)}`);
  } catch {
    return fail("token_exchange_failed");
  }
});
