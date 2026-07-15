import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/api/cron/flex-import",
  "/api/flex/run",
  "/_next",
  "/favicon.ico",
];

function redirectEncodedQueryPath(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (!/%3f/i.test(pathname)) return null;

  try {
    const decodedPath = decodeURIComponent(pathname);
    const queryIndex = decodedPath.indexOf("?");
    if (queryIndex <= 0) return null;

    const targetPath = decodedPath.slice(0, queryIndex);
    if (!targetPath.startsWith("/") || targetPath.startsWith("//") || targetPath.includes("\\")) {
      return null;
    }

    const targetUrl = new URL(req.url);
    targetUrl.pathname = targetPath;
    const targetParams = new URLSearchParams(decodedPath.slice(queryIndex + 1));
    for (const [key, value] of searchParams) {
      targetParams.append(key, value);
    }
    targetUrl.search = targetParams.toString();
    return NextResponse.redirect(targetUrl);
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const encodedQueryRedirect = redirectEncodedQueryPath(req);
  if (encodedQueryRedirect) {
    return encodedQueryRedirect;
  }

  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  if (isPublic) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
