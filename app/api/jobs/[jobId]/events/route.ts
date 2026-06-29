import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { toApiError } from "@/lib/server/errors";
import { subscribeToJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function GET(request: Request, context: RouteContext) {
  let jobId = "unknown";

  try {
    authorizeRequest(request);
    const params = await context.params;
    jobId = params.jobId;
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        unsubscribe = subscribeToJob(jobId, (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        });
      },
      cancel() {
        unsubscribe?.();
      }
    });

    return withCors(request, new Response(stream, {
      headers: sseHeaders()
    }));
  } catch (error) {
    const apiError = toApiError(error);
    const event = {
      type: "failed",
      jobId,
      errorCode: apiError.body.error.code,
      message: apiError.body.error.message
    };

    return withCors(request, new Response(`data: ${JSON.stringify(event)}\n\n`, {
      headers: sseHeaders()
    }));
  }
}

function sseHeaders() {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  };
}
