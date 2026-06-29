import { spawn } from "node:child_process";

import { CoCatError } from "@/lib/server/errors";
import { createFfmpegInputProxy } from "@/lib/server/ffmpeg-input-proxy";
import type { ResolvedMedia } from "@/lib/server/providers/types";

const FFMPEG_MISSING_MESSAGE =
  "ffmpeg is not installed or is not available in this server's PATH. Install ffmpeg on the CoCat server, use the Docker image, or choose a direct format.";
const FFMPEG_PROTOCOL_WHITELIST = "file,http,https,tcp,tls,crypto,data";
const FFMPEG_STDERR_TAIL_LENGTH = 4000;

export async function checkFfmpegAvailable() {
  return new Promise<boolean>((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

export type FfmpegProgress = {
  progress: number;
  message: string;
};

export async function runFfmpegDownload({
  media,
  outputPath,
  signal,
  onProgress
}: {
  media: ResolvedMedia;
  outputPath: string;
  signal: AbortSignal;
  onProgress: (progress: FfmpegProgress) => void;
}) {
  await assertFfmpegAvailable();

  const proxy = await createFfmpegInputProxy();
  const proxiedMedia = {
    ...media,
    url: proxy.proxyUrl({
      fallbackHeaders: media.fallbackHeaders,
      headers: media.headers,
      transport: media.transport,
      url: media.url
    }),
    audioUrl: media.audioUrl
      ? proxy.proxyUrl({
          fallbackHeaders: media.fallbackHeaders,
          headers: media.headers,
          transport: "direct",
          url: media.audioUrl
        })
      : undefined,
    headers: undefined,
    fallbackHeaders: undefined
  } satisfies ResolvedMedia;
  const args = buildFfmpegArgs(proxiedMedia, outputPath);

  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let isSettled = false;
    let stderrTail = "";

    const settle = (callback: () => void) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      signal.removeEventListener("abort", abort);
      void proxy.close().catch(() => undefined).finally(callback);
    };

    const abort = () => {
      child.kill("SIGTERM");
      settle(() => reject(new CoCatError("CANCELLED", "The download was cancelled.")));
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = appendBounded(stderrTail, chunk);
      const timeSeconds = parseFfmpegTime(chunk);

      if (timeSeconds != null && media.durationSeconds && media.durationSeconds > 0) {
        const progress = Math.min(98, Math.round((timeSeconds / media.durationSeconds) * 100));
        onProgress({ progress, message: `Processed ${Math.round(timeSeconds)} seconds` });
      }
    });

    child.once("error", (error) => {
      settle(() => reject(new CoCatError("PROVIDER_FAILED", ffmpegStartErrorMessage(error), error)));
    });

    child.once("exit", (code) => {
      if (code === 0) {
        settle(resolve);
        return;
      }

      settle(() => reject(new CoCatError("PROVIDER_FAILED", formatFfmpegExitError(code, stderrTail, proxy.diagnostics()))));
    });
  });
}

export async function runFfmpegRemux({
  audioPath,
  inputPath,
  outputPath,
  signal
}: {
  audioPath?: string;
  inputPath: string;
  outputPath: string;
  signal?: AbortSignal;
}) {
  await assertFfmpegAvailable();

  const args = buildFfmpegRemuxArgs({ audioPath, inputPath, outputPath });

  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let isSettled = false;
    let stderrTail = "";

    const settle = (callback: () => void) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };

    const abort = () => {
      child.kill("SIGTERM");
      settle(() => reject(new CoCatError("CANCELLED", "The remux was cancelled.")));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = appendBounded(stderrTail, chunk);
    });

    child.once("error", (error) => {
      settle(() => reject(new CoCatError("PROVIDER_FAILED", ffmpegStartErrorMessage(error), error)));
    });

    child.once("exit", (code) => {
      if (code === 0) {
        settle(resolve);
        return;
      }

      settle(() => reject(new CoCatError("PROVIDER_FAILED", formatFfmpegExitError(code, stderrTail))));
    });
  });
}

async function assertFfmpegAvailable() {
  if (await checkFfmpegAvailable()) {
    return;
  }

  throw new CoCatError("PROVIDER_FAILED", FFMPEG_MISSING_MESSAGE);
}

