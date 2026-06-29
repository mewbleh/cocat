import http from "node:http";
import { once } from "node:events";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import crypto from "node:crypto";

import { CoCatError } from "@/lib/server/errors";
import { readResponseText, safeFetch } from "@/lib/server/http";
import { extensionFromUrl } from "@/lib/server/providers/media-utils";
import type { MediaTransport } from "@/lib/server/providers/types";

type ProxyTarget = {
  headers?: Record<string, string>;
  transport?: MediaTransport;
  url: string;
};

type FfmpegInputProxy = {
  close(): Promise<void>;
  proxyUrl(target: ProxyTarget): string;
};

const HLS_MIME_TYPES = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"];
const DASH_MIME_TYPES = ["application/dash+xml"];
const REWRITABLE_DASH_ATTRIBUTES = ["media", "initialization", "sourceURL"];
const MAX_REWRITTEN_MANIFEST_BYTES = 5 * 1024 * 1024;

export async function createFfmpegInputProxy(): Promise<FfmpegInputProxy> {
  const targets = new Map<string, ProxyTarget>();
  let baseUrl = "";

  const server = http.createServer(async (request, response) => {
    const target = targets.get(targetIdFromRequest(request));

    if (!target) {
      response.writeHead(404).end();
      return;
    }

    try {
      await serveProxyTarget(request, response, target, (nextTarget) => registerTarget(targets, baseUrl, nextTarget));
    } catch (error) {
      const status = error instanceof CoCatError && error.code === "UNSUPPORTED_MEDIA" ? 422 : 502;
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
    proxyUrl(target) {
      return registerTarget(targets, baseUrl, target);
    }
  };
}

async function serveProxyTarget(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  target: ProxyTarget,
  proxyUrl: (target: ProxyTarget) => string
) {
  const upstream = await safeFetch(target.url, {
    headers: {
      ...target.headers,
      ...rangeHeader(request)
    }
  });

  if (!upstream.ok || !upstream.body) {
    response.writeHead(upstream.status).end();
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  if (isHlsManifest(target, contentType)) {
    const manifest = await boundedText(upstream);
    const rewrittenManifest = rewriteHlsManifest(manifest, target.url, (url) => proxyUrl({
      headers: target.headers,
      transport: extensionFromUrl(url) === "m3u8" ? "hls" : "direct",
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

export function rewriteHlsManifest(manifest: string, manifestUrl: string, proxyUrl: (url: string) => string) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return line;
      }

      if (trimmedLine.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, rawUrl: string) => `URI="${proxyUrl(resolveManifestUrl(rawUrl, manifestUrl))}"`);
      }

      return proxyUrl(resolveManifestUrl(trimmedLine, manifestUrl));
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

function rangeHeader(request: http.IncomingMessage): Record<string, string> {
  return typeof request.headers.range === "string" ? { range: request.headers.range } : {};
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
