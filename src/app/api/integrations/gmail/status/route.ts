import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { AuthorizationError, UnauthorizedError } from "@/lib/errors";
import { canProcurement } from "@/lib/rbac/policies";
import {
  formatGmailApiError,
  getGmailClient,
  getStoredGmailEmail,
  isGmailInvalidGrantError,
  clearGmailCredentials,
} from "@/server/gmail-service";

/** Check whether stored Gmail tokens are valid (refresh succeeds). */
export const GET = withApiHandler({ body: false })(async ({ session }) => {
  if (!session) throw new UnauthorizedError();
  if (!canProcurement(session.role)) throw new AuthorizationError();

  const email = await getStoredGmailEmail();
  if (!email) {
    return NextResponse.json({ connected: false, email: null });
  }

  try {
    await getGmailClient();
    return NextResponse.json({ connected: true, email });
  } catch (e) {
    if (isGmailInvalidGrantError(e)) {
      await clearGmailCredentials();
    }
    return NextResponse.json({
      connected: false,
      email: null,
      needsReconnect: true,
      error: formatGmailApiError(e),
    });
  }
});
