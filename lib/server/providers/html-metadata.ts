import * as cheerio from "cheerio";

import { CoCatError } from "@/lib/server/errors";
import { fetchText } from "@/lib/server/http";
import {
  codecsFromMime,
  containerFromMime,
  extensionFromMime,
  extensionFromUrl,
  inferMode,
  isMediaLike,
  mediaTransportFrom,
  qualityFromDimensions
} from "@/lib/server/providers/media-utils";
import type { ProviderDownloadOption, ProviderId } from "@/lib/server/providers/types";

export type HtmlMetadata = {
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  options: ProviderDownloadOption[];
};

export async function extractPublicHtmlMedia(url: URL, providerId: ProviderId) {
  const html = await fetchText(url.href);
  return parseHtmlMetadata(html, url, providerId);
}

export function parseHtmlMetadata(html: string, pageUrl: URL, providerId: ProviderId): HtmlMetadata {
  const $ = cheerio.load(html);
  const title =
    firstValue($, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ]) ??
    $("title").first().text().trim() ??
    pageUrl.hostname;
  const author =
    firstValue($, ['meta[name="author"]', 'meta[property="article:author"]', 'meta[name="twitter:creator"]']) ??
    undefined;
  const thumbnailUrl = toAbsoluteUrl(
    firstValue($, ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]']),
    pageUrl
  );
  // ref: https://ogp.me/ says video:duration is seconds; https://schema.org/VideoObject uses ISO-8601 duration.
  const durationSeconds =
    parseDuration(
      firstValue($, [
        'meta[property="video:duration"]',
        'meta[property="og:video:duration"]',
        'meta[property="og:duration"]',
        'meta[name="twitter:duration"]',
        'meta[name="duration"]',
        'meta[itemprop="duration"]'
      ])
    ) ??
    durationFromJsonLd(html) ??
    durationFromEmbeddedJson(html);
  const candidates = collectMediaCandidates($, pageUrl, html);
  const options = candidates.map((candidate, index) => {
    const extension = candidate.extension ?? extensionFromMime(candidate.mimeType) ?? "mp4";
    const mode = inferMode(candidate.mimeType, extension);
    const transport = mediaTransportFrom(extension, candidate.mimeType);

    if (!mode) {
      throw new CoCatError("UNSUPPORTED_MEDIA", "CoCat could not identify the media type.");
    }

    return {
      id: `${providerId}:${index}:${extension}`,
      label: candidate.label ?? defaultOptionLabel(mode, candidate.quality),
      mode,
      extension: transport === "hls" || transport === "dash" ? "mp4" : extension,
      container: containerFromMime(candidate.mimeType),
      codecs: codecsFromMime(candidate.mimeType),
      quality: candidate.quality,
      mimeType: candidate.mimeType,
      sizeBytes: candidate.sizeBytes,
      width: candidate.width,
      height: candidate.height,
      isAdaptive: transport === "hls" || transport === "dash",
      hasAudio: mode === "audio" || mode === "video",
      hasVideo: mode === "video" || mode === "gif",
      requiresFfmpeg: transport === "hls" || transport === "dash",
      transport,
      media: {
        transport,
        url: candidate.url,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes
      }
    } satisfies ProviderDownloadOption;
  });

  return {
    title: title || pageUrl.hostname,
    author,
    thumbnailUrl,
    durationSeconds,
    options: dedupeOptions(options)
  };
}

function firstValue($: cheerio.CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const element = $(selector).first();
    const value = element.attr("content") ?? element.attr("href") ?? element.text();

    if (value?.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function collectMediaCandidates($: cheerio.CheerioAPI, pageUrl: URL, html: string) {
  const candidates: Array<{
    url: string;
    label?: string;
    quality?: string;
    mimeType?: string;
    extension?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
  }> = [];

  const addCandidate = (rawUrl?: string, metadata: Omit<(typeof candidates)[number], "url"> = {}) => {
    const absoluteUrl = toAbsoluteUrl(rawUrl, pageUrl);

    if (!absoluteUrl) {
      return;
    }

    const extension = metadata.extension ?? extensionFromUrl(absoluteUrl) ?? extensionFromMime(metadata.mimeType);

    if (!isMediaLike(metadata.mimeType, extension)) {
      return;
    }

    candidates.push({
      ...metadata,
      url: absoluteUrl,
      extension,
      quality: metadata.quality ?? qualityFromDimensions(metadata.width, metadata.height)
    });
  };

  const metaSelectors = [
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]',
    'meta[property="og:audio"]',
    'meta[property="og:audio:url"]',
    'meta[property="og:image"]'
  ];

  for (const selector of metaSelectors) {
    $(selector).each((_, element) => {
      addCandidate($(element).attr("content"), {
        mimeType: $(element).attr("type") ?? metaContent($, "og:video:type") ?? metaContent($, "og:audio:type"),
        label: selector.includes("image") ? "Image" : "Public media"
      });
    });
  }

  $("video, audio").each((_, element) => {
    const mediaElement = $(element);
    const mediaType = element.tagName === "audio" ? "Audio" : "Video";
    addCandidate(mediaElement.attr("src"), {
      mimeType: mediaElement.attr("type"),
      width: numberAttribute(mediaElement.attr("width")),
      height: numberAttribute(mediaElement.attr("height")),
      label: mediaType
    });

    mediaElement.find("source").each((_, source) => {
      const sourceElement = $(source);
      addCandidate(sourceElement.attr("src"), {
        mimeType: sourceElement.attr("type"),
        label: mediaType
      });
    });
  });

  $("a[href]").each((_, element) => {
    addCandidate($(element).attr("href"), {
      label: "Linked media"
    });
  });

  $('script[type="application/ld+json"]').each((_, element) => {
    const scriptText = $(element).text();
    for (const node of flattenJsonLd(scriptText)) {
      const mediaType = typeof node["@type"] === "string" ? node["@type"].toLowerCase() : "";
      const isMediaNode =
        mediaType.includes("video") || mediaType.includes("audio") || mediaType.includes("image") || mediaType.includes("media");

      if (!isMediaNode) {
        continue;
      }

      addCandidate(stringField(node.contentUrl) ?? stringField(node.embedUrl) ?? stringField(node.url), {
        label: "Structured media",
        mimeType: stringField(node.encodingFormat),
        width: numberAttribute(String(node.width ?? "")),
        height: numberAttribute(String(node.height ?? ""))
      });
    }
  });

  for (const rawUrl of extractMediaUrlsFromText(html)) {
    addCandidate(rawUrl, {
      label: "Embedded media"
    });
  }

  return candidates;
}

function toAbsoluteUrl(rawUrl: string | undefined, pageUrl: URL) {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl, pageUrl).href;
  } catch {
    return undefined;
  }
}

