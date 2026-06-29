import { CoCatError } from "@/lib/server/errors";
import { readResponseText, safeFetch } from "@/lib/server/http";
import {
  absoluteUrl,
  collectStringValuesByKey,
  createMediaOption,
  createSourceResult,
  findFirstStringByKey,
  parseJsonScript
} from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderContext, ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";
import type { ProcessingSettings } from "@/lib/contracts";

const TIKTOK_HOSTS = ["tiktok.com"];
const BROWSER_MEDIA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const tiktokProvider: Provider = {
  id: "tiktok",
  canHandle(url) {
    return hostMatches(url.hostname, TIKTOK_HOSTS);
  },
  extract: extractTikTok,
  resolve: resolveTikTok
};

async function extractTikTok(url: URL) {
  const { cookieHeader, html } = await fetchTikTokPage(url);
  const metadata = parseHtmlMetadata(html, url, "tiktok");
  const state = parseJsonScript(html, "SIGI_STATE") ?? parseJsonScript(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const options: ProviderDownloadOption[] = [];
  const mediaUrls = collectStringValuesByKey(state, [
    "playAddr",
    "downloadAddr",
    "playUrl",
    "url",
    "urlList"
  ])
    .flatMap((value) => splitMaybeUrlList(value))
    .map((value) => absoluteUrl(value, url))
    .filter((value): value is string => Boolean(value))
    .filter(isLikelyTikTokVideoUrl);

  mediaUrls.forEach((mediaUrl, index) => {
    const option = createMediaOption({
      providerId: "tiktok",
      id: `tiktok:video:${index}`,
      url: mediaUrl,
      label: index === 0 ? "TikTok video" : "TikTok alternate video",
      mode: "video",
      mimeType: "video/mp4",
      extension: "mp4",
      headers: tiktokMediaHeaders(url.href, cookieHeader),
      fallbackHeaders: tiktokMediaFallbackHeaders(url.href, cookieHeader)
    });

    if (option) {
      options.push(option);
    }
  });

  if (options.length === 0) {
    options.push(...metadata.options);
  }

  const downloadOptions = options.map((option) => withTikTokMediaHeaders(option, url.href, cookieHeader));

  if (downloadOptions.length === 0) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "TikTok did not expose a public media file on the page.");
  }

  return createSourceResult({
    providerId: "tiktok",
    sourceUrl: url.href,
    title: findFirstStringByKey(state, ["desc", "title"]) ?? metadata.title,
    author: findFirstStringByKey(state, ["uniqueId", "nickname"]) ?? metadata.author,
    thumbnailUrl:
      absoluteUrl(findFirstStringByKey(state, ["cover", "dynamicCover", "originCover", "thumbnailUrl"]), url) ??
      metadata.thumbnailUrl,
    durationSeconds: metadata.durationSeconds,
    options: downloadOptions,
    debug: {
      strategy: state ? "sigi-state" : "html-fallback",
      embeddedVideoCount: mediaUrls.length
    }
  });
}

async function resolveTikTok(
  source: ProviderExtractResult,
  optionId: string,
  context: ProviderContext,
  settings: ProcessingSettings
) {
  const selectedOption = source.options.find((option) => option.id === optionId);
  const refreshedSource = await extractTikTok(new URL(source.sourceUrl)).catch(() => source);
  const refreshedOption =
    refreshedSource.options.find((option) => option.id === optionId) ??
    refreshedSource.options.find((option) => option.mode === selectedOption?.mode);

  return resolveOption(refreshedSource, refreshedOption?.id ?? optionId, context, settings);
}

function splitMaybeUrlList(value: string) {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isLikelyTikTokVideoUrl(value: string) {
  return (
    value.includes("tiktokcdn") ||
    value.includes("mime_type=video") ||
    /\.(?:mp4|webm)(?:\?|$)/i.test(value)
  );
}

async function fetchTikTokPage(url: URL) {
  const response = await safeFetch(url.href, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://www.tiktok.com/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
      "user-agent": BROWSER_MEDIA_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `TikTok returned HTTP ${response.status}.`);
  }

  return {
    cookieHeader: cookieHeaderFromResponse(response),
    html: await readResponseText(response)
  };
}

function withTikTokMediaHeaders(
  option: ProviderDownloadOption,
  referer: string,
  cookieHeader: string | undefined
): ProviderDownloadOption {
  return {
    ...option,
    media: {
      ...option.media,
      headers: {
        ...tiktokMediaHeaders(referer, cookieHeader),
        ...option.media.headers
      },
      fallbackHeaders: [
        ...tiktokMediaFallbackHeaders(referer, cookieHeader),
        ...(option.media.fallbackHeaders ?? [])
      ]
    }
  };
}

function tiktokMediaHeaders(referer: string, cookieHeader?: string) {
  return withCookieHeader({
    accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://www.tiktok.com",
    range: "bytes=0-",
    referer,
    "sec-fetch-dest": "video",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "user-agent": BROWSER_MEDIA_USER_AGENT
  }, cookieHeader);
}

function tiktokMediaFallbackHeaders(referer: string, cookieHeader?: string) {
  return [
    withCookieHeader({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer: "https://www.tiktok.com/",
      "user-agent": BROWSER_MEDIA_USER_AGENT
    }, cookieHeader),
    withCookieHeader({
      accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer,
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    }, cookieHeader),
    withCookieHeader({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.tiktok.com/",
      "user-agent": BROWSER_MEDIA_USER_AGENT
    }, cookieHeader)
  ];
}

function withCookieHeader(headers: Record<string, string>, cookieHeader?: string) {
  if (!cookieHeader) {
    return headers;
  }

  return {
    ...headers,
    cookie: cookieHeader
  };
}

function cookieHeaderFromResponse(response: Response) {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookieHeaders = getSetCookie ? getSetCookie.call(response.headers) : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = setCookieHeaders
    .flatMap((header) => splitSetCookieHeader(header ?? ""))
    .map((header) => header.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function splitSetCookieHeader(header: string) {
  if (!header) {
    return [];
  }

  return header.split(/,(?=\s*[^;,\s]+=)/g);
}
