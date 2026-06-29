import http from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import crypto from "node:crypto";

import { CoCatError } from "@/lib/server/errors";
import { readResponseText, safeFetch } from "@/lib/server/http";
import { extensionFromUrl } from "@/lib/server/providers/media-utils";
import type { MediaTransport } from "@/lib/server/providers/types";

export type ProxyTarget = {
  headers?: Record<string, string>;
  transport?: MediaTransport;
  url: string;
};

type FfmpegInputProxy = {
  close(): Promise<void>;
  diagnostics(): string[];
  proxyUrl(target: ProxyTarget): string;
};

type ManifestProxyUrl = (url: string, transport?: MediaTransport) => string;

const HLS_MIME_TYPES = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"];
const DASH_MIME_TYPES = ["application/dash+xml"];
const REWRITABLE_DASH_ATTRIBUTES = ["media", "initialization", "sourceURL"];
const MAX_REWRITTEN_MANIFEST_BYTES = 5 * 1024 * 1024;

export async function createFfmpegInputProxy(): Promise<FfmpegInputProxy> {
  const targets = new Map<string, ProxyTarget>();
  const diagnostics: string[] = [];
  let baseUrl = "";

  const server = http.createServer(async (request, response) => {
    const targetId = targetIdFromRequest(request);
    const target = targets.get(targetId);

    if (!target) {
      appendDiagnostic(diagnostics, `Proxy target ${targetId || "(missing)"} was not registered.`);
      response.writeHead(404).end();
      return;
    }

    try {
      await serveProxyTarget(
        request,
        response,
        target,
        (nextTarget) => registerTarget(targets, baseUrl, nextTarget),
        (message) => appendDiagnostic(diagnostics, message)
      );
    } catch (error) {
      const status = error instanceof CoCatError && error.code === "UNSUPPORTED_MEDIA" ? 422 : 502;
      appendDiagnostic(diagnostics, error instanceof Error ? error.message : "CoCat could not proxy that media input.");
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(
        error instanceof Error ? error.message : "CoCat could not proxy that media input."
      );
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new CoCatError("PROVIDER_FAILED", "CoCat could not start the ffmpeg input proxy.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    diagnostics() {
      return [...diagnostics];
    },
    proxyUrl(target) {
      return registerTarget(targets, baseUrl, target);
    }
  };
}

async function serveProxyTarget(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  target: ProxyTarget,
  proxyUrl: (target: ProxyTarget) => string,
  recordDiagnostic: (message: string) => void
) {
  const upstream = await safeFetch(target.url, {
    headers: headersForProxyTarget(target, request.headers.range)
  });

  if (!upstream.ok || !upstream.body) {
    recordDiagnostic(`Upstream returned HTTP ${upstream.status} for ${redactedUrl(target.url)}.`);
    response.writeHead(upstream.status).end();
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  if (isHlsManifest(target, contentType)) {
    const manifest = await boundedText(upstream);
    const rewrittenManifest = rewriteHlsManifest(manifest, target.url, (url, transport) => proxyUrl({
      headers: target.headers,
      transport: transport ?? hlsTransportFromUrl(url),
      url
    }));

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/vnd.apple.mpegurl; charset=utf-8"
    }).end(rewrittenManifest);
    return;
  }

  if (isDashManifest(target, contentType)) {
    const manifest = await boundedText(upstream);
    const rewrittenManifest = rewriteDashManifest(manifest, target.url, (url) => proxyUrl({
      headers: target.headers,
      transport: extensionFromUrl(url) === "mpd" ? "dash" : "direct",
      url
    }));

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/dash+xml; charset=utf-8"
    }).end(rewrittenManifest);
    return;
  }

  response.writeHead(upstream.status, copyProxyHeaders(upstream.headers));
  Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>).pipe(response);
}

export function rewriteHlsManifest(manifest: string, manifestUrl: string, proxyUrl: ManifestProxyUrl) {
  let nextUriTransport: MediaTransport | undefined;

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return line;
      }

      if (trimmedLine.startsWith("#")) {
        const rewrittenLine = line.replace(/\bURI=(["'])([^"']+)\1/gi, (_match, quote: string, rawUrl: string) => {
          const resolvedUrl = resolveManifestUrl(rawUrl, manifestUrl);
          return `URI=${quote}${proxyUrl(resolvedUrl, hlsAttributeTransport(trimmedLine, resolvedUrl))}${quote}`;
        });

        if (/^#EXT-X-STREAM-INF\b/i.test(trimmedLine)) {
          nextUriTransport = "hls";
        }

        return rewrittenLine;
      }

      const resolvedUrl = resolveManifestUrl(trimmedLine, manifestUrl);
      const transport = nextUriTransport ?? hlsTransportFromUrl(resolvedUrl);
      nextUriTransport = undefined;

      return proxyUrl(resolvedUrl, transport);
    })
    .join("\n");
}

