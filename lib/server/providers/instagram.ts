import { CoCatError } from "@/lib/server/errors";
import { readResponseText, safeFetch } from "@/lib/server/http";
import {
  absoluteUrl,
  createMediaOption,
  createSourceResult
} from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { detectAuthRequired } from "@/lib/server/providers/html-platform";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderContext, ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";
import type { ProcessingSettings } from "@/lib/contracts";

const INSTAGRAM_HOSTS = ["instagram.com"];
const AUTH_MARKERS = ["login_required", "Please wait a few minutes", "Log in to Instagram"];
const DESKTOP_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MOBILE_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const instagramProvider: Provider = {
  id: "instagram",
  canHandle(url) {
    return hostMatches(url.hostname, INSTAGRAM_HOSTS);
  },
  extract: extractInstagram,
  resolve: resolveInstagram
};

async function extractInstagram(url: URL) {
  const { cookieHeader, html } = await fetchInstagramPage(url);
  const metadata = parseHtmlMetadata(html, url, "instagram");
  const options: ProviderDownloadOption[] = [];

  for (const [index, mediaUrl] of extractInstagramVideoUrls(html)) {
    const option = createMediaOption({
      providerId: "instagram",
      id: `instagram:video:${index}`,
      url: mediaUrl,
      label: "Instagram video",
      mode: "video",
      mimeType: "video/mp4",
      extension: "mp4",
      headers: instagramMediaHeaders({ mediaUrl, mode: "video", referer: url.href, cookieHeader }),
      fallbackHeaders: instagramMediaFallbackHeaders({ mediaUrl, mode: "video", referer: url.href, cookieHeader })
    });

    if (option) {
      options.push(option);
    }
  }

  for (const [index, imageUrl] of extractInstagramUrls(html, ["display_url", "thumbnail_src", "image_versions2"])) {
    const option = createMediaOption({
      providerId: "instagram",
      id: `instagram:image:${index}`,
      url: imageUrl,
      label: "Instagram image",
      mode: "photo",
      mimeType: imageMimeTypeFromUrl(imageUrl),
      headers: instagramMediaHeaders({ mediaUrl: imageUrl, mode: "photo", referer: url.href, cookieHeader }),
      fallbackHeaders: instagramMediaFallbackHeaders({ mediaUrl: imageUrl, mode: "photo", referer: url.href, cookieHeader })
    });

    if (option) {
      options.push(option);
    }
  }

  if (options.length === 0) {
    const thumbnailOption = instagramImageOption({
      id: "instagram:image:thumbnail",
      imageUrl: metadata.thumbnailUrl,
      label: "Instagram image",
      referer: url.href,
      cookieHeader
    });

    if (thumbnailOption) {
      options.push(thumbnailOption);
    }
  }

  if (options.length === 0) {
    options.push(...metadata.options.filter(isLikelyInstagramPostOption));
  }

  const downloadOptions = options.map((option) => withInstagramMediaHeaders(option, url.href, cookieHeader));

  if (downloadOptions.length === 0) {
    if (detectAuthRequired(html, AUTH_MARKERS)) {
      throw new CoCatError("AUTH_REQUIRED", "Instagram is not exposing this media publicly.");
    }

    throw new CoCatError("UNSUPPORTED_MEDIA", "Instagram did not expose a public media file on the page.");
  }

  return createSourceResult({
    providerId: "instagram",
    sourceUrl: url.href,
    title: metadata.title,
    author: metadata.author,
    thumbnailUrl: metadata.thumbnailUrl,
    durationSeconds: metadata.durationSeconds,
    options: downloadOptions,
    debug: {
      strategy: "html-json",
      extractedCount: downloadOptions.length
    }
  });
}

function instagramImageOption({
  cookieHeader,
  id,
  imageUrl,
  label,
  referer
}: {
  cookieHeader?: string;
  id: string;
  imageUrl?: string;
  label: string;
  referer: string;
}) {
  if (!imageUrl) {
    return undefined;
  }

  return createMediaOption({
    providerId: "instagram",
    id,
    url: imageUrl,
    label,
    mode: "photo",
    mimeType: imageMimeTypeFromUrl(imageUrl),
    headers: instagramMediaHeaders({ mediaUrl: imageUrl, mode: "photo", referer, cookieHeader }),
    fallbackHeaders: instagramMediaFallbackHeaders({ mediaUrl: imageUrl, mode: "photo", referer, cookieHeader })
  });
}

