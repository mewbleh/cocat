import { CoCatError } from "@/lib/server/errors";
import { readResponseText, safeFetch } from "@/lib/server/http";
import {
  absoluteUrl,
  createMediaOption,
  createSourceResult,
  getNumber,
  getString,
  parseWindowJson
} from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { ProcessingSettings } from "@/lib/contracts";
import type { Provider, ProviderContext, ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";

const BILIBILI_HOSTS = ["bilibili.com", "b23.tv"];
const BILIBILI_ORIGIN = "https://www.bilibili.com";
const BILIBILI_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const bilibiliProvider: Provider = {
  id: "bilibili",
  canHandle(url) {
    return hostMatches(url.hostname, BILIBILI_HOSTS);
  },
  extract: extractBilibili,
  resolve: resolveBilibili
};

async function extractBilibili(url: URL) {
  const { cookieHeader, html, pageUrl } = await fetchBilibiliPage(url);
  const metadata = parseHtmlMetadata(html, pageUrl, "bilibili");
  const initialState = parseWindowJson(html, "__INITIAL_STATE__");
  const pageInfo = pageInfoFromState(initialState);
  const embeddedPlayInfo = parseWindowJson(html, "__playinfo__");
  const options = optionsFromPlayInfo(embeddedPlayInfo, pageUrl, cookieHeader, "embedded");
  const playInfoOptionCount = options.length;
  let apiPlayInfo: unknown;

  if (options.length === 0) {
    apiPlayInfo = await fetchBilibiliPlayInfo(pageInfo, pageUrl, cookieHeader).catch(() => undefined);
    options.push(...optionsFromPlayInfo(apiPlayInfo, pageUrl, cookieHeader, "api"));
  }

  if (options.length === 0) {
    options.push(...metadata.options.map((option) => withBilibiliMediaHeaders(option, pageUrl.href, cookieHeader)));
  }

  if (options.length === 0) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "Bilibili did not expose public media for this video.");
  }

  return createSourceResult({
    providerId: "bilibili",
    sourceUrl: url.href,
    title: pageInfo.title ?? metadata.title ?? "Bilibili video",
    author: pageInfo.author ?? metadata.author,
    thumbnailUrl: absoluteUrl(pageInfo.thumbnailUrl, pageUrl) ?? metadata.thumbnailUrl,
    durationSeconds: pageInfo.durationSeconds ?? durationFromPlayInfo(embeddedPlayInfo) ?? durationFromPlayInfo(apiPlayInfo) ?? metadata.durationSeconds,
    options,
    debug: {
      strategy: playInfoOptionCount > 0 || apiPlayInfo ? "playinfo" : "html-fallback",
      bvid: pageInfo.bvid ?? null,
      cid: pageInfo.cid ?? null,
      embeddedPlayInfo: Boolean(embeddedPlayInfo),
      apiPlayInfo: Boolean(apiPlayInfo)
    }
  });
}

async function resolveBilibili(
  source: ProviderExtractResult,
  optionId: string,
  context: ProviderContext,
  settings: ProcessingSettings
) {
  const selectedOption = source.options.find((option) => option.id === optionId);
  const refreshedSource = await extractBilibili(new URL(source.sourceUrl)).catch(() => source);
  const refreshedOption =
    refreshedSource.options.find((option) => option.id === optionId) ??
    refreshedSource.options.find((option) => option.mode === selectedOption?.mode);

  return resolveOption(refreshedSource, refreshedOption?.id ?? optionId, context, settings);
}

async function fetchBilibiliPage(url: URL) {
  const response = await safeFetch(url.href, {
    headers: bilibiliPageHeaders()
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `Bilibili returned HTTP ${response.status}.`);
  }

  return {
    cookieHeader: cookieHeaderFromResponse(response),
    html: await readResponseText(response),
    pageUrl: finalResponseUrl(response, url)
  };
}

