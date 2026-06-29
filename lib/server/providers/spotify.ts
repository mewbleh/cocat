import { DEFAULT_PROCESSING_SETTINGS, type ProcessingSettings } from "@/lib/contracts";
import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";
import { fetchJson, fetchText, readResponseText, safeFetch } from "@/lib/server/http";
import {
  absoluteUrl,
  collectStringValuesByKey,
  createMediaOption,
  createSourceResult,
  parseJsonScript
} from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { buildFileName } from "@/lib/server/providers/media-utils";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type {
  Provider,
  ProviderContext,
  ProviderDownloadOption,
  ProviderExtractResult,
  ResolvedMedia
} from "@/lib/server/providers/types";
import { safeFileName } from "@/lib/utils";

const SPOTIFY_HOSTS = ["open.spotify.com", "spotify.link"];
const SPOTIFY_PREVIEW_PATH = "/mp3-preview/";
const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const SPOTMATE_BASE_URL = "https://spotmate.online";
const SPOTMATE_PAGE_URL = `${SPOTMATE_BASE_URL}/en1`;
const SPOTMATE_TASKS_BASE_URL = `${SPOTMATE_BASE_URL}/tasks`;
const SPOTMATE_MAX_STATUS_ATTEMPTS = 40;
const SPOTMATE_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 0 : 4500;
const DESKTOP_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const spotifyProvider: Provider = {
  id: "spotify",
  canHandle(url) {
    return hostMatches(url.hostname, SPOTIFY_HOSTS);
  },
  async extract(url) {
    const config = getServerConfig();
    const [html, oembed, spotmateTrack] = await Promise.all([
      fetchText(url.href, { headers: spotifyPageHeaders() }).catch(() => ""),
      fetchSpotifyOembed(url).catch(() => undefined),
      config.enableSpotmate ? fetchSpotmateTrackData(url).catch(() => undefined) : Promise.resolve(undefined)
    ]);
    const metadata = html ? parseHtmlMetadata(html, url, "spotify") : undefined;
    const title = cleanSpotifyTitle(spotmateTrack?.name ?? oembed?.title ?? metadata?.title ?? "Spotify media");
    const author = spotmateArtists(spotmateTrack) ?? metadata?.author;
    const options = [
      ...spotmateOptions(spotmateTrack),
      ...spotifyPreviewOptions(html, url),
      ...(metadata?.options.filter(isSpotifyMediaOption) ?? [])
    ];

    if (options.length === 0) {
      options.push(...await itunesPreviewOptions({ author, title }).catch(() => []));
    }

    if (options.length === 0) {
      throw new CoCatError("UNSUPPORTED_MEDIA", spotifyUnsupportedMessage(config.enableSpotmate));
    }

    return createSourceResult({
      providerId: "spotify",
      sourceUrl: url.href,
      title,
      author,
      thumbnailUrl: spotmateTrack?.album?.images?.[0]?.url ?? oembed?.thumbnail_url ?? metadata?.thumbnailUrl,
      durationSeconds: millisecondsToSeconds(spotmateTrack?.duration_ms) ?? metadata?.durationSeconds,
      options,
      debug: {
        strategy: spotmateTrack ? "spotmate-oembed-preview-html-itunes" : "oembed-preview-html-itunes",
        previewCount: options.filter((option) => isSpotifyPreviewUrl(option.media.url)).length,
        matchedPreviewCount: options.filter((option) => isItunesPreviewUrl(option.media.url)).length,
        hasOembed: Boolean(oembed),
        spotmateEnabled: config.enableSpotmate,
        hasSpotmate: Boolean(spotmateTrack),
        spotmateTrackUrl: spotmateTrack?.external_urls?.spotify ?? null
      }
    });
  },
  async resolve(source, optionId, context, settings = DEFAULT_PROCESSING_SETTINGS) {
    const option = source.options.find((candidate) => candidate.id === optionId);

    if (!option) {
      throw new CoCatError("BAD_REQUEST", "That Spotify option is not available for this source.");
    }

    if (isSpotmateOption(option)) {
      return resolveSpotmateTrack(source, option, context, settings);
    }

    return resolveOption(source, optionId, context, settings);
  }
};

