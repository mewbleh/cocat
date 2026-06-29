import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";
import { resolvePublicUrl, type PublicUrlResolution } from "@/lib/server/url-safety";
import { Agent, type Dispatcher } from "undici";

const DEFAULT_HEADERS = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "user-agent": "CoCat/1.0 (+https://github.com/mewbleh/cocat)"
};

const MAX_REDIRECTS = 5;

export type SafeFetchOptions = RequestInit & {
  timeoutMs?: number;
};

export async function safeFetch(input: string, options: SafeFetchOptions = {}) {
  const config = getServerConfig();
  let current = await resolvePublicUrl(input);
  const { timeoutMs = config.requestTimeoutMs, signal: upstreamSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = combineAbortSignals(controller.signal, upstreamSignal);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(current.url, {
        ...fetchOptions,
        dispatcher: pinnedDispatcher(current, timeoutMs),
        redirect: "manual",
        signal,
        headers: {
          ...DEFAULT_HEADERS,
          ...fetchOptions.headers
        }
      } as RequestInit & { dispatcher: Dispatcher });

      if (!isRedirect(response.status)) {
        return response;
      }

      const location = response.headers.get("location");

      if (!location) {
        throw new CoCatError("PROVIDER_FAILED", "The upstream site redirected without a location header.");
      }

      current = await resolvePublicUrl(new URL(location, current.url).href);
    }
  } catch (error) {
    if (error instanceof CoCatError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (upstreamSignal?.aborted && !controller.signal.aborted) {
        throw new CoCatError("CANCELLED", "The upstream request was cancelled.", error);
      }

      throw new CoCatError("UPSTREAM_TIMEOUT", "The upstream site took too long to respond.", error);
    }

    throw new CoCatError("PROVIDER_FAILED", "The upstream request failed.", error);
  } finally {
    clearTimeout(timeout);
  }

  throw new CoCatError("PROVIDER_FAILED", "The upstream site redirected too many times.");
}

export async function fetchText(input: string, options: SafeFetchOptions = {}) {
  const response = await safeFetch(input, options);

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `The upstream site returned HTTP ${response.status}.`);
  }

  return readResponseText(response, { timeoutMs: options.timeoutMs });
}

export async function fetchJson<T>(input: string, options: SafeFetchOptions = {}) {
  const response = await safeFetch(input, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new CoCatError("PROVIDER_FAILED", `The upstream API returned HTTP ${response.status}.`);
  }

  const text = await readResponseText(response, { timeoutMs: options.timeoutMs });

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new CoCatError("PROVIDER_FAILED", "The upstream API returned invalid JSON.", error);
  }
}

export async function fetchHeadOrRange(input: string, options: SafeFetchOptions = {}) {
  const headResponse = await safeFetch(input, { ...options, method: "HEAD" });

  if (headResponse.ok) {
    return headResponse;
  }

  return safeFetch(input, {
    ...options,
    method: "GET",
    headers: {
      ...options.headers,
      range: "bytes=0-0"
    }
  });
}

function isRedirect(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function readResponseText(
  response: Response,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
  } = {}
) {
  if (!response.body) {
    return "";
  }

  const config = getServerConfig();
  const maxBytes = options.maxBytes ?? config.maxUpstreamBodyBytes;
  const timeoutMs = options.timeoutMs ?? config.requestTimeoutMs;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    void reader.cancel().catch(() => undefined);
  }, timeoutMs);

  try {
    let text = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytesRead += value.byteLength;

      if (bytesRead > maxBytes) {
        throw new CoCatError("PAYLOAD_TOO_LARGE", "The upstream response body is too large.");
      }

      text += decoder.decode(value, { stream: true });
    }

    if (didTimeout) {
      throw new CoCatError("UPSTREAM_TIMEOUT", "The upstream site took too long to send a response body.");
    }

    return text + decoder.decode();
  } catch (error) {
    if (didTimeout) {
      throw new CoCatError("UPSTREAM_TIMEOUT", "The upstream site took too long to send a response body.", error);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

function combineAbortSignals(timeoutSignal: AbortSignal, upstreamSignal?: AbortSignal | null) {
  if (!upstreamSignal) {
    return timeoutSignal;
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeoutSignal, upstreamSignal]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  timeoutSignal.addEventListener("abort", abort, { once: true });
  upstreamSignal.addEventListener("abort", abort, { once: true });

  return controller.signal;
}

function pinnedDispatcher({ address, family }: PublicUrlResolution, timeoutMs: number) {
  return new Agent({
    connectTimeout: timeoutMs,
    keepAliveMaxTimeout: 1,
    keepAliveTimeout: 1,
    pipelining: 0,
    connect: {
      lookup(_hostname, _options, callback) {
        if (_options.all) {
          callback(null, [{ address, family }]);
          return;
        }

        callback(null, address, family);
      }
    }
  });
}