async function fetchBilibiliPlayInfo(pageInfo: BilibiliPageInfo, pageUrl: URL, cookieHeader?: string) {
  if (!pageInfo.cid || (!pageInfo.bvid && !pageInfo.aid)) {
    return undefined;
  }

  const apiUrl = new URL("https://api.bilibili.com/x/player/playurl");
  apiUrl.searchParams.set(pageInfo.bvid ? "bvid" : "avid", pageInfo.bvid ?? pageInfo.aid ?? "");
  apiUrl.searchParams.set("cid", pageInfo.cid);
  apiUrl.searchParams.set("qn", "80");
  apiUrl.searchParams.set("fnver", "0");
  apiUrl.searchParams.set("fnval", "80");
  apiUrl.searchParams.set("fourk", "1");
  apiUrl.searchParams.set("otype", "json");

  const response = await safeFetch(apiUrl.href, {
    headers: bilibiliApiHeaders(pageUrl.href, cookieHeader)
  });

  if (!response.ok) {
    return undefined;
  }

  const text = await readResponseText(response);

  try {
    const parsed = JSON.parse(text) as unknown;
    const code = getNumber(asRecord(parsed)?.code);
    return code == null || code === 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function optionsFromPlayInfo(
  playInfo: unknown,
  pageUrl: URL,
  cookieHeader: string | undefined,
  sourceId: string
): ProviderDownloadOption[] {
  const data = playInfoData(playInfo);

  if (!data) {
    return [];
  }

  return [
    ...progressiveOptionsFromPlayInfo(data, pageUrl, cookieHeader, sourceId),
    ...dashOptionsFromPlayInfo(data, pageUrl, cookieHeader, sourceId)
  ];
}

function progressiveOptionsFromPlayInfo(
  data: Record<string, unknown>,
  pageUrl: URL,
  cookieHeader: string | undefined,
  sourceId: string
): ProviderDownloadOption[] {
  const durlEntries = recordsFrom(data.durl);
  const quality = qualityDescription(data);

  return durlEntries
    .map((entry, index) => {
      const mediaUrl = mediaUrlFromRecord(entry, pageUrl);

      if (!mediaUrl) {
        return undefined;
      }

      return createMediaOption({
        providerId: "bilibili",
        id: `bilibili:mp4:${sourceId}:${index}`,
        url: mediaUrl,
        label: durlEntries.length > 1 ? `Bilibili MP4 part ${index + 1}` : "Bilibili MP4",
        mode: "video",
        mimeType: "video/mp4",
        extension: "mp4",
        sizeBytes: getNumber(entry.size),
        quality,
        headers: bilibiliMediaHeaders(pageUrl.href, "video", cookieHeader),
        fallbackHeaders: bilibiliMediaFallbackHeaders(pageUrl.href, "video", cookieHeader)
      });
    })
    .filter((option): option is ProviderDownloadOption => Boolean(option));
}

function dashOptionsFromPlayInfo(
  data: Record<string, unknown>,
  pageUrl: URL,
  cookieHeader: string | undefined,
  sourceId: string
): ProviderDownloadOption[] {
  const dash = asRecord(data.dash);

  if (!dash) {
    return [];
  }

  const audio = recordsFrom(dash.audio).sort(compareStreamQuality)[0];
  const audioUrl = audio ? mediaUrlFromRecord(audio, pageUrl) : undefined;
  const audioMimeType = getString(audio?.mimeType) ?? "audio/mp4";
  const options: ProviderDownloadOption[] = [];

  for (const [index, video] of recordsFrom(dash.video).sort(compareStreamQuality).entries()) {
    const videoUrl = mediaUrlFromRecord(video, pageUrl);

    if (!videoUrl) {
      continue;
    }

    const width = getNumber(video.width);
    const height = getNumber(video.height);
    const mimeType = getString(video.mimeType) ?? "video/mp4";
    const bitrateKbps = getNumber(video.bandwidth) ? Math.round((getNumber(video.bandwidth) ?? 0) / 1000) : undefined;

    options.push({
      id: `bilibili:dash:${sourceId}:${index}`,
      label: audioUrl ? "Bilibili DASH video + audio" : "Bilibili DASH video",
      mode: "video",
      extension: "mp4",
      container: "mp4",
      quality: qualityDescription(data, video) ?? (height ? `${height}p` : undefined),
      mimeType,
      codecs: getString(video.codecs),
      width,
      height,
      fps: frameRate(getString(video.frameRate)),
      bitrateKbps,
      hasAudio: Boolean(audioUrl),
      hasVideo: true,
      isAdaptive: true,
      requiresFfmpeg: true,
      transport: "direct",
      media: {
        transport: "direct",
        url: videoUrl,
        audioUrl,
        headers: bilibiliMediaHeaders(pageUrl.href, "video", cookieHeader),
        fallbackHeaders: bilibiliMediaFallbackHeaders(pageUrl.href, "video", cookieHeader),
        mimeType,
        audioMimeType
      }
    });
  }

  return options;
}

function playInfoData(playInfo: unknown) {
  const record = asRecord(playInfo);
  return asRecord(record?.data) ?? asRecord(record?.result) ?? record;
}

function pageInfoFromState(initialState: unknown): BilibiliPageInfo {
  const state = asRecord(initialState);
  const videoData = asRecord(state?.videoData);
  const owner = asRecord(videoData?.owner);
  const pages = recordsFrom(videoData?.pages);

  return {
    aid: idString(videoData?.aid ?? state?.aid),
    author: getString(owner?.name),
    bvid: getString(videoData?.bvid) ?? getString(state?.bvid),
    cid: idString(videoData?.cid ?? pages[0]?.cid ?? state?.cid),
    durationSeconds: getNumber(videoData?.duration),
    thumbnailUrl: getString(videoData?.pic),
    title: getString(videoData?.title) ?? getString(state?.title)
  };
}

function durationFromPlayInfo(playInfo: unknown) {
  const data = playInfoData(playInfo);
  const timeLengthMs = getNumber(data?.timelength);
  const dashDuration = getNumber(asRecord(data?.dash)?.duration);

  return timeLengthMs ? Math.round(timeLengthMs / 1000) : dashDuration;
}

function mediaUrlFromRecord(record: Record<string, unknown>, pageUrl: URL) {
  const rawUrl =
    getString(record.baseUrl) ??
    getString(record.base_url) ??
    getString(record.url) ??
    backupUrlsFromRecord(record)[0];

  return absoluteUrl(rawUrl, pageUrl);
}

function backupUrlsFromRecord(record: Record<string, unknown>) {
  return [...stringArray(record.backupUrl), ...stringArray(record.backup_url)];
}

function recordsFrom(value: unknown) {
  return Array.isArray(value) ? value.map(asRecord).filter((record): record is Record<string, unknown> => Boolean(record)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(getString).filter((item): item is string => Boolean(item)) : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value != null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function idString(value: unknown) {
  const stringValue = getString(value);

  if (stringValue) {
    return stringValue;
  }

  const numberValue = getNumber(value);
  return numberValue == null ? undefined : String(Math.trunc(numberValue));
}

function compareStreamQuality(left: Record<string, unknown>, right: Record<string, unknown>) {
  return streamScore(right) - streamScore(left);
}

function streamScore(stream: Record<string, unknown>) {
  return (getNumber(stream.height) ?? 0) * 1_000_000 + (getNumber(stream.bandwidth) ?? 0);
}

function qualityDescription(data: Record<string, unknown>, stream?: Record<string, unknown>) {
  const qualityId = getNumber(stream?.id) ?? getNumber(data.quality);
  const qualityIds = Array.isArray(data.accept_quality) ? data.accept_quality.map(getNumber) : [];
  const descriptions = Array.isArray(data.accept_description) ? data.accept_description.map(getString) : [];
  const qualityIndex = qualityIds.findIndex((candidate) => candidate === qualityId);

  return descriptions[qualityIndex] ?? (qualityId ? `Bilibili quality ${qualityId}` : undefined);
}

function frameRate(value?: string) {
  if (!value) {
    return undefined;
  }

  const [numerator, denominator] = value.split("/").map((part) => Number.parseFloat(part));
  const parsed = denominator ? numerator / denominator : numerator;
  return Number.isFinite(parsed) ? Math.round(parsed) : undefined;
}

function withBilibiliMediaHeaders(
  option: ProviderDownloadOption,
  referer: string,
  cookieHeader: string | undefined
): ProviderDownloadOption {
  return {
    ...option,
    media: {
      ...option.media,
      headers: {
        ...bilibiliMediaHeaders(referer, option.mode, cookieHeader),
        ...option.media.headers
      },
      fallbackHeaders: [
        ...bilibiliMediaFallbackHeaders(referer, option.mode, cookieHeader),
        ...(option.media.fallbackHeaders ?? [])
      ]
    }
  };
}

function bilibiliPageHeaders() {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    referer: BILIBILI_ORIGIN,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "upgrade-insecure-requests": "1",
    "user-agent": BILIBILI_BROWSER_USER_AGENT
  };
}

function bilibiliApiHeaders(referer: string, cookieHeader?: string) {
  return withCookieHeader({
    accept: "application/json,text/plain,*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: BILIBILI_ORIGIN,
    referer,
    "user-agent": BILIBILI_BROWSER_USER_AGENT
  }, cookieHeader);
}

function bilibiliMediaHeaders(referer: string, mode: ProviderDownloadOption["mode"], cookieHeader?: string) {
  return withCookieHeader({
    accept: acceptHeaderForMode(mode),
    "accept-language": "en-US,en;q=0.9",
    origin: BILIBILI_ORIGIN,
    range: "bytes=0-",
    referer,
    "sec-fetch-dest": mode === "photo" ? "image" : mode,
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "user-agent": BILIBILI_BROWSER_USER_AGENT
  }, cookieHeader);
}

function bilibiliMediaFallbackHeaders(referer: string, mode: ProviderDownloadOption["mode"], cookieHeader?: string) {
  return [
    withCookieHeader({
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer,
      "user-agent": BILIBILI_BROWSER_USER_AGENT
    }, cookieHeader),
    withCookieHeader({
      accept: acceptHeaderForMode(mode),
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer: BILIBILI_ORIGIN,
      "user-agent": BILIBILI_BROWSER_USER_AGENT
    }, cookieHeader)
  ];
}

function acceptHeaderForMode(mode: ProviderDownloadOption["mode"]) {
  if (mode === "audio") {
    return "audio/mp4,audio/*;q=0.9,*/*;q=0.8";
  }

  if (mode === "photo") {
    return "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
  }

  return "video/mp4,video/*;q=0.9,*/*;q=0.8";
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

function finalResponseUrl(response: Response, fallbackUrl: URL) {
  try {
    return response.url ? new URL(response.url) : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

type BilibiliPageInfo = {
  aid?: string;
  author?: string;
  bvid?: string;
  cid?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  title?: string;
};
