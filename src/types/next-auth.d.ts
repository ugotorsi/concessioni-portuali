import { type DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      mfaEnrollmentRequired: boolean;
      mfaVerified: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    mfaEnrollmentRequired?: boolean;
    mfaVerified?: boolean;
    authVersion?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    mfaEnrollmentRequired?: boolean;
    mfaVerified?: boolean;
    authVersion?: string;
    invalidated?: boolean;
  }
}
