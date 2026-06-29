import { Readable } from "node:stream";

import { authorizeRequest } from "@/lib/server/auth";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { toApiError } from "@/lib/server/errors";
import { CoCatError } from "@/lib/server/errors";
import {
  assertRequestBodyWithinLimit,
  assertUploadFilesWithinLimit,
  withProcessingSlot
} from "@/lib/server/processing-instance";
import { optionalUploadFile, remuxSchema, remuxUploads, requireUploadFile } from "@/lib/server/remux";
import { safeFileName } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function POST(request: Request) {
  try {
    authorizeRequest(request);
    assertRequestBodyWithinLimit(request);

    return await withProcessingSlot("remux", async () => {
      const formData = await readMultipartRequest(request);
      const mediaFile = requireUploadFile(formData.get("media"), "Choose a media file to remux.");
      const audioFile = optionalUploadFile(formData.get("audio"));
      assertUploadFilesWithinLimit([mediaFile, audioFile]);

      const fields = remuxSchema.parse({
        container: formData.get("container") ?? undefined,
        fileName: formData.get("fileName") ?? undefined
      });
      const file = await remuxUploads({
        audioFile,
        container: fields.container,
        fileName: fields.fileName,
        mediaFile,
        signal: request.signal
      });

      file.body.once("close", file.cleanup);

      return withCors(request, new Response(Readable.toWeb(file.body) as BodyInit, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": contentDisposition(file.fileName),
          "content-length": String(file.sizeBytes),
          "content-type": file.mimeType
        }
      }));
    });
  } catch (error) {
    const apiError = toApiError(error);
    return withCors(request, Response.json(apiError.body, { status: apiError.status }));
  }
}

async function readMultipartRequest(request: Request) {
  try {
    return await request.formData();
  } catch (error) {
    throw new CoCatError("BAD_REQUEST", "The request body must be multipart form data.", error);
  }
}

function contentDisposition(fileName: string) {
  const cleanFileName = safeFileName(fileName);
  return `attachment; filename="${cleanFileName}"; filename*=UTF-8''${encodeURIComponent(cleanFileName)}`;
}
