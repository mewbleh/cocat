import { DEFAULT_PROCESSING_SETTINGS, type ProcessingSettings } from "@/lib/contracts";
import { CoCatError } from "@/lib/server/errors";
import { fetchText } from "@/lib/server/http";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import {
  codecsFromMime,
  containerFromMime,
  extensionFromMime,
  extensionFromUrl,
  qualityFromDimensions
} from "@/lib/server/providers/media-utils";
import { buildFileName } from "@/lib/server/providers/media-utils";
import { DEFAULT_SETTING_CONSTRAINTS, hostMatches, optionNeedsFfmpeg, rankRecommendedOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption, ProviderExtractResult, ResolvedMedia } from "@/lib/server/providers/types";
import { getYoutubeClient } from "@/lib/server/youtube-runtime";
import { safeFileName } from "@/lib/utils";

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
const YOUTUBE_PLACEHOLDER_PROTOCOL = "yt:";

type YoutubeFormat = {
  itag: number;
  url?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  content_length?: number;
  quality_label?: string;
  audio_quality?: string;
  signature_cipher?: string;
  cipher?: string;
  mime_type: string;
  has_audio: boolean;
  has_video: boolean;
};

export const youtubeProvider: Provider = {
  id: "youtube",
  canHandle(url) {
    return hostMatches(url.hostname, YOUTUBE_HOSTS);
  },
  async extract(url) {
    const videoId = getYoutubeVideoId(url);

    if (!videoId) {
      throw new CoCatError("INVALID_URL", "CoCat could not find a YouTube video id in that URL.");
    }

    try {
      const youtube = await getYoutubeClient();
      const info = await youtube.getBasicInfo(videoId, { client: "WEB" });
      const formats = [...(info.streaming_data?.formats ?? []), ...(info.streaming_data?.adaptive_formats ?? [])] as YoutubeFormat[];
      const thumbnailUrl = bestThumbnail(info.basic_info.thumbnail);
      const options = formats.map((format) => toYoutubeOption(format, videoId)).filter(isProviderDownloadOption);

      if (info.streaming_data?.hls_manifest_url) {
        options.push(toManifestOption(videoId, info.streaming_data.hls_manifest_url, "hls"));
      }

      if (info.streaming_data?.dash_manifest_url) {
        options.push(toManifestOption(videoId, info.streaming_data.dash_manifest_url, "dash"));
      }

      if (options.length === 0) {
        throw new CoCatError("UNSUPPORTED_MEDIA", "YouTube did not expose public streaming formats for this video.");
      }

      const source = {
        providerId: "youtube" as const,
        sourceUrl: url.href,
        title: info.basic_info.title ?? "YouTube video",
        author: info.basic_info.author,
        thumbnailUrl,
        durationSeconds: info.basic_info.duration,
        options,
        capabilities: {
          directDownload: options.some((option) => option.transport === "direct" && !option.requiresFfmpeg),
          hls: options.some((option) => option.transport === "hls"),
          dash: options.some((option) => option.transport === "dash"),
          adaptive: options.some((option) => option.isAdaptive),
          audioOnly: options.some((option) => option.mode === "audio"),
          subtitles: Boolean(info.captions),
          thumbnails: Boolean(thumbnailUrl),
          requiresFfmpeg: options.some((option) => option.requiresFfmpeg),
          notes: ["YouTube streams are resolved with Innertube and a sandboxed player evaluator."]
        },
        settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
        debug: {
          videoId,
          formatCount: formats.length,
          hasHlsManifest: Boolean(info.streaming_data?.hls_manifest_url),
          hasDashManifest: Boolean(info.streaming_data?.dash_manifest_url)
        }
      } satisfies ProviderExtractResult;

      return {
        ...source,
        recommendedOptionId: rankRecommendedOption(source.options)
      };
    } catch (error) {
      if (error instanceof CoCatError) {
        throw error;
      }

      return extractYoutubeFallback(url, videoId, error);
    }
  },
  async resolve(source, optionId, _context, settings = DEFAULT_PROCESSING_SETTINGS) {
    const option = source.options.find((candidate) => candidate.id === optionId);

    if (!option) {
      throw new CoCatError("BAD_REQUEST", "That YouTube format is not available for this source.");
    }

    const videoId = source.debug?.videoId?.toString() ?? getYoutubeVideoId(new URL(source.sourceUrl));

    if (!videoId) {
      throw new CoCatError("INVALID_URL", "CoCat could not resolve this YouTube video id.");
    }

    if (option.media.transport === "hls" || option.media.transport === "dash") {
      return resolvedFromOption(source, option, settings);
    }

    const itag = Number(option.id.split(":").at(-1));

    if (!Number.isFinite(itag)) {
      return resolvedFromOption(source, option, settings);
    }

    const youtube = await getYoutubeClient();
    let selectedUrl: string | undefined;
    let selectedFormat: YoutubeFormat | undefined;

    try {
      selectedFormat = await youtube.getStreamingData(videoId, {
        itag,
        client: "WEB"
      }) as YoutubeFormat;
      selectedUrl = selectedFormat.url;
    } catch (error) {
      throw new CoCatError(
        "UNSUPPORTED_MEDIA",
        "YouTube did not expose a downloadable URL for that selected format.",
        error
      );
    }

    if (!selectedUrl) {
      throw new CoCatError("PROVIDER_FAILED", "YouTube did not return a downloadable URL for that format.");
    }

    const audioUrl =
      selectedFormat.has_video && !selectedFormat.has_audio && settings.mergeAudioVideo
        ? await resolveBestYoutubeAudioUrl(youtube, source, settings)
        : undefined;
    const extension = outputExtensionFor(option, settings);

    return {
      transport: option.media.transport,
      url: selectedUrl,
      audioUrl,
      thumbnailUrl: source.thumbnailUrl,
      fileName: buildFileName(safeFileName(source.title), extension),
      extension,
      mode: option.mode,
      mimeType: mimeTypeForOutput(option, settings),
      audioMimeType: audioUrl ? "audio/mp4" : undefined,
      sizeBytes: option.sizeBytes,
      durationSeconds: source.durationSeconds,
      requiresFfmpeg: Boolean(audioUrl || optionNeedsFfmpeg(option, settings)),
      settings
    } satisfies ResolvedMedia;
  }
};

