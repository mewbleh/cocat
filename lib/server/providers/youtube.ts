import { DEFAULT_PROCESSING_SETTINGS, type ProcessingSettings } from "@/lib/contracts";
import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";
import { fetchText, readResponseText, safeFetch } from "@/lib/server/http";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { absoluteUrl } from "@/lib/server/providers/extract-utils";
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
const YTDOWN_BASE_URL = "https://app.ytdown.to";
const YTDOWN_PROXY_URL = `${YTDOWN_BASE_URL}/proxy.php`;
const YTDOWN_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 0 : 2000;
const YTDOWN_MAX_STATUS_ATTEMPTS = 40;
const DESKTOP_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

type YtdownExtractResponse = {
  api: {
    author?: string;
    duration?: number | string;
    fileName?: string;
    mediaItems?: YtdownMediaItem[];
    thumbnail?: string;
    thumbnailUrl?: string;
    title?: string;
  };
};

type YtdownDownloadResponse = {
  api: {
    fileName?: string;
    fileUrl?: string;
    message?: string;
    status?: string;
  };
};

type YtdownMediaItem = {
  mediaExtension?: string;
  mediaFileSize?: string;
  mediaQuality?: string;
  mediaRes?: string;
  mediaUrl?: string;
  type?: string;
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

    if (getServerConfig().enableYtdown) {
      try {
        return await extractYoutubeYtdown(url, videoId);
      } catch (error) {
        if (error instanceof CoCatError) {
          throw error;
        }

        throw new CoCatError("PROVIDER_FAILED", "YTDown could not resolve this YouTube URL.", error);
      }
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

    if (isYtdownOption(option)) {
      return resolveYtdownOption(source, option, _context, settings);
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

async function extractYoutubeYtdown(url: URL, videoId: string): Promise<ProviderExtractResult> {
  const payload = await ytdownRequest<YtdownExtractResponse>(url.href);
  const api = payload.api;
  const options = (api.mediaItems ?? [])
    .map((item, index) => ytdownOption(item, index))
    .filter((option): option is ProviderDownloadOption => Boolean(option));

  if (options.length === 0) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "YTDown did not return downloadable YouTube formats.");
  }

  const source = {
    providerId: "youtube" as const,
    sourceUrl: url.href,
    title: api.title ?? api.fileName ?? "YouTube video",
    author: api.author,
    thumbnailUrl: api.thumbnail ?? api.thumbnailUrl,
    durationSeconds: secondsFromYtdownDuration(api.duration),
    options,
    capabilities: {
      directDownload: true,
      hls: false,
      dash: false,
      adaptive: false,
      audioOnly: options.some((option) => option.mode === "audio"),
      subtitles: false,
      thumbnails: Boolean(api.thumbnail ?? api.thumbnailUrl),
      requiresFfmpeg: false,
      notes: ["YouTube formats are resolved through the optional YTDown scraper."]
    },
    settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
    debug: {
      videoId,
      strategy: "ytdown",
      ytdownEnabled: true,
      ytdownItemCount: options.length
    }
  } satisfies ProviderExtractResult;

  return {
    ...source,
    recommendedOptionId: rankRecommendedOption(source.options)
  };
}

function ytdownOption(item: YtdownMediaItem, index: number): ProviderDownloadOption | undefined {
  const mediaUrl = absoluteUrl(stringValue(item.mediaUrl), YTDOWN_BASE_URL);
  const type = stringValue(item.type)?.toLowerCase();
  const mode = type === "audio" ? "audio" : type === "video" ? "video" : undefined;

  if (!mediaUrl || !mode) {
    return undefined;
  }

  const extension = extensionFromYtdownItem(item, mode);
  const quality = ytdownQuality(item);
  const mimeType = ytdownMimeType(extension, mode);

  return {
    id: `youtube:ytdown:${mode}:${index}`,
    label: ["YTDown", quality, mode, extension.toUpperCase()].filter(Boolean).join(" "),
    mode,
    extension,
    container: extension === "mp4" ? "mp4" : extension === "webm" ? "webm" : extension === "mp3" ? "mp3" : undefined,
    quality,
    mimeType,
    sizeBytes: bytesFromYtdownSize(item.mediaFileSize),
    hasAudio: true,
    hasVideo: mode === "video",
    isAdaptive: false,
    requiresFfmpeg: false,
    transport: "direct",
    media: {
      transport: "direct",
      url: mediaUrl,
      headers: ytdownProxyHeaders(),
      mimeType
    }
  };
}

async function resolveYtdownOption(
  source: ProviderExtractResult,
  option: ProviderDownloadOption,
  context: unknown,
  settings: ProcessingSettings
): Promise<ResolvedMedia> {
  const completed = await waitForYtdownDownload(option.media.url, providerSignal(context));
  const extension = outputExtensionFor(option, settings);

  return {
    transport: "direct",
    url: completed.fileUrl,
    headers: ytdownDownloadHeaders(),
    fileName: buildFileName(safeFileName(completed.fileName ?? source.title), extension),
    extension,
    mode: option.mode,
    mimeType: mimeTypeForOutput(option, settings),
    sizeBytes: option.sizeBytes,
    durationSeconds: source.durationSeconds,
    requiresFfmpeg: false,
    settings
  };
}

async function waitForYtdownDownload(mediaUrl: string, signal?: AbortSignal) {
  for (let attempt = 0; attempt < YTDOWN_MAX_STATUS_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    const payload = await ytdownRequest<YtdownDownloadResponse>(mediaUrl, signal);
    const status = stringValue(payload.api.status)?.toLowerCase();
    const fileUrl = absoluteUrl(stringValue(payload.api.fileUrl), YTDOWN_BASE_URL);

    if (status === "completed" && fileUrl) {
      return {
        fileName: stringValue(payload.api.fileName),
        fileUrl
      };
    }

    if (["failed", "error", "expired", "cancelled"].includes(status ?? "")) {
      throw new CoCatError("PROVIDER_FAILED", ytdownErrorMessage(payload.api.message));
    }

    await delay(YTDOWN_POLL_INTERVAL_MS, signal);
  }

  throw new CoCatError("UPSTREAM_TIMEOUT", "YTDown did not finish preparing the YouTube download in time.");
}

async function ytdownRequest<T>(url: string, signal?: AbortSignal) {
  const response = await safeFetch(YTDOWN_PROXY_URL, {
    method: "POST",
    headers: ytdownProxyHeaders(),
    body: new URLSearchParams({ url }),
    signal
  });
  const text = await readResponseText(response);

  if (isYtdownCloudflareChallenge(response, text)) {
    throw new CoCatError(
      "AUTH_REQUIRED",
      "YTDown is protected by Cloudflare. Open app.ytdown.to in a browser, solve the challenge, and set COCAT_YTDOWN_COOKIE on the CoCat server."
    );
  }

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `YTDown returned HTTP ${response.status}.`);
  }

  try {
    const parsed = JSON.parse(text) as T & { api?: unknown };

    if (!parsed.api) {
      throw new CoCatError("PROVIDER_FAILED", "YTDown returned an invalid response.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof CoCatError) {
      throw error;
    }

    throw new CoCatError("PROVIDER_FAILED", "YTDown returned invalid JSON.", error);
  }
}

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

