import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { toApiError } from "@/lib/server/errors";
import { createDownloadJob } from "@/lib/server/jobs";
import { readJsonRequest } from "@/lib/server/request";
import { normalizeProcessingSettings } from "@/lib/processing-settings";

export const runtime = "nodejs";

const createJobSchema = z.object({
  sourceToken: z.string().min(1),
  optionId: z.string().min(1),
  mode: z.enum(["video", "audio", "photo", "gif"]),
  settings: z.unknown().optional()
});

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function POST(request: Request) {
  try {
    authorizeRequest(request);
    const body = createJobSchema.parse(await readJsonRequest(request));
    const jobId = await createDownloadJob({
      ...body,
      settings: normalizeProcessingSettings(body.settings)
    });

    return withCors(request, NextResponse.json({ jobId }, { status: 202 }));
  } catch (error) {
    const apiError = toApiError(error);
    return withCors(request, NextResponse.json(apiError.body, { status: apiError.status }));
  }
}
