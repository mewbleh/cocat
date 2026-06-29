import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { DEFAULT_PROCESSING_SETTINGS, type JobProgressEvent, type JobStatus, type MediaMode, type ProcessingSettings } from "@/lib/contracts";
import { getServerConfig } from "@/lib/server/config";
import { CoCatError, toCoCatError } from "@/lib/server/errors";
import { runFfmpegDownload } from "@/lib/server/ffmpeg";
import { safeFetch } from "@/lib/server/http";
import { createProcessingTempDir } from "@/lib/server/processing-instance";
import { optionNeedsFfmpeg } from "@/lib/server/providers/shared";
import type { ResolvedMedia } from "@/lib/server/providers/types";
import { resolveWithProvider } from "@/lib/server/providers";
import { verifySourceToken } from "@/lib/server/source-tokens";
import { validatePublicUrl } from "@/lib/server/url-safety";

type JobRecord = {
  id: string;
  status: JobStatus;
  createdAt: number;
  expiresAt: number;
  sourceToken: string;
  optionId: string;
  mode: MediaMode;
  settings: ProcessingSettings;
  resolvedMedia?: ResolvedMedia;
  outputPath?: string;
  outputDir?: string;
  errorCode?: string;
  errorMessage?: string;
  events: JobProgressEvent[];
  listeners: Set<(event: JobProgressEvent) => void>;
  abortController: AbortController;
};

type JobState = {
  cleanupTimer: NodeJS.Timeout | null;
  jobs: Map<string, JobRecord>;
};

const JOB_STATE_KEY = "__cocatJobState";
const MAX_EVENTS_PER_JOB = 200;
const jobState = getJobState();

export async function createDownloadJob({
  sourceToken,
  optionId,
  mode,
  settings = DEFAULT_PROCESSING_SETTINGS
}: {
  sourceToken: string;
  optionId: string;
  mode: MediaMode;
  settings?: ProcessingSettings;
}) {
  const config = getServerConfig();

  await removeExpiredJobs();
  await evictStoredJobs(config.maxStoredJobs - 1);

  if (activeJobCount() >= config.maxActiveJobs) {
    throw new CoCatError("JOB_LIMIT_REACHED", "CoCat is already handling the maximum number of downloads.");
  }

  if (jobState.jobs.size >= config.maxStoredJobs) {
    throw new CoCatError("JOB_LIMIT_REACHED", "CoCat has too many stored download jobs. Try again after older jobs expire.");
  }

  const source = verifySourceToken(sourceToken);
  const selectedOption = source.options.find((option) => option.id === optionId);

  if (!selectedOption) {
    throw new CoCatError("BAD_REQUEST", "That download option is not available for this source.");
  }

  if (selectedOption.mode !== mode) {
    throw new CoCatError("BAD_REQUEST", "The requested mode does not match the selected option.");
  }

  validateSettingsForOption(selectedOption, settings);

  const job: JobRecord = {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: Date.now(),
    expiresAt: Date.now() + config.jobTtlSeconds * 1000,
    sourceToken,
    optionId,
    mode,
    settings,
    events: [],
    listeners: new Set(),
    abortController: new AbortController()
  };

  jobState.jobs.set(job.id, job);
  emitJobEvent(job, { type: "queued", jobId: job.id, message: "Download queued" });
  ensureJobCleanup();
  void runJob(job);

  return job.id;
}

export function getJob(jobId: string) {
  const job = jobState.jobs.get(jobId);

  if (!job || job.expiresAt <= Date.now()) {
    if (job) {
      void removeJob(job.id);
    }

    throw new CoCatError("JOB_NOT_FOUND", "That download job no longer exists.");
  }

  return job;
}

export function subscribeToJob(jobId: string, listener: (event: JobProgressEvent) => void) {
  const job = getJob(jobId);

  job.events.forEach(listener);
  job.listeners.add(listener);

  return () => {
    job.listeners.delete(listener);
  };
}

export async function cancelJob(jobId: string) {
  const job = getJob(jobId);

  if (job.status === "running" || job.status === "queued") {
    job.abortController.abort();
    markJobCancelled(job);
    return;
  }

  markJobCancelled(job);
  await removeJob(jobId);
}

export async function streamJobFile(jobId: string) {
  const job = getJob(jobId);

  if (job.status !== "complete" || !job.resolvedMedia) {
    throw new CoCatError("JOB_NOT_READY", "That download is not ready yet.");
  }

  if (job.outputPath) {
    return {
      fileName: job.resolvedMedia.fileName,
      mimeType: job.resolvedMedia.mimeType ?? "application/octet-stream",
      sizeBytes: await fileSize(job.outputPath),
      body: fs.createReadStream(job.outputPath)
    };
  }

  const response = await fetchResolvedMedia(job.resolvedMedia);

  if (!response.ok || !response.body) {
    throw new CoCatError("PROVIDER_FAILED", `The media server returned HTTP ${response.status}.`);
  }

  return {
    fileName: job.resolvedMedia.fileName,
    mimeType: job.resolvedMedia.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream",
    sizeBytes: job.resolvedMedia.sizeBytes ?? sizeFromHeaders(response.headers),
    body: response.body
  };
}

