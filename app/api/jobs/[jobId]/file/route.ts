import { Readable } from "node:stream";

import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { CoCatError, toApiError } from "@/lib/server/errors";
import { streamJobFile } from "@/lib/server/jobs";
import { safeFileName } from "@/lib/utils";

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
  try {
    authorizeRequest(request);
    const { jobId } = await context.params;
    const file = await streamJobFile(jobId);
    const headers = new Headers({
      "content-type": file.mimeType,
      "content-disposition": contentDisposition(file.fileName),
      "cache-control": "private, no-store"
    });

    if (file.sizeBytes != null) {
      headers.set("content-length", String(file.sizeBytes));
    }

    const body = toResponseBody(file.body);

    return withCors(request, new Response(body as BodyInit, { headers }));
  } catch (error) {
    const apiError = toApiError(error);
    return withCors(request, Response.json(apiError.body, { status: apiError.status }));
  }
}

function contentDisposition(fileName: string) {
  const cleanFileName = safeFileName(fileName);
  return `attachment; filename="${cleanFileName}"; filename*=UTF-8''${encodeURIComponent(cleanFileName)}`;
}

function toResponseBody(body: unknown) {
  if (body instanceof Readable) {
    return Readable.toWeb(body);
  }

  if (body instanceof ReadableStream) {
    return body;
  }

  throw new CoCatError("PROVIDER_FAILED", "The media server returned an unreadable file stream.");
}
