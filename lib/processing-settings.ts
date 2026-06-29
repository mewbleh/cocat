import { z } from "zod";

import { DEFAULT_PROCESSING_SETTINGS, type ProcessingSettings } from "@/lib/contracts";

export const QUALITY_CAPS = ["best", "2160p", "1440p", "1080p", "720p", "480p", "360p"] as const;
export const OUTPUT_CONTAINERS = ["auto", "mp4", "webm", "mkv", "mp3", "m4a", "opus"] as const;
export const CODEC_PREFERENCES = ["auto", "h264", "vp9", "av1", "aac", "opus", "copy"] as const;
export const AUDIO_FORMATS = ["mp3", "m4a", "opus", "original"] as const;
export const PROCESSING_POLICIES = ["auto", "remux", "transcode", "copy"] as const;
export const PROCESSING_POLICY_LABELS: Record<ProcessingSettings["processingPolicy"], string> = {
  auto: "Auto",
  remux: "Remux",
  transcode: "Transcode",
  copy: "Copy"
};
export const STREAM_HANDLING = ["auto", "direct", "ffmpeg"] as const;
export const PROXY_MODES = ["auto", "always", "direct"] as const;

const FILENAME_TEMPLATE_MAX_LENGTH = 120;

export const processingSettingsSchema = z.object({
  qualityCap: z.enum(QUALITY_CAPS).default(DEFAULT_PROCESSING_SETTINGS.qualityCap),
  outputContainer: z.enum(OUTPUT_CONTAINERS).default(DEFAULT_PROCESSING_SETTINGS.outputContainer),
  codecPreference: z.enum(CODEC_PREFERENCES).default(DEFAULT_PROCESSING_SETTINGS.codecPreference),
  audioFormat: z.enum(AUDIO_FORMATS).default(DEFAULT_PROCESSING_SETTINGS.audioFormat),
  audioBitrateKbps: z.union([z.literal(96), z.literal(128), z.literal(192), z.literal(256), z.literal(320)]).default(192),
  mergeAudioVideo: z.boolean().default(DEFAULT_PROCESSING_SETTINGS.mergeAudioVideo),
  processingPolicy: z.enum(PROCESSING_POLICIES).default(DEFAULT_PROCESSING_SETTINGS.processingPolicy),
  streamHandling: z.enum(STREAM_HANDLING).default(DEFAULT_PROCESSING_SETTINGS.streamHandling),
  proxyMode: z.enum(PROXY_MODES).default(DEFAULT_PROCESSING_SETTINGS.proxyMode),
  embedMetadata: z.boolean().default(DEFAULT_PROCESSING_SETTINGS.embedMetadata),
  includeThumbnail: z.boolean().default(DEFAULT_PROCESSING_SETTINGS.includeThumbnail),
  includeSubtitles: z.boolean().default(DEFAULT_PROCESSING_SETTINGS.includeSubtitles),
  filenameTemplate: z
    .string()
    .trim()
    .min(1)
    .max(FILENAME_TEMPLATE_MAX_LENGTH)
    .default(DEFAULT_PROCESSING_SETTINGS.filenameTemplate),
  showProviderDebug: z.boolean().default(DEFAULT_PROCESSING_SETTINGS.showProviderDebug)
});

export function normalizeProcessingSettings(input: unknown): ProcessingSettings {
  const parsedInput = typeof input === "object" && input != null ? input : {};
  return processingSettingsSchema.parse(parsedInput);
}

export function serializeProcessingSettings(settings: ProcessingSettings) {
  return JSON.stringify(processingSettingsSchema.parse(settings));
}

export function parseStoredProcessingSettings(rawValue: string | null) {
  if (!rawValue) {
    return DEFAULT_PROCESSING_SETTINGS;
  }

  try {
    return normalizeProcessingSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_PROCESSING_SETTINGS;
  }
}

export function qualityCapToHeight(qualityCap: ProcessingSettings["qualityCap"]) {
  if (qualityCap === "best") {
    return Number.POSITIVE_INFINITY;
  }

  return Number.parseInt(qualityCap.replace("p", ""), 10);
}
