import { type DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      mfaEnrollmentRequired: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    mfaEnrollmentRequired?: boolean;
    mfaVerified?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    mfaEnrollmentRequired?: boolean;
    mfaVerified?: boolean;
    invalidated?: boolean;
  }
}
