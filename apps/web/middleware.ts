import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const UI_SESSION_COOKIE_NAME = process.env.NEXT_PUBLIC_UI_SESSION_COOKIE_NAME ?? "agentscope_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(UI_SESSION_COOKIE_NAME)?.value;
  const isLoginRoute = pathname === "/login" || pathname === "/signup";
  const isPublicRoute = pathname === "/" || isLoginRoute;

  if (isLoginRoute && token) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (!isPublicRoute && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/agents",
    "/dashboard",
    "/insights",
    "/runs/:path*",
    "/sandbox",
    "/settings",
    "/demo",
    "/onboarding",
    "/login",
    "/signup",
  ],
};
