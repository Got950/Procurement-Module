import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  oauth2Client,
  resolveGmailRedirectUri,
  signGmailOauthState,
} from "@/server/gmail-service";
import { cookieSecure } from "@/lib/session";

export const GET = withApiHandler({ body: false })(async ({ req, session }) => {
  if (!session) throw new UnauthorizedError();
  if (session.role !== "ADMIN") throw new AuthorizationError();
  const redirectUri = resolveGmailRedirectUri(req);
  const client = oauth2Client(redirectUri);
  const state = await signGmailOauthState(session.sub);
  const jar = await cookies();
  jar.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: 600,
  });
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
  });
  return NextResponse.redirect(url);
});