async function resolveInstagram(
  source: ProviderExtractResult,
  optionId: string,
  context: ProviderContext,
  settings: ProcessingSettings
) {
  const selectedOption = source.options.find((option) => option.id === optionId);
  const refreshedSource = await extractInstagram(new URL(source.sourceUrl)).catch(() => source);
  const refreshedOption =
    refreshedSource.options.find((option) => option.id === optionId) ??
    refreshedSource.options.find((option) => option.mode === selectedOption?.mode);

  return resolveOption(refreshedSource, refreshedOption?.id ?? optionId, context, settings);
}

function extractInstagramVideoUrls(html: string) {
  const urls = new Set<string>();

  for (const [, mediaUrl] of extractInstagramUrls(html, ["video_url"])) {
    urls.add(mediaUrl);
  }

  for (const mediaUrl of extractInstagramNestedUrls(html, ["video_versions"])) {
    urls.add(mediaUrl);
  }

  return [...urls].entries();
}

function extractInstagramUrls(html: string, keys: string[]) {
  const urls = new Set<string>();

  for (const key of keys) {
    const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "g");
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html))) {
      const decoded = decodeJsonUrl(match[1]);

      if (decoded) {
        urls.add(decoded);
      }
    }
  }

  return [...urls].entries();
}

function extractInstagramNestedUrls(html: string, keys: string[]) {
  const urls = new Set<string>();

  for (const key of keys) {
    const regex = new RegExp(`"${key}"\\s*:`, "g");

    while (regex.exec(html)) {
      const valueStart = firstNonWhitespaceIndex(html, regex.lastIndex);

      if (valueStart == null) {
        continue;
      }

      if (html[valueStart] === "\"") {
        const quotedValue = readJsonStringLiteral(html, valueStart);
        const decoded = quotedValue ? decodeJsonUrl(quotedValue) : undefined;

        if (decoded) {
          urls.add(decoded);
        }

        continue;
      }

      const jsonText = readBalancedJson(html, valueStart);

      if (!jsonText) {
        continue;
      }

      for (const rawUrl of collectUrlFields(jsonText)) {
        const decoded = decodeJsonUrl(rawUrl);

        if (decoded) {
          urls.add(decoded);
        }
      }
    }
  }

  return urls;
}

function collectUrlFields(jsonText: string) {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const urls = new Set<string>();
    walkJson(parsed, (key, value) => {
      if (key === "url" && typeof value === "string" && value.trim()) {
        urls.add(value.trim());
      }
    });

    return urls;
  } catch {
    const urls = new Set<string>();
    const regex = /"url"\s*:\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(jsonText))) {
      urls.add(match[1]);
    }

    return urls;
  }
}

function decodeJsonUrl(value: string) {
  try {
    return absoluteUrl(JSON.parse(`"${value}"`) as string, "https://www.instagram.com/");
  } catch {
    return absoluteUrl(value.replaceAll("\\/", "/"), "https://www.instagram.com/");
  }
}

function firstNonWhitespaceIndex(text: string, startIndex: number) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      return index;
    }
  }

  return undefined;
}

function readJsonStringLiteral(text: string, startIndex: number) {
  let isEscaped = false;

  for (let index = startIndex + 1; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === "\"") {
      return text.slice(startIndex + 1, index);
    }
  }

  return undefined;
}

function readBalancedJson(text: string, startIndex: number) {
  const opener = text[startIndex];
  const closer = opener === "[" ? "]" : opener === "{" ? "}" : undefined;

  if (!closer) {
    return undefined;
  }

  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === "\"") {
      isInString = !isInString;
      continue;
    }

    if (isInString) {
      continue;
    }

    if (char === opener) {
      depth += 1;
    }

    if (char === closer) {
      depth -= 1;
    }

    if (depth === 0) {
      return text.slice(startIndex, index + 1);
    }
  }

  return undefined;
}

function walkJson(input: unknown, visit: (key: string, value: unknown) => void) {
  if (Array.isArray(input)) {
    input.forEach((item) => walkJson(item, visit));
    return;
  }

  if (typeof input !== "object" || input == null) {
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    visit(key, value);
    walkJson(value, visit);
  }
}