function spotmateOptions(track?: SpotmateTrackData) {
  if (!track || track.type !== "track" || !track.external_urls?.spotify) {
    return [];
  }

  const option = createMediaOption({
    providerId: "spotify",
    id: `spotify:spotmate:${track.id ?? "track"}:mp3`,
    url: `${SPOTMATE_BASE_URL}/convert`,
    label: "Spotify full track",
    mode: "audio",
    mimeType: "audio/mpeg",
    extension: "mp3",
    quality: "Full track",
    headers: spotmateDownloadHeaders()
  });

  return option ? [option] : [];
}

function spotifyPreviewOptions(html: string, pageUrl: URL) {
  return spotifyPreviewUrls(html, pageUrl).map((previewUrl, index) => {
    const option = createMediaOption({
      providerId: "spotify",
      id: `spotify:preview:${index}`,
      url: previewUrl,
      label: "Spotify audio preview",
      mode: "audio",
      mimeType: "audio/mpeg",
      extension: "mp3",
      headers: spotifyMediaHeaders(pageUrl.href)
    });

    return option;
  }).filter((option): option is ProviderDownloadOption => Boolean(option));
}

async function itunesPreviewOptions({ author, title }: { author?: string; title: string }) {
  const searchTerm = spotifySearchTerm(title, author);

  if (!searchTerm) {
    return [];
  }

  const searchUrl = new URL(ITUNES_SEARCH_URL);
  searchUrl.searchParams.set("term", searchTerm);
  searchUrl.searchParams.set("country", "US");
  searchUrl.searchParams.set("media", "music");
  searchUrl.searchParams.set("entity", "song");
  searchUrl.searchParams.set("limit", "10");

  const response = await fetchJson<ItunesSearchResponse>(searchUrl.href, {
    headers: {
      accept: "application/json"
    }
  });
  const match = bestItunesPreviewMatch(response.results ?? [], title, author);

  if (!match?.previewUrl) {
    return [];
  }

  const isMp3 = match.previewUrl.toLowerCase().includes(".mp3");
  const option = createMediaOption({
    providerId: "spotify",
    id: `spotify:itunes-preview:${match.trackId ?? "match"}`,
    url: match.previewUrl,
    label: "Matched Apple preview",
    mode: "audio",
    mimeType: isMp3 ? "audio/mpeg" : "audio/mp4",
    extension: isMp3 ? "mp3" : "m4a",
    quality: "Preview",
    headers: {
      accept: "audio/mp4,audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
      referer: match.trackViewUrl ?? "https://music.apple.com/",
      "user-agent": DESKTOP_BROWSER_USER_AGENT
    }
  });

  return option ? [option] : [];
}

function spotifyPreviewUrls(html: string, pageUrl: URL) {
  const pageData = parseJsonScript(html, "__NEXT_DATA__");
  const values = new Set([
    ...collectStringValuesByKey(pageData, ["audioPreview", "audioPreviewUrl", "audio_preview_url", "preview_url", "previewUrl", "url"]),
    ...extractPreviewUrlsFromText(html)
  ]);

  return [...values]
    .map((value) => normalizePreviewUrl(value, pageUrl))
    .filter((value): value is string => Boolean(value));
}

function extractPreviewUrlsFromText(html: string) {
  const matches = html.match(/https?:\\?\/\\?\/[^"'<>\\\s]+?\/mp3-preview\/[^"'<>\\\s]+/gi) ?? [];
  return matches.map((match) => match.replaceAll("\\/", "/").replaceAll("\\u002F", "/"));
}

function normalizePreviewUrl(value: string, pageUrl: URL) {
  const decodedValue = decodeEmbeddedUrl(value);
  const previewUrl = absoluteUrl(decodedValue, pageUrl);

  return previewUrl && isSpotifyPreviewUrl(previewUrl) ? previewUrl : undefined;
}

function decodeEmbeddedUrl(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replaceAll("\\/", "/").replaceAll("\\u002F", "/");
  }
}

function isSpotifyMediaOption(option: ProviderDownloadOption) {
  return option.mode === "audio" && isSpotifyPreviewUrl(option.media.url);
}

function isSpotifyPreviewUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "p.scdn.co" && url.pathname.includes(SPOTIFY_PREVIEW_PATH);
  } catch {
    return false;
  }
}

function isItunesPreviewUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname.endsWith("itunes.apple.com") || hostname.endsWith("mzstatic.com") || hostname.endsWith("apple.com");
  } catch {
    return false;
  }
}

function spotifyMediaHeaders(referer: string) {
  return {
    accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
    referer,
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };
}

function spotifyPageHeaders() {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    referer: "https://open.spotify.com/",
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };
}