export function parseDuration(value?: string | number | null) {
  if (value == null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  const trimmedValue = value.trim();
  const isoDuration = parseIsoDuration(trimmedValue);

  if (isoDuration != null) {
    return isoDuration;
  }

  const clockDuration = parseClockDuration(trimmedValue);

  if (clockDuration != null) {
    return clockDuration;
  }

  const seconds = Number.parseFloat(trimmedValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function metaContent($: cheerio.CheerioAPI, property: string) {
  return $(`meta[property="${property}"]`).first().attr("content");
}

function numberAttribute(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function defaultOptionLabel(mode: string, quality?: string) {
  return quality ? `${quality} ${mode}` : `${mode[0]?.toUpperCase()}${mode.slice(1)}`;
}

function dedupeOptions(options: ProviderDownloadOption[]) {
  const seenUrls = new Set<string>();

  return options.filter((option) => {
    if (seenUrls.has(option.media.url)) {
      return false;
    }

    seenUrls.add(option.media.url);
    return true;
  });
}

function flattenJsonLd(scriptText: string) {
  try {
    const parsed = JSON.parse(scriptText) as JsonLdValue;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (typeof value !== "object" || value == null) {
        return [];
      }

      const graph = (value as JsonLdNode)["@graph"];
      return graph && Array.isArray(graph) ? graph : [value as JsonLdNode];
    });
  } catch {
    return [];
  }
}

function stringField(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return stringField(value[0]);
  }

  return undefined;
}

function extractMediaUrlsFromText(text: string) {
  const matches = text.match(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:mp4|m4v|webm|mov|mp3|m4a|aac|ogg|opus|flac|wav|jpg|jpeg|png|webp|gif|m3u8|mpd)(?:\?[^"'<>\\\s]*)?/gi);

  return [...new Set((matches ?? []).map((match) => match.replaceAll("\\/", "/")))];
}

function durationFromJsonLd(html: string) {
  const $ = cheerio.load(html);

  for (const element of $('script[type="application/ld+json"]').toArray()) {
    for (const node of flattenJsonLd($(element).text())) {
      const duration = parseDuration(stringField(node.duration) ?? stringField(node.contentDuration));

      if (duration != null) {
        return duration;
      }
    }
  }

  return undefined;
}

function durationFromEmbeddedJson(html: string) {
  const secondPatterns = [
    /"(?:durationSeconds|lengthSeconds|videoDuration|duration)"\s*:\s*"([^"]+)"/gi,
    /"(?:durationSeconds|lengthSeconds|videoDuration|duration)"\s*:\s*(\d+(?:\.\d+)?)/gi
  ];
  const millisecondPatterns = [
    /"(?:durationMs|durationMillis|duration_ms|duration_millis)"\s*:\s*"([^"]+)"/gi,
    /"(?:durationMs|durationMillis|duration_ms|duration_millis)"\s*:\s*(\d+(?:\.\d+)?)/gi
  ];

  for (const pattern of secondPatterns) {
    const duration = firstRegexDuration(html, pattern, 1);

    if (duration != null) {
      return duration;
    }
  }

  for (const pattern of millisecondPatterns) {
    const duration = firstRegexDuration(html, pattern, 1000);

    if (duration != null) {
      return duration;
    }
  }

  return undefined;
}

function firstRegexDuration(text: string, pattern: RegExp, divisor: number) {
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const parsedDuration = parseDuration(match[1]);

    if (parsedDuration != null) {
      return parsedDuration / divisor;
    }
  }

  return undefined;
}

function parseIsoDuration(value: string) {
  const match = value.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);

  if (!match) {
    return undefined;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const duration =
    Number(days) * 86_400 +
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds);

  return Number.isFinite(duration) ? duration : undefined;
}

function parseClockDuration(value: string) {
  if (!/^\d{1,2}(?::\d{2}){1,2}$/.test(value)) {
    return undefined;
  }

  const parts = value.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }

  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

type JsonLdValue = JsonLdNode | JsonLdNode[];

type JsonLdNode = Record<string, unknown> & {
  "@graph"?: JsonLdNode[];
};
