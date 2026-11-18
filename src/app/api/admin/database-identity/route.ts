import { requireAdminWithMfa } from "@/lib/auth";
import { auditFailure, auditSuccess } from "@/server/audit/auditLog";
import {
  getDatabaseIdentityDiagnostic,
  type DatabaseIdentityDiagnostic,
} from "@/server/runtime/databaseIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  Vary: "Cookie, Authorization",
};

interface DatabaseIdentityResponse {
  neonProjectId: string | null;
  neonBranchId: string | null;
  neonEndpointId: string | null;
  databaseName: string | null;
  databaseConnected: boolean;
}

function response(body: DatabaseIdentityResponse, status: number): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

function unavailableIdentity(): DatabaseIdentityResponse {
  return {
    neonProjectId: null,
    neonBranchId: null,
    neonEndpointId: null,
    databaseName: null,
    databaseConnected: false,
  };
}

export async function GET(): Promise<Response> {
  let admin;
  try {
    admin = await requireAdminWithMfa();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return response(unavailableIdentity(), 401);
    }
    if (error instanceof Error && [
      "ADMIN_REQUIRED",
      "MFA_VERIFICATION_REQUIRED",
    ].includes(error.message)) {
      return response(unavailableIdentity(), 403);
    }
    console.error({
      event: "admin_database_identity_auth_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(unavailableIdentity(), 503);
  }

  let identity: DatabaseIdentityDiagnostic;
  try {
    identity = await getDatabaseIdentityDiagnostic();
  } catch (error) {
    console.error({
      event: "admin_database_identity_query_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(unavailableIdentity(), 503);
  }

  const body: DatabaseIdentityResponse = {
    neonProjectId: identity.neonProjectId,
    neonBranchId: identity.neonBranchId,
    neonEndpointId: identity.endpointId,
    databaseName: identity.databaseName,
    databaseConnected: identity.databaseConnected,
  };
  const audit = identity.databaseConnected ? auditSuccess : auditFailure;

  try {
    await audit({
      azione: "ADMIN_DATABASE_IDENTITY_READ",
      entita: "RuntimeDatabaseIdentity",
      actor: {
        userId: admin.id,
        userEmail: admin.email,
        userRole: admin.role,
      },
    });
  } catch (error) {
    console.error({
      event: "admin_database_identity_audit_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response(unavailableIdentity(), 503);
  }

  return response(body, identity.databaseConnected ? 200 : 503);
}
