import { describe, expect, it } from "vitest";

import { DEFAULT_PROCESSING_SETTINGS } from "@/lib/contracts";
import { parseDuration, parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { extensionFromMime, inferMode } from "@/lib/server/providers/media-utils";
import { providerIds, toPublicExtractResult } from "@/lib/server/providers";
import { sizeFromHeaders } from "@/lib/server/providers/direct";
import { optionNeedsFfmpeg, resolveOption } from "@/lib/server/providers/shared";
import type { ProviderExtractResult } from "@/lib/server/providers/types";
import { testCapabilities, testSettingConstraints } from "@/tests/provider-fixtures";
import { isResolvableYoutubeFormat } from "@/lib/server/providers/youtube";

describe("providers", () => {
  it("registers the planned provider IDs", () => {
    expect(providerIds()).toEqual([
      "youtube",
      "tiktok",
      "instagram",
      "x",
      "reddit",
      "spotify",
      "soundcloud",
      "vimeo",
      "pinterest",
      "facebook",
      "threads",
      "bluesky",
      "tumblr",
      "dailymotion",
      "streamable",
      "imgur",
      "twitch",
      "kick",
      "rumble",
      "flickr",
      "mastodon",
      "pixelfed",
      "direct"
    ]);
  });

  it("extracts public metadata and media candidates from HTML", () => {
    const metadata = parseHtmlMetadata(
      `
        <html>
          <head>
            <meta property="og:title" content="Launch Clip" />
            <meta property="og:image" content="/thumb.jpg" />
            <meta property="og:video" content="https://cdn.example.test/clip.mp4" />
            <meta property="og:video:type" content="video/mp4" />
          </head>
          <body></body>
        </html>
      `,
      new URL("https://example.test/watch/1"),
      "vimeo"
    );

    expect(metadata.title).toBe("Launch Clip");
    expect(metadata.thumbnailUrl).toBe("https://example.test/thumb.jpg");
    expect(metadata.options[0]).toMatchObject({
      mode: "video",
      extension: "mp4"
    });
  });

  it("extracts duration from common metadata formats", () => {
    const metadata = parseHtmlMetadata(
      `
        <html>
          <head>
            <meta property="og:title" content="Duration Clip" />
            <meta property="og:video" content="https://cdn.example.test/clip.mp4" />
            <script type="application/ld+json">
              { "@type": "VideoObject", "duration": "PT1M5S" }
            </script>
          </head>
        </html>
      `,
      new URL("https://example.test/watch/1"),
      "vimeo"
    );

    expect(metadata.durationSeconds).toBe(65);
    expect(parseDuration("01:02:03")).toBe(3723);
    expect(parseDuration("PT2M10S")).toBe(130);
  });

  it("removes private media references from public extract responses", () => {
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
            url: "https://signed.example.com/private.mp4"
          }
        }
      ]
    };

    expect(toPublicExtractResult(source, "token").options[0]).not.toHaveProperty("media");
  });

  it("normalizes common media types", () => {
    expect(extensionFromMime("audio/mpeg; charset=utf-8")).toBe("mp3");
    expect(inferMode("image/gif", "gif")).toBe("gif");
  });

  it("reads direct media size from range and length headers", () => {
    expect(sizeFromHeaders(new Headers({ "content-range": "bytes 0-0/1048576", "content-length": "1" }))).toBe(1048576);
    expect(sizeFromHeaders(new Headers({ "content-length": "2048" }))).toBe(2048);
    expect(sizeFromHeaders(new Headers())).toBeUndefined();
  });

  it("does not treat YouTube adaptive metadata-only formats as resolvable", () => {
    expect(isResolvableYoutubeFormat({})).toBe(false);
    expect(isResolvableYoutubeFormat({ signature_cipher: "s=abc&url=https%3A%2F%2Fexample.test" })).toBe(true);
  });

  it("marks requested audio format conversion as ffmpeg work", async () => {
    const source: ProviderExtractResult = {
      providerId: "direct",
      sourceUrl: "https://example.com/audio.m4a",
      title: "Audio",
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      options: [
        {
          id: "direct:m4a",
          label: "Original audio",
          mode: "audio",
          extension: "m4a",
          mimeType: "audio/mp4",
          media: {
            transport: "direct",
            url: "https://example.com/audio.m4a",
            mimeType: "audio/mp4"
          }
        }
      ]
    };

    const settings = { ...DEFAULT_PROCESSING_SETTINGS, audioFormat: "mp3" as const };
    const resolved = await resolveOption(source, "direct:m4a", undefined, settings);

    expect(optionNeedsFfmpeg(source.options[0], settings)).toBe(true);
    expect(resolved).toMatchObject({
      extension: "mp3",
      mimeType: "audio/mpeg",
      requiresFfmpeg: true
    });
  });
});
