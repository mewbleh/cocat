import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const DEFAULT_FILE_NAME = "cocat-download";
const UNSAFE_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const WHITESPACE_RUN = /\s+/g;

export function formatBytes(bytes?: number | null) {
  if (!Number.isFinite(bytes) || bytes == null || bytes < 0) {
    return "Unknown size";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), FILE_SIZE_UNITS.length - 1);
  const value = bytes / 1024 ** unitIndex;

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${FILE_SIZE_UNITS[unitIndex]}`;
}

export function formatDuration(seconds?: number | null) {
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) {
    return "Unknown duration";
  }

  const roundedSeconds = Math.round(seconds);
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function safeFileName(input?: string | null, fallback = DEFAULT_FILE_NAME) {
  const cleaned = (input ?? "")
    .replace(UNSAFE_FILE_NAME_CHARS, "")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .replace(/\.$/, "");

  return cleaned.length > 0 ? cleaned.slice(0, 160) : fallback;
}

export function getPlatformLabel(providerId?: string | null) {
  const labels: Record<string, string> = {
    direct: "Direct media",
    youtube: "YouTube",
    tiktok: "TikTok",
    instagram: "Instagram",
    x: "X / Twitter",
    reddit: "Reddit",
    spotify: "Spotify",
    soundcloud: "SoundCloud",
    vimeo: "Vimeo",
    pinterest: "Pinterest",
    facebook: "Facebook",
    threads: "Threads",
    bluesky: "Bluesky",
    tumblr: "Tumblr",
    dailymotion: "Dailymotion",
    streamable: "Streamable",
    imgur: "Imgur",
    twitch: "Twitch",
    kick: "Kick",
    rumble: "Rumble",
    flickr: "Flickr",
    mastodon: "Mastodon",
    pixelfed: "Pixelfed"
  };

  return providerId ? (labels[providerId] ?? providerId) : "Unknown";
}
