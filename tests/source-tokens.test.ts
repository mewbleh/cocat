import { afterEach, describe, expect, it, vi } from "vitest";

import { createSourceToken, clearSourceStoreForTests, verifySourceToken } from "@/lib/server/source-tokens";
import type { ProviderExtractResult } from "@/lib/server/providers/types";
import { testCapabilities, testSettingConstraints } from "@/tests/provider-fixtures";

const source: ProviderExtractResult = {
  providerId: "direct",
  sourceUrl: "https://example.com/file.mp4",
  title: "File",
  capabilities: testCapabilities,
  settingConstraints: testSettingConstraints,
  options: [
    {
      id: "direct:mp4",
      label: "Original",
      mode: "video",
      extension: "mp4",
      media: {
        transport: "direct",
        url: "https://example.com/file.mp4"
      }
    }
  ]
};

const originalMaxSourceTokens = process.env.COCAT_MAX_SOURCE_TOKENS;

describe("source tokens", () => {
  afterEach(() => {
    restoreEnv("COCAT_MAX_SOURCE_TOKENS", originalMaxSourceTokens);
    clearSourceStoreForTests();
    vi.useRealTimers();
  });

  it("round-trips a stored source without exposing it in the token", () => {
    const token = createSourceToken(source);

    expect(token).not.toContain("example.com");
    expect(verifySourceToken(token)).toEqual(source);
  });

  it("rejects tampered tokens", () => {
    const token = createSourceToken(source);
    const tamperedToken = token.replace("v1.", "v1x.");

    expect(() => verifySourceToken(tamperedToken)).toThrow("invalid");
  });

  it("keeps tokens valid across route module reloads in development", async () => {
    const previousSecret = process.env.COCAT_TOKEN_SECRET;
    delete process.env.COCAT_TOKEN_SECRET;

    try {
      vi.resetModules();
      const firstModule = await import("@/lib/server/source-tokens");
      const token = firstModule.createSourceToken(source);

      vi.resetModules();
      const secondModule = await import("@/lib/server/source-tokens");

      expect(secondModule.verifySourceToken(token)).toEqual(source);
      secondModule.clearSourceStoreForTests();
    } finally {
      if (previousSecret) {
        process.env.COCAT_TOKEN_SECRET = previousSecret;
      } else {
        delete process.env.COCAT_TOKEN_SECRET;
      }
    }
  });

  it("expires old tokens", () => {
    vi.useFakeTimers();
    const token = createSourceToken(source);

    vi.advanceTimersByTime(20 * 60 * 1000);

    expect(() => verifySourceToken(token)).toThrow("expired");
  });

  it("evicts old tokens when the in-memory source store reaches its cap", () => {
    process.env.COCAT_MAX_SOURCE_TOKENS = "1";
    const firstToken = createSourceToken(source);
    const secondToken = createSourceToken({ ...source, title: "Second file" });

    expect(() => verifySourceToken(firstToken)).toThrow("expired");
    expect(verifySourceToken(secondToken).title).toBe("Second file");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
