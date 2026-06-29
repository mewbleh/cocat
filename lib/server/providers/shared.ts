import { CoCatError } from "@/lib/server/errors";
import { buildFileName } from "@/lib/server/providers/media-utils";
import type { Provider, ProviderExtractResult, ResolvedMedia } from "@/lib/server/providers/types";
import { DEFAULT_PROCESSING_SETTINGS, type DownloadOption, type ProcessingSettings, type ProviderCapabilities, type SettingConstraints } from "@/lib/contracts";
import { QUALITY_CAPS, OUTPUT_CONTAINERS, AUDIO_FORMATS, CODEC_PREFERENCES } from "@/lib/processing-settings";

export function hostMatches(hostname: string, allowedHosts: string[]) {
  const normalizedHostname = hostname.toLowerCase().replace(/^www\./, "");

  return allowedHosts.some((host) => normalizedHostname === host || normalizedHostname.endsWith(`.${host}`));
}

export async function resolveOption(
  source: ProviderExtractResult,
  optionId: string,
  _context?: unknown,
  settings = DEFAULT_PROCESSING_SETTINGS
): Promise<ResolvedMedia> {
  void _context;

  const option = source.options.find((candidate) => candidate.id === optionId);

  if (!option) {
    throw new CoCatError("BAD_REQUEST", "That download option is not available for this source.");
  }
  const extension = outputExtensionFor(option, settings);

  return {
    transport: option.media.transport,
    url: option.media.url,
    audioUrl: option.media.audioUrl,
    subtitleUrl: option.media.subtitleUrl,
    thumbnailUrl: option.media.thumbnailUrl,
    headers: option.media.headers,
    fallbackHeaders: option.media.fallbackHeaders,
    fileName: buildFileNameFromSettings(source.title, extension, settings.filenameTemplate),
    extension,
    mode: option.mode,
    mimeType: mimeTypeForOutput(option, settings),
    audioMimeType: option.media.audioMimeType,
    sizeBytes: option.sizeBytes ?? option.media.sizeBytes,
    durationSeconds: source.durationSeconds,
    requiresFfmpeg: optionNeedsFfmpeg(option, settings),
    settings
  };
}

export function optionNeedsFfmpeg(option: Pick<DownloadOption, "mode" | "requiresFfmpeg">, settings: ProcessingSettings) {
  return Boolean(
    option.requiresFfmpeg ||
      settings.streamHandling === "ffmpeg" ||
      needsRequestedAudioFormat(option, settings) ||
      needsRequestedProcessingPolicy(settings)
  );
}

export function createUnsupportedResolveProvider(provider: Omit<Provider, "resolve">): Provider {
  return {
    ...provider,
    resolve: resolveOption
  };
}

export const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  directDownload: false,
  hls: false,
  dash: false,
  adaptive: false,
  audioOnly: false,
  subtitles: false,
  thumbnails: false,
  requiresFfmpeg: false,
  notes: []
};

export const DEFAULT_SETTING_CONSTRAINTS: SettingConstraints = {
  qualityCaps: [...QUALITY_CAPS],
  outputContainers: [...OUTPUT_CONTAINERS],
  audioFormats: [...AUDIO_FORMATS],
  codecPreferences: [...CODEC_PREFERENCES]
};

export function capabilitiesFromOptions(source: Pick<ProviderExtractResult, "thumbnailUrl" | "options">): ProviderCapabilities {
  return {
    directDownload: source.options.some((option) => option.media.transport === "direct"),
    hls: source.options.some((option) => option.media.transport === "hls"),
    dash: source.options.some((option) => option.media.transport === "dash"),
    adaptive: source.options.some((option) => option.isAdaptive),
    audioOnly: source.options.some((option) => option.mode === "audio"),
    subtitles: source.options.some((option) => Boolean(option.media.subtitleUrl)),
    thumbnails: Boolean(source.thumbnailUrl),
    requiresFfmpeg: source.options.some((option) => option.requiresFfmpeg),
    notes: []
  };
}

export function rankRecommendedOption(options: ProviderExtractResult["options"]) {
  const progressiveVideo = options.find((option) => option.mode === "video" && option.hasAudio && option.hasVideo);
  const adaptiveVideo = options.find((option) => option.mode === "video");
  return progressiveVideo?.id ?? adaptiveVideo?.id ?? options[0]?.id;
}

function buildFileNameFromSettings(title: string, extension: string, template: string) {
  const renderedTitle = template.replaceAll("{title}", title).replaceAll("{ext}", extension).trim() || title;
  return buildFileName(renderedTitle, extension);
}

function outputExtensionFor(option: ProviderExtractResult["options"][number], settings: typeof DEFAULT_PROCESSING_SETTINGS) {
  if (option.mode === "audio" && settings.audioFormat !== "original") {
    return settings.audioFormat;
  }

  if (settings.outputContainer !== "auto" && option.mode === "video") {
    return settings.outputContainer;
  }

  return option.extension;
}

function needsRequestedAudioFormat(option: Pick<DownloadOption, "mode">, settings: ProcessingSettings) {
  return option.mode === "audio" && settings.audioFormat !== "original";
}

function needsRequestedProcessingPolicy(settings: ProcessingSettings) {
  return settings.processingPolicy !== "copy" && settings.processingPolicy !== "auto";
}

function mimeTypeForOutput(option: ProviderExtractResult["options"][number], settings: typeof DEFAULT_PROCESSING_SETTINGS) {
  const extension = outputExtensionFor(option, settings);
  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/opus",
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska"
  };

  return mimeTypes[extension] ?? option.mimeType ?? option.media.mimeType;
}
