import crypto from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";

import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";

type ProcessingKind = "remux";

type ProcessingState = {
  active: Map<ProcessingKind, number>;
};

const PROCESSING_STATE_KEY = "__cocatProcessingInstanceState";
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  "aac",
  "flac",
  "m4a",
  "m4v",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "opus",
  "wav",
  "webm"
]);

export async function withProcessingSlot<T>(kind: ProcessingKind, task: () => Promise<T>): Promise<T> {
  const release = acquireProcessingSlot(kind);

  try {
    return await task();
  } finally {
    release();
  }
}

export function assertRequestBodyWithinLimit(request: Request) {
  const contentLength = request.headers.get("content-length");

  if (!contentLength) {
    throw new CoCatError("BAD_REQUEST", "Upload requests must include a content length.");
  }

  const sizeBytes = Number.parseInt(contentLength, 10);

  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    throw new CoCatError("BAD_REQUEST", "Upload content length is invalid.");
  }

  assertBytesWithinUploadLimit(sizeBytes);
}

export function assertUploadFilesWithinLimit(files: Array<File | undefined>) {
  const totalBytes = files.reduce((total, file) => total + (file?.size ?? 0), 0);
  assertBytesWithinUploadLimit(totalBytes);

  for (const file of files) {
    if (file) {
      assertAllowedUploadExtension(file.name);
    }
  }
}

export async function createProcessingTempDir(prefix: string) {
  const tempDir = processingTempRoot();
  await mkdir(/*turbopackIgnore: true*/ tempDir, { recursive: true });

  const workDir = await mkdtemp(path.join(/*turbopackIgnore: true*/ tempDir, `${prefix}-${crypto.randomUUID()}-`));
  assertPathInside(tempDir, workDir);

  return workDir;
}

export function processingTempRoot() {
  return path.resolve(/*turbopackIgnore: true*/ getServerConfig().tempDir);
}

function acquireProcessingSlot(kind: ProcessingKind) {
  const config = getServerConfig();
  const state = getProcessingState();
  const activeCount = state.active.get(kind) ?? 0;
  const limit = kind === "remux" ? config.maxActiveRemuxJobs : 1;

  if (activeCount >= limit) {
    throw new CoCatError("JOB_LIMIT_REACHED", "CoCat is already handling the maximum number of processing tasks.");
  }

  state.active.set(kind, activeCount + 1);

  return () => {
    const nextCount = Math.max(0, (state.active.get(kind) ?? 1) - 1);

    if (nextCount === 0) {
      state.active.delete(kind);
      return;
    }

    state.active.set(kind, nextCount);
  };
}

function assertBytesWithinUploadLimit(sizeBytes: number) {
  const maxBytes = getServerConfig().maxUploadBytes;

  if (sizeBytes > maxBytes) {
    throw new CoCatError("PAYLOAD_TOO_LARGE", `Uploads are limited to ${formatBytes(maxBytes)}.`);
  }
}

function assertAllowedUploadExtension(fileName: string) {
  const extension = fileName.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toLowerCase();

  if (!extension || !ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new CoCatError("BAD_REQUEST", "That file type is not supported for remuxing.");
  }
}

function assertPathInside(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new CoCatError("INTERNAL_ERROR", "CoCat refused to use an unsafe processing path.");
  }
}

function formatBytes(bytes: number) {
  const mebibytes = bytes / 1024 / 1024;
  return `${Math.round(mebibytes)} MiB`;
}

function getProcessingState() {
  const globalStore = globalThis as typeof globalThis & {
    [PROCESSING_STATE_KEY]?: ProcessingState;
  };

  globalStore[PROCESSING_STATE_KEY] ??= {
    active: new Map<ProcessingKind, number>()
  };

  return globalStore[PROCESSING_STATE_KEY];
}