async function fetchResolvedMedia(media: ResolvedMedia) {
  const headerAttempts = uniqueHeaderAttempts([media.headers, ...(media.fallbackHeaders ?? [])]);
  let lastResponse: Response | undefined;

  for (const headers of headerAttempts) {
    const response = await safeFetch(media.url, { headers });

    if (response.ok && response.body) {
      return response;
    }

    lastResponse = response;

    if (!shouldRetryMediaResponse(response.status)) {
      return response;
    }

    await response.body?.cancel().catch(() => undefined);
  }

  return lastResponse ?? safeFetch(media.url, { headers: media.headers });
}

function uniqueHeaderAttempts(attempts: Array<Record<string, string> | undefined>) {
  const seen = new Set<string>();
  const uniqueAttempts: Array<Record<string, string> | undefined> = [];

  for (const attempt of attempts) {
    const key = JSON.stringify(attempt ?? {});

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueAttempts.push(attempt);
  }

  return uniqueAttempts.length > 0 ? uniqueAttempts : [undefined];
}

function shouldRetryMediaResponse(status: number) {
  return status === 401 || status === 403 || status === 429;
}

function sizeFromHeaders(headers: Headers) {
  const contentRange = headers.get("content-range");
  const rangeSize = contentRange?.match(/\/(\d+)$/)?.[1];
  const sizeBytes = Number.parseInt(rangeSize ?? headers.get("content-length") ?? "", 10);

  return Number.isFinite(sizeBytes) ? sizeBytes : undefined;
}

export function clearJobsForTests() {
  for (const job of jobState.jobs.values()) {
    job.abortController.abort();
  }

  jobState.jobs.clear();
}

async function runJob(job: JobRecord) {
  try {
    throwIfJobCancelled(job);
    job.status = "running";
    emitJobEvent(job, { type: "resolving", jobId: job.id, message: "Resolving media", progress: 8 });
    const source = verifySourceToken(job.sourceToken);
    const resolvedMedia = await resolveWithProvider(
      source,
      job.optionId,
      { requestId: job.id, signal: job.abortController.signal },
      job.settings
    );
    throwIfJobCancelled(job);
    job.resolvedMedia = resolvedMedia;

    if (resolvedMedia.transport === "direct" && !resolvedMedia.requiresFfmpeg && job.settings.streamHandling !== "ffmpeg") {
      setJobStatus(job, "complete", "Download ready", 100);
      return;
    }

    emitJobEvent(job, {
      type: processingEventType(job.settings.processingPolicy, resolvedMedia),
      jobId: job.id,
      message: processingMessage(job.settings.processingPolicy, resolvedMedia),
      progress: 18
    });
    await assertResolvedMediaUrlsArePublic(resolvedMedia);
    throwIfJobCancelled(job);
    const outputDir = await createJobTempDir(job.id);
    const outputPath = path.join(outputDir, resolvedMedia.fileName);
    job.outputDir = outputDir;
    job.outputPath = outputPath;

    await runFfmpegDownload({
      media: resolvedMedia,
      outputPath,
      signal: job.abortController.signal,
      onProgress(progress) {
        emitJobEvent(job, {
          type: "progress",
          jobId: job.id,
          progress: progress.progress,
          message: progress.message
        });
      }
    });

    setJobStatus(job, "complete", "Download ready", 100);
  } catch (error) {
    const cocatError = toCoCatError(error);

    if (job.abortController.signal.aborted || cocatError.code === "CANCELLED") {
      markJobCancelled(job);
      await removeJob(job.id);
      return;
    }

    job.status = "failed";
    job.errorCode = cocatError.code;
    job.errorMessage = cocatError.message;
    emitJobEvent(job, {
      type: job.status,
      jobId: job.id,
      errorCode: cocatError.code,
      message: cocatError.message
    });
  }
}

function setJobStatus(job: JobRecord, status: JobStatus, message: string, progress?: number) {
  job.status = status;
  emitJobEvent(job, {
    type: status,
    jobId: job.id,
    message,
    progress,
    downloadUrl: status === "complete" ? `/api/jobs/${job.id}/file` : undefined
  });
}

