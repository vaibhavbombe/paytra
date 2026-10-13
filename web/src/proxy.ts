import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/constants";

// Optimistic check only: "is there a session cookie at all?". It saves a round
// trip for obviously signed-out visitors. It does NOT verify the cookie; every
// page and API route verifies it again via getSessionUser().

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/transactions/:path*", "/accounts/:path*", "/imports/:path*", "/rules/:path*", "/budgets/:path*", "/settings/:path*"],
};