function ffmpegStartErrorMessage(error: Error) {
  const errorCode = (error as NodeJS.ErrnoException).code;

  if (errorCode === "ENOENT") {
    return FFMPEG_MISSING_MESSAGE;
  }

  return `ffmpeg could not start${error.message ? `: ${error.message}` : "."}`;
}

export function buildFfmpegArgs(media: ResolvedMedia, outputPath: string) {
  const headers = headersToFfmpeg(media.headers);
  const args = ["-hide_banner", "-loglevel", "info", "-y"];

  if (headers) {
    args.push("-headers", headers);
  }

  pushInputArgs(args, media.transport, media.url);

  if (media.audioUrl) {
    pushInputArgs(args, "direct", media.audioUrl);
    args.push("-map", "0:v:0", "-map", "1:a:0");
  } else if (shouldMapPrimaryStreams(media)) {
    args.push("-map", "0:v:0?", "-map", "0:a:0?");
  }

  if (media.settings.embedMetadata) {
    args.push("-metadata", `title=${media.fileName.replace(/\.[^.]+$/, "")}`);
  }

  if (media.mode === "audio" && media.settings.audioFormat !== "original") {
    args.push("-vn", "-c:a", audioCodecFor(media.extension), "-b:a", `${media.settings.audioBitrateKbps}k`);
  } else if (media.settings.processingPolicy === "transcode") {
    args.push("-c:v", videoCodecFor(media.settings.codecPreference), "-c:a", "aac");
  } else {
    args.push("-c", "copy");
  }

  args.push(outputPath);
  return args;
}

export function formatFfmpegExitError(code: number | null, stderr: string, diagnostics: string[] = []) {
  const detail = stderrSummary([stderr, ...diagnostics].join("\n"));
  return `ffmpeg exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : "."}`;
}

function pushInputArgs(args: string[], transport: ResolvedMedia["transport"], inputUrl: string) {
  if (transport === "hls" || transport === "dash") {
    args.push("-protocol_whitelist", FFMPEG_PROTOCOL_WHITELIST);
  }

  if (transport === "hls") {
    args.push("-allowed_extensions", "ALL");
  }

  args.push("-i", inputUrl);
}

function shouldMapPrimaryStreams(media: ResolvedMedia) {
  return media.mode === "video" && (media.transport === "hls" || media.transport === "dash");
}

export function buildFfmpegRemuxArgs({
  audioPath,
  inputPath,
  outputPath
}: {
  audioPath?: string;
  inputPath: string;
  outputPath: string;
}) {
  const args = ["-hide_banner", "-loglevel", "info", "-y", "-i", inputPath];

  if (audioPath) {
    args.push("-i", audioPath, "-map", "0:v:0?", "-map", "1:a:0?", "-c", "copy", "-shortest");
  } else {
    args.push("-map", "0:v?", "-map", "0:a?", "-map", "0:s?", "-c", "copy");
  }

  args.push(outputPath);
  return args;
}

function audioCodecFor(extension: string) {
  const codecs: Record<string, string> = {
    mp3: "libmp3lame",
    m4a: "aac",
    opus: "libopus"
  };

  return codecs[extension] ?? "copy";
}

function videoCodecFor(codecPreference: ResolvedMedia["settings"]["codecPreference"]) {
  const codecs: Record<string, string> = {
    auto: "libx264",
    h264: "libx264",
    vp9: "libvpx-vp9",
    av1: "libaom-av1",
    aac: "libx264",
    opus: "libx264",
    copy: "copy"
  };

  return codecs[codecPreference];
}

function headersToFfmpeg(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) {
    return undefined;
  }

  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");
}

function parseFfmpegTime(chunk: string) {
  const match = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);

  if (!match) {
    return undefined;
  }

  const [, hours, minutes, seconds] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function appendBounded(current: string, chunk: string) {
  const next = `${current}${chunk}`;
  return next.length > FFMPEG_STDERR_TAIL_LENGTH ? next.slice(-FFMPEG_STDERR_TAIL_LENGTH) : next;
}

function stderrSummary(stderr: string) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("configuration:") && !line.startsWith("libav"));
  const summary = lines.slice(-6).join(" ");

  return summary.length > 1200 ? `${summary.slice(0, 1197)}...` : summary;
}
