import fs from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

import { CoCatError } from "@/lib/server/errors";
import { runFfmpegRemux } from "@/lib/server/ffmpeg";
import { createProcessingTempDir } from "@/lib/server/processing-instance";
import { safeFileName } from "@/lib/utils";

export const remuxSchema = z.object({
  container: z.enum(["mp4", "webm", "mkv", "m4a"]).default("mp4"),
  fileName: z.string().trim().max(120).optional()
});

export type RemuxResult = {
  body: fs.ReadStream;
  cleanup(): void;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export async function remuxUploads({
  audioFile,
  container,
  fileName,
  mediaFile,
  signal
}: {
  audioFile?: File;
  container: z.infer<typeof remuxSchema>["container"];
  fileName?: string;
  mediaFile: File;
  signal?: AbortSignal;
}): Promise<RemuxResult> {
  let workDir: string | undefined;

  try {
    workDir = await createProcessingTempDir("remux");

    const inputPath = path.join(/*turbopackIgnore: true*/ workDir, `input.${extensionFromFile(mediaFile, "media")}`);
    const audioPath = audioFile
      ? path.join(/*turbopackIgnore: true*/ workDir, `audio.${extensionFromFile(audioFile, "audio")}`)
      : undefined;
    const outputFileName = outputNameFor(mediaFile, fileName, container);
    const outputPath = path.join(/*turbopackIgnore: true*/ workDir, outputFileName);

    await writeUploadFile(mediaFile, inputPath);

    if (audioFile && audioPath) {
      await writeUploadFile(audioFile, audioPath);
    }

    await runFfmpegRemux({
      audioPath,
      inputPath,
      outputPath,
      signal
    });

    const outputStats = await stat(/*turbopackIgnore: true*/ outputPath);
    const body = fs.createReadStream(/*turbopackIgnore: true*/ outputPath);
    const cleanupDir = workDir;
    workDir = undefined;

    return {
      body,
      cleanup() {
        void rm(/*turbopackIgnore: true*/ cleanupDir, { recursive: true, force: true });
      },
      fileName: outputFileName,
      mimeType: mimeTypeForContainer(container),
      sizeBytes: outputStats.size
    };
  } catch (error) {
    if (workDir) {
      await rm(/*turbopackIgnore: true*/ workDir, { recursive: true, force: true });
    }

    throw error;
  }
}

export function requireUploadFile(value: FormDataEntryValue | null, message: string) {
  if (!isUploadFile(value)) {
    throw new CoCatError("BAD_REQUEST", message);
  }

  return value;
}

export function optionalUploadFile(value: FormDataEntryValue | null) {
  return isUploadFile(value) && value.size > 0 ? value : undefined;
}

async function writeUploadFile(file: File, filePath: string) {
  await pipeline(
    Readable.fromWeb(file.stream() as NodeReadableStream<Uint8Array>),
    fs.createWriteStream(/*turbopackIgnore: true*/ filePath)
  );
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File && value.size > 0;
}

function extensionFromFile(file: File, fallback: string) {
  const extension = file.name.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();
  return extension ?? fallback;
}

function outputNameFor(mediaFile: File, requestedName: string | undefined, container: string) {
  const rawBaseName = requestedName || mediaFile.name.replace(/\.[^.]+$/, "") || "cocat-remux";
  return `${stripMatchingExtension(safeFileName(rawBaseName, "cocat-remux"), container)}.${container}`;
}

function mimeTypeForContainer(container: string) {
  const mimeTypes: Record<string, string> = {
    m4a: "audio/mp4",
    mkv: "video/x-matroska",
    mp4: "video/mp4",
    webm: "video/webm"
  };

  return mimeTypes[container] ?? "application/octet-stream";
}

function stripMatchingExtension(fileName: string, extension: string) {
  return fileName.replace(new RegExp(`\\.${escapeRegExp(extension)}$`, "i"), "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
