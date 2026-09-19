import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth/config";
import { homeFor, requiredRoleForPath } from "@/auth/roles";

// Optimistic check only: it reads the signed cookie, with no database access. Real authorisation
// happens in src/auth/dal.ts, next to the data.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const required = requiredRoleForPath(req.nextUrl.pathname);
  if (!required) return;
  const role = req.auth?.user?.role;
  if (!role) return NextResponse.redirect(new URL("/login", req.nextUrl));
  if (role !== required) return NextResponse.redirect(new URL(homeFor(role), req.nextUrl));
});

export const config = { matcher: ["/admin/:path*", "/student/:path*"] };
