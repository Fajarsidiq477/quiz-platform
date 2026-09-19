import type { NextAuthConfig } from "next-auth";
import { isSignInRole } from "./roles";

/**
 * The part of the Auth.js config that needs no database, so the proxy can use it on its own (it
 * only decodes the cookie). Sessions are stateless signed JWTs; there is no adapter, and Auth.js
 * never creates users. The Credentials provider, which does hit the database, is added in
 * `./index.ts`, and the database is consulted again on every protected request in `./dal.ts`.
 */
export const authConfig = {
  providers: [],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    session({ session, token }) {
      if (token.uid && token.schoolId && token.role && isSignInRole(token.role)) {
        session.user.id = token.uid;
        session.user.schoolId = token.schoolId;
        session.user.role = token.role;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