async function extractYoutubeFallback(url: URL, videoId: string, cause: unknown) {
  const html = await fetchText(url.href);
  const metadata = parseHtmlMetadata(html, url, "youtube");

  if (metadata.options.length === 0) {
    const status = extractYouTubePlayableStatus(html);

    if (status === "LOGIN_REQUIRED" || status === "AGE_CHECK_REQUIRED") {
      throw new CoCatError("AUTH_REQUIRED", "YouTube is not exposing this media publicly.", cause);
    }

    throw new CoCatError("UNSUPPORTED_MEDIA", "YouTube did not expose public streaming formats for this video.", cause);
  }

  const source = {
    providerId: "youtube" as const,
    sourceUrl: url.href,
    title: metadata.title,
    author: metadata.author,
    thumbnailUrl: metadata.thumbnailUrl,
    durationSeconds: metadata.durationSeconds,
    options: metadata.options,
    capabilities: {
      directDownload: metadata.options.some((option) => option.transport === "direct"),
      hls: metadata.options.some((option) => option.transport === "hls"),
      dash: metadata.options.some((option) => option.transport === "dash"),
      adaptive: metadata.options.some((option) => option.isAdaptive),
      audioOnly: metadata.options.some((option) => option.mode === "audio"),
      subtitles: false,
      thumbnails: Boolean(metadata.thumbnailUrl),
      requiresFfmpeg: metadata.options.some((option) => option.requiresFfmpeg),
      notes: ["Innertube extraction failed; using public page fallback."]
    },
    settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
    debug: {
      videoId,
      strategy: "html-fallback"
    }
  } satisfies ProviderExtractResult;

  return {
    ...source,
    recommendedOptionId: rankRecommendedOption(source.options)
  };
}

function toYoutubeOption(format: YoutubeFormat, videoId: string): ProviderDownloadOption | undefined {
  if (!isResolvableYoutubeFormat(format)) {
    return undefined;
  }

  const mimeType = format.mime_type;
  const extension = extensionFromMime(mimeType) ?? extensionFromUrl(format.url ?? "") ?? (format.has_audio ? "m4a" : "mp4");
  const quality = format.quality_label ?? qualityFromDimensions(format.width, format.height) ?? format.audio_quality;
  const isAdaptive = !(format.has_audio && format.has_video);
  const mode = format.has_video ? "video" : "audio";

  return {
    id: `youtube:${format.itag}`,
    label: youtubeOptionLabel(format, quality),
    mode,
    extension,
    container: containerFromMime(mimeType),
    quality,
    mimeType,
    codecs: codecsFromMime(mimeType),
    sizeBytes: format.content_length,
    width: format.width,
    height: format.height,
    fps: format.fps,
    bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
    isAdaptive,
    hasAudio: format.has_audio,
    hasVideo: format.has_video,
    requiresFfmpeg: isAdaptive,
    transport: "direct",
    media: {
      transport: "direct",
      url: format.url ?? `${YOUTUBE_PLACEHOLDER_PROTOCOL}//${videoId}/${format.itag}`,
      mimeType,
      sizeBytes: format.content_length
    }
  };
}