async function fetchInstagramPage(url: URL) {
  const response = await safeFetch(url.href, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.instagram.com/",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
      "user-agent": DESKTOP_BROWSER_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `Instagram returned HTTP ${response.status}.`);
  }

  return {
    cookieHeader: cookieHeaderFromResponse(response),
    html: await readResponseText(response)
  };
}

function withInstagramMediaHeaders(
  option: ProviderDownloadOption,
  referer: string,
  cookieHeader: string | undefined
): ProviderDownloadOption {
  return {
    ...option,
    media: {
      ...option.media,
      headers: {
        ...instagramMediaHeaders({ mediaUrl: option.media.url, mode: option.mode, referer, cookieHeader }),
        ...option.media.headers
      },
      fallbackHeaders: [
        ...instagramMediaFallbackHeaders({ mediaUrl: option.media.url, mode: option.mode, referer, cookieHeader }),
        ...(option.media.fallbackHeaders ?? [])
      ]
    }
  };
}

function instagramMediaHeaders({
  cookieHeader,
  mediaUrl,
  mode,
  referer
}: {
  cookieHeader?: string;
  mediaUrl: string;
  mode: "video" | "photo" | "gif" | "audio";
  referer: string;
}) {
  const scopedCookieHeader = cookieHeaderForMediaUrl(mediaUrl, cookieHeader);
  const headers = {
    accept: mode === "video" ? "video/mp4,video/*;q=0.9,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    origin: "https://www.instagram.com",
    referer,
    "sec-fetch-dest": mode === "video" ? "video" : "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "sec-ch-ua": "\"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\", \"Not-A.Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };

  return withCookieHeader({ ...headers, range: "bytes=0-" }, scopedCookieHeader);
}

function instagramMediaFallbackHeaders({
  cookieHeader,
  mediaUrl,
  mode,
  referer
}: {
  cookieHeader?: string;
  mediaUrl: string;
  mode: "video" | "photo" | "gif" | "audio";
  referer: string;
}) {
  const scopedCookieHeader = cookieHeaderForMediaUrl(mediaUrl, cookieHeader);
  const rangeHeader: Record<string, string> = { range: "bytes=0-" };

  return [
    withCookieHeader({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.instagram.com/",
      "user-agent": DESKTOP_BROWSER_USER_AGENT,
      ...rangeHeader
    }, scopedCookieHeader),
    withCookieHeader({
      accept: mode === "video" ? "video/mp4,video/*;q=0.9,*/*;q=0.8" : "image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer,
      "user-agent": MOBILE_SAFARI_USER_AGENT,
      ...rangeHeader
    }, scopedCookieHeader),
    withCookieHeader({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      referer,
      "user-agent": DESKTOP_BROWSER_USER_AGENT,
      ...rangeHeader
    }, scopedCookieHeader),
    {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.instagram.com/",
      "sec-fetch-dest": mode === "video" ? "video" : "image",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
      "user-agent": DESKTOP_BROWSER_USER_AGENT,
      ...rangeHeader
    }
  ];
}

function imageMimeTypeFromUrl(mediaUrl: string) {
  const parsedUrl = new URL(mediaUrl);
  const pathname = parsedUrl.pathname.toLowerCase();
  const transform = parsedUrl.searchParams.get("stp")?.toLowerCase() ?? "";

  if (pathname.endsWith(".png")) {
    return "image/png";
  }

  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }

  if (pathname.endsWith(".gif")) {
    return "image/gif";
  }

  if (pathname.endsWith(".heic") && !transform.includes("dst-jpg")) {
    return "image/heic";
  }

  return "image/jpeg";
}

function isLikelyInstagramPostOption(option: ProviderDownloadOption) {
  try {
    const parsedUrl = new URL(option.media.url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (hostname === "static.cdninstagram.com") {
      return false;
    }

    if (pathname.includes("-19/")) {
      return false;
    }

    return hostname.includes("cdninstagram.com") || hostname.includes("fbcdn.net") || hostname.includes("fbsbx.com");
  } catch {
    return false;
  }
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

function cookieHeaderForMediaUrl(mediaUrl: string, cookieHeader?: string) {
  if (!cookieHeader) {
    return undefined;
  }

  try {
    const hostname = new URL(mediaUrl).hostname.toLowerCase();
    return hostname === "instagram.com" || hostname.endsWith(".instagram.com") ? cookieHeader : undefined;
  } catch {
    return undefined;
  }
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
