import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb } from "@/db";
import { authConfig } from "./config";
import { authenticate } from "./sign-in-policy";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      // Returning null is Auth.js's "wrong credentials"; the reason is deliberately not exposed.
      async authorize(credentials) {
        const result = await authenticate(getDb(), credentials);
        return result.ok ? result.user : null;
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // `user` is only set on the request that signs in; copy our own claims into the token then.
    jwt({ token, user }) {
      if (user?.id && user.schoolId && user.role) {
        token.uid = user.id;
        token.schoolId = user.schoolId;
        token.role = user.role;
      }
      return token;
    },
  },
});