export function rewriteDashManifest(manifest: string, manifestUrl: string, proxyUrl: (url: string) => string) {
  if (/\$[A-Za-z]+\$/u.test(manifest)) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "DASH templates are not supported by the safe ffmpeg proxy yet.");
  }

  let rewritten = manifest.replace(/(<BaseURL[^>]*>)([^<]+)(<\/BaseURL>)/gi, (_match, open: string, rawUrl: string, close: string) => {
    return `${open}${escapeXmlText(proxyUrl(resolveManifestUrl(rawUrl.trim(), manifestUrl)))}${close}`;
  });

  for (const attribute of REWRITABLE_DASH_ATTRIBUTES) {
    rewritten = rewritten.replace(
      new RegExp(`\\b${attribute}="([^"]+)"`, "gi"),
      (_match, rawUrl: string) => `${attribute}="${escapeXmlAttribute(proxyUrl(resolveManifestUrl(rawUrl, manifestUrl)))}"`
    );
  }

  return rewritten;
}

function registerTarget(targets: Map<string, ProxyTarget>, baseUrl: string, target: ProxyTarget) {
  const id = crypto.randomUUID();
  targets.set(id, target);
  return `${baseUrl}/${id}/${encodeURIComponent(fileHint(target.url))}`;
}

function targetIdFromRequest(request: http.IncomingMessage) {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

export function headersForProxyTarget(target: ProxyTarget, requestRange?: string | string[]) {
  const headers = withoutHeader(target.headers, "range");

  if (!isManifestTarget(target) && typeof requestRange === "string") {
    headers.range = requestRange;
  }

  return headers;
}

function copyProxyHeaders(headers: Headers) {
  const outputHeaders: Record<string, string> = {
    "cache-control": "no-store"
  };

  for (const header of ["accept-ranges", "content-length", "content-range", "content-type"]) {
    const value = headers.get(header);

    if (value) {
      outputHeaders[header] = value;
    }
  }

  return outputHeaders;
}

async function boundedText(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_REWRITTEN_MANIFEST_BYTES) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "That manifest is too large to proxy safely.");
  }

  const text = await readResponseText(response, { maxBytes: MAX_REWRITTEN_MANIFEST_BYTES });

  if (Buffer.byteLength(text) > MAX_REWRITTEN_MANIFEST_BYTES) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "That manifest is too large to proxy safely.");
  }

  return text;
}

function isHlsManifest(target: ProxyTarget, contentType: string) {
  return target.transport === "hls" || extensionFromUrl(target.url) === "m3u8" || hasAnyMimeType(contentType, HLS_MIME_TYPES);
}

function isManifestTarget(target: ProxyTarget) {
  return target.transport === "hls" || target.transport === "dash" || extensionFromUrl(target.url) === "m3u8" || extensionFromUrl(target.url) === "mpd";
}

function hlsAttributeTransport(tagLine: string, url: string): MediaTransport {
  if (/^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF)\b/i.test(tagLine)) {
    return "hls";
  }

  return hlsTransportFromUrl(url);
}

function hlsTransportFromUrl(url: string): MediaTransport {
  return extensionFromUrl(url) === "m3u8" ? "hls" : "direct";
}

function isDashManifest(target: ProxyTarget, contentType: string) {
  return target.transport === "dash" || extensionFromUrl(target.url) === "mpd" || hasAnyMimeType(contentType, DASH_MIME_TYPES);
}

function hasAnyMimeType(contentType: string, mimeTypes: string[]) {
  const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase();
  return Boolean(normalizedContentType && mimeTypes.includes(normalizedContentType));
}

function resolveManifestUrl(rawUrl: string, manifestUrl: string) {
  try {
    return new URL(rawUrl, manifestUrl).href;
  } catch (error) {
    throw new CoCatError("INVALID_URL", "The manifest contains an invalid media URL.", error);
  }
}

function fileHint(input: string) {
  try {
    const pathname = new URL(input).pathname;
    return pathname.split("/").filter(Boolean).at(-1) ?? "media";
  } catch {
    return "media";
  }
}

function escapeXmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;");
}

function escapeXmlText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function withoutHeader(headers: Record<string, string> | undefined, headerName: string) {
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      output[key] = value;
    }
  }

  return output;
}

function appendDiagnostic(diagnostics: string[], message: string) {
  diagnostics.push(message);

  if (diagnostics.length > 8) {
    diagnostics.splice(0, diagnostics.length - 8);
  }
}

function redactedUrl(input: string) {
  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return input.split("?")[0] ?? input;
  }
}
