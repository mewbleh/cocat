import { CoCatError } from "@/lib/server/errors";
import { fetchHeadOrRange } from "@/lib/server/http";
import {
  codecsFromMime,
  containerFromMime,
  extensionFromMime,
  extensionFromUrl,
  inferMode,
  mediaTransportFrom,
  qualityFromDimensions
} from "@/lib/server/providers/media-utils";
import { optionsFromManifestUrl } from "@/lib/server/providers/manifests";
import {
  capabilitiesFromOptions,
  DEFAULT_SETTING_CONSTRAINTS,
  rankRecommendedOption,
  resolveOption
} from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";

const X_VIDEO_HOSTS = ["video.twimg.com"];
const X_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const directProvider: Provider = {
  id: "direct",
  canHandle() {
    return true;
  },
  async extract(url) {
    const response = await fetchHeadOrRange(url.href);
    const mimeType = response.headers.get("content-type") ?? undefined;
    const sizeBytes = sizeFromHeaders(response.headers);
    const extension = extensionFromUrl(url.href) ?? extensionFromMime(mimeType);
    const mode = inferMode(mimeType, extension);
    const transport = mediaTransportFrom(extension, mimeType);

    if (!mode || !extension) {
      throw new CoCatError("UNSUPPORTED_PLATFORM", "CoCat does not have a provider for that URL yet.");
    }

    const title = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname);

    const manifestOptions = transport !== "direct"
      ? await optionsFromManifestUrl({
          manifestUrl: url.href,
          providerId: "direct",
          titlePrefix: "Direct"
        })
      : [];
    const option: ProviderDownloadOption = withDirectMediaHeaders({
      id: `direct:${transport}:${extension}`,
      label: transport === "direct" ? "Original file" : `${transport.toUpperCase()} stream`,
      mode,
      extension: transport === "direct" ? extension : "mp4",
      container: containerFromMime(mimeType),
      quality: qualityFromDimensions(undefined, undefined),
      mimeType,
      codecs: codecsFromMime(mimeType),
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
      hasAudio: mode === "audio" || mode === "video",
      hasVideo: mode === "video" || mode === "gif",
      isAdaptive: transport !== "direct",
      requiresFfmpeg: transport !== "direct",
      transport,
      media: {
        transport,
        url: url.href,
        mimeType,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined
      }
    }, url.href);
    const options: ProviderDownloadOption[] = (manifestOptions.length > 0 ? manifestOptions : [option])
      .map((candidate) => withDirectMediaHeaders(candidate, url.href));
    const source: ProviderExtractResult = {
      providerId: "direct",
      sourceUrl: url.href,
      title,
      options,
      recommendedOptionId: option.id,
      capabilities: capabilitiesFromOptions({ options }),
      settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
      debug: {
        contentType: mimeType ?? null,
        transport
      }
    };

    return {
      ...source,
      recommendedOptionId: rankRecommendedOption(source.options)
    };
  },
  resolve: resolveOption
};

export function sizeFromHeaders(headers: Headers) {
  const contentRange = headers.get("content-range");
  const rangeSize = contentRange?.match(/\/(\d+)$/)?.[1];
  const contentLength = headers.get("content-length");
  const sizeBytes = Number.parseInt(rangeSize ?? contentLength ?? "", 10);

  return Number.isFinite(sizeBytes) ? sizeBytes : undefined;
}

function withDirectMediaHeaders(option: ProviderDownloadOption, sourceUrl: string): ProviderDownloadOption {
  const headers = siteMediaHeaders(option.media.url, sourceUrl, option.media.transport);

  if (!headers) {
    return option;
  }

  return {
    ...option,
    media: {
      ...option.media,
      headers: {
        ...headers.primary,
        ...option.media.headers
      },
      fallbackHeaders: [
        ...headers.fallback,
        ...(option.media.fallbackHeaders ?? [])
      ]
    }
  };
}

function siteMediaHeaders(mediaUrl: string, sourceUrl: string, transport: ProviderDownloadOption["media"]["transport"]) {
  if (isXVideoUrl(mediaUrl) || isXVideoUrl(sourceUrl)) {
    return {
      primary: xVideoHeaders(sourceUrl, transport),
      fallback: [
        xVideoHeaders("https://x.com/", transport, "*/*"),
        xVideoHeaders("https://twitter.com/", transport, "*/*"),
        xVideoHeaders(sourceUrl, transport, "*/*")
      ]
    };
  }

  return undefined;
}

function isXVideoUrl(input: string) {
  try {
    const hostname = new URL(input).hostname.toLowerCase();
    return X_VIDEO_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function xVideoHeaders(referer: string, transport: ProviderDownloadOption["media"]["transport"], accept = acceptHeaderForTransport(transport)) {
  return {
    accept,
    "accept-language": "en-US,en;q=0.9",
    origin: "https://x.com",
    referer: isXVideoUrl(referer) ? "https://x.com/" : referer,
    "sec-fetch-dest": transport === "hls" || transport === "dash" ? "empty" : "video",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "user-agent": X_BROWSER_USER_AGENT
  };
}

function acceptHeaderForTransport(transport: ProviderDownloadOption["media"]["transport"]) {
  if (transport === "hls") {
    return "application/vnd.apple.mpegurl,application/x-mpegurl,*/*;q=0.8";
  }

  if (transport === "dash") {
    return "application/dash+xml,*/*;q=0.8";
  }

  return "video/mp4,video/*;q=0.9,*/*;q=0.8";
}