function isYtdownOption(option: ProviderDownloadOption) {
  return option.id.startsWith("youtube:ytdown:");
}

function ytdownProxyHeaders() {
  const cookie = getServerConfig().ytdownCookie;

  return {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/x-www-form-urlencoded",
    origin: YTDOWN_BASE_URL,
    referer: `${YTDOWN_BASE_URL}/en35/`,
    "user-agent": DESKTOP_BROWSER_USER_AGENT,
    ...(cookie ? { cookie } : {})
  };
}

function ytdownDownloadHeaders() {
  return {
    accept: "*/*",
    referer: YTDOWN_BASE_URL,
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };
}

function isYtdownCloudflareChallenge(response: Response, text: string) {
  return (response.status === 403 || response.status === 503) &&
    text.includes("Just a moment") &&
    text.includes("challenge-platform");
}

function ytdownQuality(item: YtdownMediaItem) {
  const mediaRes = stringValue(item.mediaRes);
  const mediaQuality = stringValue(item.mediaQuality);
  const quality = mediaRes?.includes("x") ? `${mediaRes.split("x").at(-1)}p` : mediaRes ?? mediaQuality;

  return quality?.replace(/\s+/g, " ").trim();
}

function extensionFromYtdownItem(item: YtdownMediaItem, mode: "audio" | "video") {
  const extension = stringValue(item.mediaExtension)?.replace(/^\./, "").toLowerCase();

  if (extension) {
    return extension;
  }

  return mode === "audio" ? "mp3" : "mp4";
}

function ytdownMimeType(extension: string, mode: "audio" | "video") {
  const byExtension: Record<string, string> = {
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: mode === "audio" ? "audio/webm" : "video/webm"
  };

  return byExtension[extension] ?? (mode === "audio" ? "audio/mpeg" : "video/mp4");
}

function bytesFromYtdownSize(value?: string) {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)$/i);

  if (!match) {
    return undefined;
  }

  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4
  };
  const size = Number.parseFloat(match[1]);
  const multiplier = units[match[2].toUpperCase()];

  return Number.isFinite(size) && multiplier ? Math.round(size * multiplier) : undefined;
}

function secondsFromYtdownDuration(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const duration = stringValue(value);

  if (!duration) {
    return undefined;
  }

  const parts = duration.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function ytdownErrorMessage(error?: unknown) {
  const message = stringValue(error);
  return message ? `YTDown reported an upstream error: ${message}` : "YTDown could not prepare that YouTube download.";
}

function providerSignal(context: unknown) {
  return typeof context === "object" && context != null && "signal" in context
    ? (context as { signal?: AbortSignal }).signal
    : undefined;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new CoCatError("CANCELLED", "The download was cancelled.");
  }
}

function delay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new CoCatError("CANCELLED", "The download was cancelled."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