export function isResolvableYoutubeFormat(format: Pick<YoutubeFormat, "url" | "signature_cipher" | "cipher">) {
  return Boolean(format.url || format.signature_cipher || format.cipher);
}

function toManifestOption(videoId: string, manifestUrl: string, transport: "hls" | "dash"): ProviderDownloadOption {
  return {
    id: `youtube:${transport}`,
    label: `${transport.toUpperCase()} manifest`,
    mode: "video",
    extension: "mp4",
    container: "mp4",
    quality: "Auto",
    hasAudio: true,
    hasVideo: true,
    isAdaptive: true,
    requiresFfmpeg: true,
    transport,
    media: {
      transport,
      url: manifestUrl || `${YOUTUBE_PLACEHOLDER_PROTOCOL}//${videoId}/${transport}`,
      mimeType: transport === "hls" ? "application/vnd.apple.mpegurl" : "application/dash+xml"
    }
  };
}

async function resolveBestYoutubeAudioUrl(
  youtube: Awaited<ReturnType<typeof getYoutubeClient>>,
  source: ProviderExtractResult,
  settings: ProcessingSettings
) {
  const audioOptions = source.options
    .filter((option) => option.mode === "audio")
    .sort((left, right) => (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0));
  const audioOption = audioOptions.find((option) => settings.audioFormat === "original" || option.extension === "m4a") ?? audioOptions[0];
  const audioItag = Number(audioOption?.id.split(":").at(-1));

  if (!Number.isFinite(audioItag)) {
    return undefined;
  }

  const audioFormat = await youtube.getStreamingData(source.debug?.videoId?.toString() ?? "", {
    itag: audioItag,
    client: "WEB"
  });

  return audioFormat.url;
}

function resolvedFromOption(source: ProviderExtractResult, option: ProviderDownloadOption, settings: ProcessingSettings): ResolvedMedia {
  const extension = outputExtensionFor(option, settings);

  return {
    transport: option.media.transport,
    url: option.media.url,
    thumbnailUrl: source.thumbnailUrl,
    fileName: buildFileName(safeFileName(source.title), extension),
    extension,
    mode: option.mode,
    mimeType: mimeTypeForOutput(option, settings),
    sizeBytes: option.sizeBytes,
    durationSeconds: source.durationSeconds,
    requiresFfmpeg: true,
    settings
  };
}

function outputExtensionFor(option: ProviderDownloadOption, settings: ProcessingSettings) {
  if (option.mode === "audio" && settings.audioFormat !== "original") {
    return settings.audioFormat;
  }

  if (settings.outputContainer !== "auto" && !["mp3", "m4a", "opus"].includes(settings.outputContainer)) {
    return settings.outputContainer;
  }

  return option.extension;
}

function mimeTypeForOutput(option: ProviderDownloadOption, settings: ProcessingSettings) {
  if (option.mode === "audio" && settings.audioFormat === "mp3") {
    return "audio/mpeg";
  }

  if (settings.outputContainer === "mp4") {
    return "video/mp4";
  }

  if (settings.outputContainer === "webm") {
    return "video/webm";
  }

  return option.mimeType;
}

function youtubeOptionLabel(format: YoutubeFormat, quality?: string) {
  const mediaParts = [
    quality,
    format.has_video && format.has_audio ? "video+audio" : format.has_video ? "video" : "audio",
    extensionFromMime(format.mime_type)?.toUpperCase()
  ].filter(Boolean);

  return mediaParts.join(" ");
}

function getYoutubeVideoId(url: URL) {
  if (url.hostname.includes("youtu.be")) {
    return url.pathname.split("/").filter(Boolean)[0];
  }

  if (url.pathname.startsWith("/shorts/")) {
    return url.pathname.split("/").filter(Boolean)[1];
  }

  if (url.pathname.startsWith("/embed/")) {
    return url.pathname.split("/").filter(Boolean)[1];
  }

  return url.searchParams.get("v") ?? undefined;
}

function bestThumbnail(thumbnails?: Array<{ url: string; width?: number; height?: number }>) {
  return thumbnails?.slice().sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0]?.url;
}

function isProviderDownloadOption(option: ProviderDownloadOption | undefined): option is ProviderDownloadOption {
  return Boolean(option);
}

function extractYouTubePlayableStatus(html: string) {
  const match = html.match(/"playabilityStatus"\s*:\s*(\{.+?\})\s*,\s*"streamingData"/s);

  if (!match?.[1]) {
    return undefined;
  }

  try {
    const status = JSON.parse(match[1]) as { status?: string };
    return status.status;
  } catch {
    return undefined;
  }
}