function spotmateHeaders() {
  return {
    accept: "application/json",
    origin: SPOTMATE_BASE_URL,
    referer: SPOTMATE_PAGE_URL,
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };
}

function spotmateDownloadHeaders() {
  return {
    accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
    referer: SPOTMATE_PAGE_URL,
    "user-agent": DESKTOP_BROWSER_USER_AGENT
  };
}

async function fetchSpotifyOembed(url: URL) {
  // ref: https://developer.spotify.com/documentation/embeds/reference/oembed
  return fetchJson<SpotifyOembed>(`https://open.spotify.com/oembed?url=${encodeURIComponent(url.href)}`, {
    headers: {
      accept: "application/json"
    }
  });
}

function spotifySearchTerm(title: string, author?: string) {
  const cleanTitle = title
    .replace(/\s*-\s*song and lyrics by.*$/i, "")
    .replace(/\s*\|\s*Spotify\s*$/i, "")
    .trim();
  const cleanAuthor = author?.replace(/^@/, "").trim();
  const term = [cleanTitle, cleanAuthor].filter(Boolean).join(" ");

  return term === "Spotify media" ? "" : term;
}

function bestItunesPreviewMatch(results: ItunesTrackResult[], title: string, author?: string) {
  const candidates = results.filter((result) => typeof result.previewUrl === "string" && result.previewUrl.trim());

  if (candidates.length === 0) {
    return undefined;
  }

  const normalizedTitle = normalizeMatchText(title);
  const normalizedAuthor = normalizeMatchText(author ?? "");
  const exactMatch = candidates.find((result) => {
    const resultTitle = normalizeMatchText(result.trackName ?? "");
    const resultArtist = normalizeMatchText(result.artistName ?? "");

    return resultTitle === normalizedTitle && (!normalizedAuthor || resultArtist === normalizedAuthor);
  });

  if (exactMatch) {
    return exactMatch;
  }

  return candidates.find((result) => {
    const resultTitle = normalizeMatchText(result.trackName ?? "");
    const resultArtist = normalizeMatchText(result.artistName ?? "");

    return resultTitle.includes(normalizedTitle) && (!normalizedAuthor || resultArtist.includes(normalizedAuthor));
  }) ?? candidates[0];
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s*\|\s*spotify\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchSpotmateTrackData(url: URL) {
  const session = await createSpotmateSession();
  const data = await spotmateJson<SpotmateTrackData>("/getTrackData", session, {
    spotify_url: url.href
  });

  return data.type === "track" ? data : undefined;
}

async function resolveSpotmateTrack(
  source: ProviderExtractResult,
  option: ProviderDownloadOption,
  context: ProviderContext,
  settings: ProcessingSettings
): Promise<ResolvedMedia> {
  const session = await createSpotmateSession();
  const conversion = await spotmateJson<SpotmateConvertResponse>("/convert", session, {
    urls: spotmateTrackUrl(source)
  });
  const downloadLink = conversion.error === false && conversion.url
    ? conversion.url
    : await waitForSpotmateDownload(conversion.task_id ?? conversion.taskId, context.signal);

  if (!downloadLink) {
    throw new CoCatError("PROVIDER_FAILED", spotmateErrorMessage(conversion.message ?? conversion.status));
  }

  return {
    transport: "direct",
    url: downloadLink,
    headers: spotmateDownloadHeaders(),
    fileName: buildFileName(safeFileName(source.title), "mp3"),
    extension: "mp3",
    mode: option.mode,
    mimeType: "audio/mpeg",
    durationSeconds: source.durationSeconds,
    requiresFfmpeg: false,
    settings
  };
}

async function waitForSpotmateDownload(taskId: string | undefined, signal?: AbortSignal) {
  if (!taskId) {
    return undefined;
  }

  for (let attempt = 0; attempt < SPOTMATE_MAX_STATUS_ATTEMPTS; attempt += 1) {
    await delay(SPOTMATE_POLL_INTERVAL_MS, signal);
    throwIfAborted(signal);

    const status = await fetchJson<SpotmateTaskResponse>(
      `${SPOTMATE_TASKS_BASE_URL}/${encodeURIComponent(taskId)}`,
      { headers: spotmateHeaders() }
    );
    const info = status.data ?? {};
    const state = String(info.status ?? info.state ?? "").toLowerCase();
    const downloadLink = extractDownloadUrl(info) ?? extractDownloadUrl(info.result) ?? extractDownloadUrl(status);

    if (state === "finished" && downloadLink) {
      return downloadLink;
    }

    if (status.error || ["failed", "error", "expired", "cancelled"].includes(state)) {
      throw new CoCatError("PROVIDER_FAILED", spotmateErrorMessage(info.message ?? info.error ?? status.message));
    }
  }

  throw new CoCatError("UPSTREAM_TIMEOUT", "Spotmate did not finish preparing the track in time.");
}

async function createSpotmateSession(): Promise<SpotmateSession> {
  const response = await safeFetch(SPOTMATE_PAGE_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": DESKTOP_BROWSER_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `Spotmate returned HTTP ${response.status}.`);
  }

  const html = await readResponseText(response);
  const csrfToken = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)/i)?.[1];

  if (!csrfToken) {
    throw new CoCatError("PROVIDER_FAILED", "Spotmate did not return a CSRF token.");
  }

  return {
    csrfToken,
    cookie: cookieHeaderFrom(response.headers)
  };
}

