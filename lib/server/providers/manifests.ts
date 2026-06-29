import { parse as parseHls } from "hls-parser";
import { XMLParser } from "fast-xml-parser";

import { fetchText } from "@/lib/server/http";
import {
  codecsFromMime,
  extensionFromMime,
  extensionFromUrl,
  inferMode,
  qualityFromDimensions
} from "@/lib/server/providers/media-utils";
import type { ProviderDownloadOption, ProviderId } from "@/lib/server/providers/types";

export async function optionsFromManifestUrl({
  manifestUrl,
  providerId,
  titlePrefix = "Stream"
}: {
  manifestUrl: string;
  providerId: ProviderId;
  titlePrefix?: string;
}) {
  const extension = extensionFromUrl(manifestUrl);

  if (extension === "m3u8") {
    return optionsFromHlsManifest(await fetchText(manifestUrl), manifestUrl, providerId, titlePrefix);
  }

  if (extension === "mpd") {
    return optionsFromDashManifest(await fetchText(manifestUrl), manifestUrl, providerId, titlePrefix);
  }

  return [];
}

export function optionsFromHlsManifest(
  manifest: string,
  manifestUrl: string,
  providerId: ProviderId,
  titlePrefix = "HLS"
): ProviderDownloadOption[] {
  const playlist = parseHls(manifest);

  if (!("isMasterPlaylist" in playlist) || !playlist.isMasterPlaylist) {
    return [
      {
        id: `${providerId}:hls:media`,
        label: `${titlePrefix} stream`,
        mode: "video",
        extension: "mp4",
        transport: "hls",
        requiresFfmpeg: true,
        isAdaptive: true,
        hasAudio: true,
        hasVideo: true,
        media: {
          transport: "hls",
          url: manifestUrl,
          mimeType: "application/vnd.apple.mpegurl"
        }
      }
    ];
  }

  return playlist.variants.map((variant, index) => {
    const height = variant.resolution?.height;
    const width = variant.resolution?.width;
    const quality = qualityFromDimensions(width, height) ?? `${Math.round(variant.bandwidth / 1000)} kbps`;

    return {
      id: `${providerId}:hls:${index}`,
      label: `${quality} HLS`,
      mode: "video",
      extension: "mp4",
      container: "mp4",
      quality,
      codecs: variant.codecs,
      width,
      height,
      fps: variant.frameRate,
      bitrateKbps: Math.round(variant.bandwidth / 1000),
      isAdaptive: true,
      hasAudio: variant.audio.length > 0,
      hasVideo: true,
      requiresFfmpeg: true,
      transport: "hls",
      media: {
        transport: "hls",
        url: new URL(variant.uri, manifestUrl).href,
        mimeType: "application/vnd.apple.mpegurl"
      }
    } satisfies ProviderDownloadOption;
  });
}

export function optionsFromDashManifest(
  manifest: string,
  manifestUrl: string,
  providerId: ProviderId,
  titlePrefix = "DASH"
): ProviderDownloadOption[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: true
  });
  const document = parser.parse(manifest) as DashDocument;
  const periods = toArray(document.MPD?.Period);
  const options: ProviderDownloadOption[] = [];

  for (const period of periods) {
    for (const adaptationSet of toArray(period.AdaptationSet)) {
      for (const representation of toArray(adaptationSet.Representation)) {
        const baseUrl = firstString(representation.BaseURL) ?? firstString(adaptationSet.BaseURL);
        const mimeType = representation.mimeType ?? adaptationSet.mimeType;
        const extension = extensionFromMime(mimeType) ?? extensionFromUrl(baseUrl ?? "") ?? "mp4";
        const mode = inferMode(mimeType, extension);

        if (!baseUrl || !mode) {
          continue;
        }

        const width = numberOrUndefined(representation.width);
        const height = numberOrUndefined(representation.height);
        const quality = qualityFromDimensions(width, height) ?? representation.id?.toString();
        const url = new URL(baseUrl, manifestUrl).href;

        options.push({
          id: `${providerId}:dash:${options.length}`,
          label: `${quality ?? titlePrefix} DASH`,
          mode,
          extension: mode === "audio" ? extension : "mp4",
          container: mode === "audio" ? undefined : "mp4",
          quality,
          mimeType,
          codecs: representation.codecs ?? adaptationSet.codecs ?? codecsFromMime(mimeType),
          width,
          height,
          bitrateKbps: numberOrUndefined(representation.bandwidth)
            ? Math.round(Number(representation.bandwidth) / 1000)
            : undefined,
          isAdaptive: true,
          hasAudio: mode === "audio",
          hasVideo: mode === "video",
          requiresFfmpeg: true,
          transport: "dash",
          media: {
            transport: "dash",
            url,
            mimeType
          }
        });
      }
    }
  }

  return options;
}

type DashDocument = {
  MPD?: {
    Period?: DashPeriod | DashPeriod[];
  };
};

type DashPeriod = {
  AdaptationSet?: DashAdaptationSet | DashAdaptationSet[];
};

type DashAdaptationSet = {
  mimeType?: string;
  codecs?: string;
  BaseURL?: string | string[];
  Representation?: DashRepresentation | DashRepresentation[];
};

type DashRepresentation = {
  id?: string | number;
  mimeType?: string;
  codecs?: string;
  BaseURL?: string | string[];
  width?: number;
  height?: number;
  bandwidth?: number;
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function firstString(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function numberOrUndefined(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}
