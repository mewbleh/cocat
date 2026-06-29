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
    const option: ProviderDownloadOption = {
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
    };
    const options: ProviderDownloadOption[] = manifestOptions.length > 0 ? manifestOptions : [option];
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
