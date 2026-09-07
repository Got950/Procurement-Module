import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getSessionSecret } from "./lib/session-secret";
import { assertSafeOrigin } from "./lib/csrf";

const COOKIE = "pharma_session";
const REFRESH_COOKIE = "pharma_refresh";

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/sounds/") ||
    /\.(png|jpe?g|gif|svg|webp|ico|wav|mp3|mp4|webm|woff2?)$/i.test(pathname)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const correlationId = request.headers.get("x-request-id") || crypto.randomUUID();

  if (
    pathname.startsWith("/api") &&
    !assertSafeOrigin(request) &&
    pathname !== "/api/session" &&
    !pathname.startsWith("/api/integrations/gmail/callback")
  ) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const pass = () => {
    const res = NextResponse.next();
    res.headers.set("x-correlation-id", correlationId);
    return res;
  };

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    isPublicAsset(pathname) ||
    pathname === "/api/session" ||
    pathname.startsWith("/api/auth/forgot-password") ||
    pathname.startsWith("/api/auth/reset-password") ||
    pathname.startsWith("/api/auth/register") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/integrations/gmail/callback")
  ) {
    return pass();
  }
  if (pathname.startsWith("/api")) {
    return pass();
  }
  const token = request.cookies.get(COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!token && !refresh) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  if (token) {
    try {
      await jwtVerify(token, getSessionSecret());
      return pass();
    } catch {
      /* expired access: allow through if refresh exists so RSC can rotate */
    }
  }
  if (refresh) return pass();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
