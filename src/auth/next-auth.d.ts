import type { DefaultSession } from "next-auth";
import type { SignInRole } from "./roles";

declare module "next-auth" {
  interface User {
    schoolId?: string;
    role?: SignInRole;
  }
  interface Session {
    user: { id: string; schoolId: string; role: SignInRole } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    schoolId?: string;
    role?: SignInRole;
  }
}
