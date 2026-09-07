import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { query } from "@/lib/db";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { canManageUsers } from "@/lib/rbac/policies";

export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (!canManageUsers(session.role)) throw new AuthorizationError();
  let database = "down";
  try {
    await query("SELECT 1");
    database = "up";
  } catch {
    database = "down";
  }
  return NextResponse.json({
    database,
    gmailConfigured: Boolean(process.env.GMAIL_CLIENT_ID),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    documentStore: process.env.S3_BUCKET ? "s3" : "filesystem",
  });
});