function markJobCancelled(job: JobRecord) {
  if (job.status === "cancelled") {
    return;
  }

  job.status = "cancelled";
  emitJobEvent(job, { type: "cancelled", jobId: job.id, message: "Download cancelled" });
}

function throwIfJobCancelled(job: JobRecord) {
  if (job.status === "cancelled" || job.abortController.signal.aborted) {
    throw new CoCatError("CANCELLED", "The download was cancelled.");
  }
}

function emitJobEvent(job: JobRecord, event: JobProgressEvent) {
  job.events.push(event);

  if (job.events.length > MAX_EVENTS_PER_JOB) {
    job.events.splice(0, job.events.length - MAX_EVENTS_PER_JOB);
  }

  for (const listener of job.listeners) {
    listener(event);
  }
}

function activeJobCount() {
  return [...jobState.jobs.values()].filter((job) => job.status === "queued" || job.status === "running").length;
}

function validateSettingsForOption(
  option: ReturnType<typeof verifySourceToken>["options"][number],
  settings: ProcessingSettings
) {
  const audioContainers = new Set(["mp3", "m4a", "opus"]);

  if (settings.streamHandling === "direct" && optionNeedsFfmpeg(option, settings)) {
    throw new CoCatError("BAD_REQUEST", "That option requires ffmpeg processing, but stream handling is set to direct.");
  }

  if (option.mode === "video" && audioContainers.has(settings.outputContainer)) {
    throw new CoCatError("BAD_REQUEST", "Audio-only containers cannot be used for video downloads.");
  }

  if (option.isAdaptive && !settings.mergeAudioVideo && option.hasVideo && !option.hasAudio) {
    throw new CoCatError("BAD_REQUEST", "That video-only option needs audio/video merging enabled.");
  }
}

function processingEventType(policy: ProcessingSettings["processingPolicy"], media: ResolvedMedia): JobProgressEvent["type"] {
  if (policy === "transcode" || (media.mode === "audio" && media.settings.audioFormat !== "original")) {
    return "transcoding";
  }

  if (policy === "remux" || media.transport === "hls" || media.transport === "dash") {
    return "remuxing";
  }

  return media.audioUrl ? "merging" : "downloading";
}

function processingMessage(policy: ProcessingSettings["processingPolicy"], media: ResolvedMedia) {
  if (policy === "transcode" || (media.mode === "audio" && media.settings.audioFormat !== "original")) {
    return "Transcoding media";
  }

  if (policy === "remux") {
    return "Remuxing media";
  }

  if (media.transport === "hls" || media.transport === "dash") {
    return "Remuxing stream";
  }

  if (media.audioUrl) {
    return "Merging video and audio";
  }

  return "Downloading media";
}

export async function assertResolvedMediaUrlsArePublic(media: Pick<ResolvedMedia, "url" | "audioUrl">) {
  await validatePublicUrl(media.url);

  if (media.audioUrl) {
    await validatePublicUrl(media.audioUrl);
  }
}

async function createJobTempDir(jobId: string) {
  return createProcessingTempDir(jobId);
}

async function fileSize(filePath: string) {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
}

async function removeJob(jobId: string) {
  const job = jobState.jobs.get(jobId);

  if (!job) {
    return;
  }

  jobState.jobs.delete(jobId);

  if (job.outputDir) {
    await rm(job.outputDir, { recursive: true, force: true });
  }
}

async function removeExpiredJobs(now = Date.now()) {
  const expiredJobs = [...jobState.jobs.values()].filter((job) => job.expiresAt <= now);

  for (const job of expiredJobs) {
    job.status = "expired";
    emitJobEvent(job, { type: "expired", jobId: job.id, message: "Download expired" });
    await removeJob(job.id);
  }
}

async function evictStoredJobs(maxEntries: number) {
  while (jobState.jobs.size > maxEntries) {
    const evictedJob = [...jobState.jobs.values()].find((job) => job.status !== "queued" && job.status !== "running");

    if (!evictedJob) {
      return;
    }

    await removeJob(evictedJob.id);
  }
}

function ensureJobCleanup() {
  if (jobState.cleanupTimer) {
    return;
  }

  jobState.cleanupTimer = setInterval(() => {
    void removeExpiredJobs();

    if (jobState.jobs.size === 0 && jobState.cleanupTimer) {
      clearInterval(jobState.cleanupTimer);
      jobState.cleanupTimer = null;
    }
  }, 30_000);

  jobState.cleanupTimer.unref?.();
}

function getJobState() {
  const globalStore = globalThis as typeof globalThis & {
    [JOB_STATE_KEY]?: JobState;
  };

  globalStore[JOB_STATE_KEY] ??= {
    cleanupTimer: null,
    jobs: new Map<string, JobRecord>()
  };

  return globalStore[JOB_STATE_KEY];
}
