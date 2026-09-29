import { createAssistedVerificationRouteHandlers } from "@/server/legal-research/assisted-verification-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, PUT, PATCH, POST } = createAssistedVerificationRouteHandlers();
