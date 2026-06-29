import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { toApiError } from "@/lib/server/errors";
import { cancelJob } from "@/lib/server/jobs";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    authorizeRequest(request);
    const { jobId } = await context.params;
    await cancelJob(jobId);
    return withCors(request, Response.json({ ok: true }));
  } catch (error) {
    const apiError = toApiError(error);
    return withCors(request, Response.json(apiError.body, { status: apiError.status }));
  }
}
