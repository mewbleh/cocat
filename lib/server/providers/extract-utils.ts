import { DEFAULT_SETTING_CONSTRAINTS, capabilitiesFromOptions, rankRecommendedOption } from "@/lib/server/providers/shared";
import {
  codecsFromMime,
  containerFromMime,
  extensionFromMime,
  extensionFromUrl,
  inferMode,
  mediaTransportFrom,
  qualityFromDimensions
} from "@/lib/server/providers/media-utils";
import type { MediaMode, ProviderCapabilities, ProviderId } from "@/lib/contracts";
import type { ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";

type MediaOptionInput = {
  providerId: ProviderId;
  id: string;
  url: string;
  label?: string;
  mode?: MediaMode;
  mimeType?: string;
  extension?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  sizeBytes?: number;
  quality?: string;
  headers?: Record<string, string>;
  fallbackHeaders?: Array<Record<string, string>>;
  transport?: "direct" | "hls" | "dash";
  requiresFfmpeg?: boolean;
};

type SourceInput = {
  providerId: ProviderId;
  sourceUrl: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  options: ProviderDownloadOption[];
  capabilities?: Partial<ProviderCapabilities>;
  debug?: Record<string, string | number | boolean | null>;
};

export function createMediaOption(input: MediaOptionInput): ProviderDownloadOption | undefined {
  const extension = input.extension ?? extensionFromMime(input.mimeType) ?? extensionFromUrl(input.url);
  const transport = input.transport ?? mediaTransportFrom(extension, input.mimeType);
  const mode = input.mode ?? inferMode(input.mimeType, extension) ?? (transport === "hls" || transport === "dash" ? "video" : undefined);

  if (!mode || !extension && transport === "direct") {
    return undefined;
  }

  const outputExtension = transport === "hls" || transport === "dash" ? "mp4" : extension ?? "mp4";
  const quality = input.quality ?? qualityFromDimensions(input.width, input.height);

  return {
    id: input.id,
    label: input.label ?? defaultLabel(mode, quality, outputExtension),
    mode,
    extension: outputExtension,
    container: containerFromMime(input.mimeType),
    quality,
    mimeType: input.mimeType,
    codecs: codecsFromMime(input.mimeType),
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    fps: input.fps,
    bitrateKbps: input.bitrateKbps,
    hasAudio: mode === "audio" || mode === "video",
    hasVideo: mode === "video" || mode === "gif",
    isAdaptive: transport === "hls" || transport === "dash" || input.requiresFfmpeg,
    requiresFfmpeg: input.requiresFfmpeg ?? transport !== "direct",
    transport,
    media: {
      transport,
      url: input.url,
      headers: input.headers,
      fallbackHeaders: input.fallbackHeaders,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes
    }
  };
}

export function createSourceResult(input: SourceInput): ProviderExtractResult {
  const capabilities = {
    ...capabilitiesFromOptions({ options: input.options, thumbnailUrl: input.thumbnailUrl }),
    ...input.capabilities
  };

  return {
    providerId: input.providerId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    author: input.author,
    thumbnailUrl: input.thumbnailUrl,
    durationSeconds: input.durationSeconds,
    options: dedupeOptions(input.options),
    capabilities,
    settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
    debug: input.debug,
    recommendedOptionId: rankRecommendedOption(input.options)
  };
}

export function absoluteUrl(rawUrl: string | undefined | null, baseUrl: string | URL) {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl, baseUrl).href;
  } catch {
    return undefined;
  }
}

export function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

export function collectStringValuesByKey(input: unknown, keys: string[]) {
  const values = new Set<string>();
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));

  walkJson(input, (key, value) => {
    if (normalizedKeys.has(key.toLowerCase()) && typeof value === "string" && value.trim()) {
      values.add(value.trim());
    }
  });

  return [...values];
}

export function findFirstStringByKey(input: unknown, keys: string[]) {
  const values = collectStringValuesByKey(input, keys);
  return values[0];
}

export function parseJsonScript(html: string, id: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script[^>]+id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i"));

  if (!match?.[1]) {
    return undefined;
  }

  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
}

export function parseWindowJson(html: string, variableName: string) {
  const variableIndex = html.indexOf(variableName);

  if (variableIndex < 0) {
    return undefined;
  }

  const start = html.indexOf("[", variableIndex);
  const objectStart = html.indexOf("{", variableIndex);
  const jsonStart = start >= 0 && (objectStart < 0 || start < objectStart) ? start : objectStart;

  if (jsonStart < 0) {
    return undefined;
  }

  const jsonText = extractBalancedJson(html.slice(jsonStart));

  if (!jsonText) {
    return undefined;
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return undefined;
  }
}

function extractBalancedJson(text: string) {
  const opener = text[0];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
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
      return text.slice(0, index + 1);
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

function defaultLabel(mode: MediaMode, quality: string | undefined, extension: string) {
  return [quality, mode, extension.toUpperCase()].filter(Boolean).join(" ");
}

function dedupeOptions(options: ProviderDownloadOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    const key = `${option.mode}:${option.media.url}:${option.quality ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
