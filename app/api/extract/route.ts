import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";

import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { toApiError } from "@/lib/server/errors";
import { extractWithProvider, toPublicExtractResult } from "@/lib/server/providers";
import { readJsonRequest } from "@/lib/server/request";
import { createSourceToken } from "@/lib/server/source-tokens";

export const runtime = "nodejs";

const extractSchema = z.object({
  url: z.string().min(1).max(4096)
});

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function POST(request: Request) {
  try {
    authorizeRequest(request);
    const body = extractSchema.parse(await readJsonRequest(request));
    const source = await extractWithProvider(body.url, { requestId: crypto.randomUUID() });
    const sourceToken = createSourceToken(source);

    return withCors(request, NextResponse.json({
      media: toPublicExtractResult(source, sourceToken)
    }));
  } catch (error) {
    const apiError = toApiError(error);
    return withCors(request, NextResponse.json(apiError.body, { status: apiError.status }));
  }
}