async function spotmateJson<T>(path: string, session: SpotmateSession, body: unknown) {
  const response = await safeFetch(`${SPOTMATE_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...spotmateHeaders(),
      "content-type": "application/json",
      "x-csrf-token": session.csrfToken,
      ...(session.cookie ? { cookie: session.cookie } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `Spotmate returned HTTP ${response.status}.`);
  }

  const text = await readResponseText(response);

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new CoCatError("PROVIDER_FAILED", "Spotmate returned invalid JSON.", error);
  }
}

function cookieHeaderFrom(headers: Headers) {
  const setCookies = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const cookies = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookies.join("; ");
}

function spotmateTrackUrl(source: ProviderExtractResult) {
  const debugTrackUrl = typeof source.debug?.spotmateTrackUrl === "string" ? source.debug.spotmateTrackUrl : undefined;
  return debugTrackUrl || source.sourceUrl;
}

function spotmateArtists(track?: SpotmateTrackData) {
  const names = track?.artists?.map((artist) => artist.name).filter(Boolean);
  return names && names.length > 0 ? names.join(", ") : undefined;
}

function isSpotmateOption(option: ProviderDownloadOption) {
  return option.id.startsWith("spotify:spotmate:");
}

function extractDownloadUrl(payload: unknown) {
  if (typeof payload !== "object" || payload == null) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.url, record.download_url, record.downloadLink];
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);
}

function millisecondsToSeconds(value?: number) {
  return Number.isFinite(value) && value != null ? Math.round(value / 1000) : undefined;
}

function spotmateErrorMessage(error?: string) {
  if (!error) {
    return "Spotmate could not prepare that Spotify track.";
  }

  if (/rate|limit|premium|support/i.test(error)) {
    return "Spotmate limited this conversion request.";
  }

  return "Spotmate reported an upstream converter error while preparing that track.";
}

function spotifyUnsupportedMessage(isSpotmateEnabled: boolean) {
  if (isSpotmateEnabled) {
    return "Spotify did not expose a public preview, no matched Apple preview was found, and the optional Spotify converter could not prepare this URL.";
  }

  return "Spotify did not expose a public preview and no matched Apple preview was found. Enable COCAT_ENABLE_SPOTMATE=true on your CoCat server to try the optional Spotify converter.";
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

function cleanSpotifyTitle(title: string) {
  return title.replace(/\s*\|\s*Spotify\s*$/i, "").trim() || "Spotify media";
}

type SpotifyOembed = {
  title?: string;
  thumbnail_url?: string;
};

type ItunesSearchResponse = {
  results?: ItunesTrackResult[];
};

type ItunesTrackResult = {
  artistName?: string;
  previewUrl?: string;
  trackId?: number;
  trackName?: string;
  trackViewUrl?: string;
};

type SpotmateSession = {
  csrfToken: string;
  cookie?: string;
};

type SpotmateTrackData = {
  type?: string;
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: {
    images?: Array<{ url?: string }>;
  };
  external_urls?: {
    spotify?: string;
  };
};

type SpotmateConvertResponse = {
  error?: boolean;
  url?: string;
  task_id?: string;
  taskId?: string;
  status?: string;
  message?: string;
};

type SpotmateTaskResponse = {
  error?: boolean;
  message?: string;
  data?: {
    status?: string;
    state?: string;
    message?: string;
    error?: string;
    url?: string;
    download_url?: string;
    downloadLink?: string;
    result?: unknown;
  };
  url?: string;
  download_url?: string;
  downloadLink?: string;
};
