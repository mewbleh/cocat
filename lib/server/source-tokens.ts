import crypto from "node:crypto";

import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";
import type { ProviderExtractResult } from "@/lib/server/providers/types";

const TOKEN_VERSION = "v1";
const SOURCE_CLEANUP_INTERVAL_MS = 60_000;
const SOURCE_STATE_KEY = "__cocatSourceTokenState";

type SourceStoreEntry = {
  expiresAt: number;
  source: ProviderExtractResult;
};

type SourceTokenState = {
  cleanupTimer: NodeJS.Timeout | null;
  store: Map<string, SourceStoreEntry>;
};

const sourceTokenState = getSourceTokenState();

export function createSourceToken(source: ProviderExtractResult) {
  const config = getServerConfig();
  const sourceId = crypto.randomUUID();
  const expiresAt = Date.now() + config.sourceTtlSeconds * 1000;
  const signature = signTokenParts(sourceId, expiresAt, config.tokenSecret);

  removeExpiredSourceTokens();
  evictOldestSourceTokens(config.maxSourceTokens - 1);
  sourceTokenState.store.set(sourceId, { source, expiresAt });
  ensureSourceCleanup();

  return `${TOKEN_VERSION}.${sourceId}.${expiresAt}.${signature}`;
}

export function verifySourceToken(sourceToken: string) {
  const config = getServerConfig();
  const [version, sourceId, expiresAtValue, signature] = sourceToken.split(".");
  const expiresAt = Number(expiresAtValue);

  if (version !== TOKEN_VERSION || !sourceId || !Number.isFinite(expiresAt) || !signature) {
    throw new CoCatError("BAD_REQUEST", "The source token is invalid.");
  }

  const expectedSignature = signTokenParts(sourceId, expiresAt, config.tokenSecret);

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new CoCatError("BAD_REQUEST", "The source token signature is invalid.");
  }

  if (Date.now() > expiresAt) {
    sourceTokenState.store.delete(sourceId);
    throw new CoCatError("TOKEN_EXPIRED", "That download session expired.");
  }

  const entry = sourceTokenState.store.get(sourceId);

  if (!entry) {
    throw new CoCatError("TOKEN_EXPIRED", "That download session expired.");
  }

  return entry.source;
}

export function clearSourceStoreForTests() {
  sourceTokenState.store.clear();
}

function signTokenParts(sourceId: string, expiresAt: number, secret: string) {
  return crypto.createHmac("sha256", secret).update(`${TOKEN_VERSION}.${sourceId}.${expiresAt}`).digest("base64url");
}

function removeExpiredSourceTokens(now = Date.now()) {
  for (const [sourceId, entry] of sourceTokenState.store.entries()) {
    if (entry.expiresAt <= now) {
      sourceTokenState.store.delete(sourceId);
    }
  }
}

function evictOldestSourceTokens(maxEntries: number) {
  while (sourceTokenState.store.size > maxEntries) {
    const oldestSourceId = sourceTokenState.store.keys().next().value as string | undefined;

    if (!oldestSourceId) {
      return;
    }

    sourceTokenState.store.delete(oldestSourceId);
  }
}

function ensureSourceCleanup() {
  if (sourceTokenState.cleanupTimer) {
    return;
  }

  sourceTokenState.cleanupTimer = setInterval(() => {
    removeExpiredSourceTokens();

    if (sourceTokenState.store.size === 0 && sourceTokenState.cleanupTimer) {
      clearInterval(sourceTokenState.cleanupTimer);
      sourceTokenState.cleanupTimer = null;
    }
  }, SOURCE_CLEANUP_INTERVAL_MS);

  sourceTokenState.cleanupTimer.unref?.();
}

function getSourceTokenState() {
  const globalStore = globalThis as typeof globalThis & {
    [SOURCE_STATE_KEY]?: SourceTokenState;
  };

  globalStore[SOURCE_STATE_KEY] ??= {
    cleanupTimer: null,
    store: new Map<string, SourceStoreEntry>()
  };

  return globalStore[SOURCE_STATE_KEY];
}
