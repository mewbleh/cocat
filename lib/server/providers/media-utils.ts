import path from "node:path";

import type { MediaMode } from "@/lib/contracts";
import { safeFileName } from "@/lib/utils";

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/vnd.apple.mpegurl": "m3u8",
  "application/x-mpegurl": "m3u8",
  "application/dash+xml": "mpd"
};

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "webm"]);
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"]);

export function extensionFromMime(mimeType?: string | null) {
  if (!mimeType) {
    return undefined;
  }

  const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase();
  return normalizedMime ? EXTENSION_BY_MIME[normalizedMime] : undefined;
}

export function extensionFromUrl(input: string) {
  try {
    const url = new URL(input);
    const extension = path.extname(url.pathname).replace(".", "").toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
}

export function inferMode(mimeType?: string | null, extension?: string | null): MediaMode | undefined {
  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  const normalizedExtension = extension?.toLowerCase();

  if (normalizedMime?.startsWith("video/") || (normalizedExtension && VIDEO_EXTENSIONS.has(normalizedExtension))) {
    return "video";
  }

  if (normalizedMime?.startsWith("audio/") || (normalizedExtension && AUDIO_EXTENSIONS.has(normalizedExtension))) {
    return "audio";
  }

  if (normalizedMime === "image/gif" || normalizedExtension === "gif") {
    return "gif";
  }

  if (normalizedMime?.startsWith("image/") || (normalizedExtension && PHOTO_EXTENSIONS.has(normalizedExtension))) {
    return "photo";
  }

  if (normalizedExtension === "m3u8" || normalizedMime === "application/vnd.apple.mpegurl" || normalizedMime === "application/x-mpegurl") {
    return "video";
  }

  if (normalizedExtension === "mpd" || normalizedMime === "application/dash+xml") {
    return "video";
  }

  return undefined;
}

export function mediaTransportFrom(extension?: string | null, mimeType?: string | null) {
  const normalizedExtension = extension?.toLowerCase();
  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();

  if (normalizedExtension === "m3u8" || normalizedMime === "application/vnd.apple.mpegurl" || normalizedMime === "application/x-mpegurl") {
    return "hls" as const;
  }

  if (normalizedExtension === "mpd" || normalizedMime === "application/dash+xml") {
    return "dash" as const;
  }

  return "direct" as const;
}

export function containerFromMime(mimeType?: string | null) {
  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();

  if (!normalizedMime) {
    return undefined;
  }

  if (normalizedMime.includes("mp4")) {
    return "mp4" as const;
  }

  if (normalizedMime.includes("webm")) {
    return "webm" as const;
  }

  if (normalizedMime.includes("mpegurl")) {
    return "auto" as const;
  }

  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) {
    return "mp3" as const;
  }

  return undefined;
}

export function codecsFromMime(mimeType?: string | null) {
  return mimeType?.match(/codecs="([^"]+)"/)?.[1];
}

export function qualityFromDimensions(width?: number, height?: number) {
  if (!height) {
    return undefined;
  }

  const suffix = width && width >= 3840 ? " 4K" : "";
  return `${height}p${suffix}`;
}

export function buildFileName(title: string, extension: string) {
  const cleanExtension = extension.replace(/^\./, "");
  const cleanTitle = stripMatchingExtension(safeFileName(title), cleanExtension);
  return `${cleanTitle}.${cleanExtension}`;
}

export function isMediaLike(mimeType?: string | null, extension?: string | null) {
  return Boolean(inferMode(mimeType, extension));
}

function stripMatchingExtension(fileName: string, extension: string) {
  return fileName.replace(new RegExp(`\\.${escapeRegExp(extension)}$`, "i"), "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
