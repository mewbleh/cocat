import { describe, expect, it } from "vitest";

import { headersForProxyTarget, rewriteDashManifest, rewriteHlsManifest } from "@/lib/server/ffmpeg-input-proxy";
import { optionsFromDashManifest, optionsFromHlsManifest } from "@/lib/server/providers/manifests";

describe("manifest processing", () => {
  it("extracts HLS master variants", () => {
    const options = optionsFromHlsManifest(
      [
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS=\"avc1.64001f,mp4a.40.2\"",
        "720.m3u8"
      ].join("\n"),
      "https://cdn.example.test/master.m3u8",
      "direct"
    );

    expect(options[0]).toMatchObject({
      quality: "720p",
      requiresFfmpeg: true,
      media: {
        url: "https://cdn.example.test/720.m3u8"
      }
    });
  });

  it("extracts DASH representations", () => {
    const options = optionsFromDashManifest(
      `
        <MPD>
          <Period>
            <AdaptationSet mimeType="video/mp4" codecs="avc1.64001f">
              <Representation id="v1" width="1920" height="1080" bandwidth="4000000">
                <BaseURL>video-1080.mp4</BaseURL>
              </Representation>
            </AdaptationSet>
          </Period>
        </MPD>
      `,
      "https://cdn.example.test/manifest.mpd",
      "direct"
    );

    expect(options[0]).toMatchObject({
      quality: "1080p",
      transport: "dash",
      media: {
        url: "https://cdn.example.test/video-1080.mp4"
      }
    });
  });

  it("rewrites HLS child URLs through the ffmpeg input proxy", () => {
    const rewritten = rewriteHlsManifest(
      [
        "#EXTM3U",
        "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/key.bin\"",
        "#EXTINF:4,",
        "segment-1.ts"
      ].join("\n"),
      "https://cdn.example.test/path/playlist.m3u8",
      (url) => `http://127.0.0.1/proxy?url=${encodeURIComponent(url)}`
    );

    expect(rewritten).toContain("http://127.0.0.1/proxy?url=https%3A%2F%2Fcdn.example.test%2Fpath%2Fkeys%2Fkey.bin");
    expect(rewritten).toContain("http://127.0.0.1/proxy?url=https%3A%2F%2Fcdn.example.test%2Fpath%2Fsegment-1.ts");
  });

  it("treats extensionless HLS child playlists as playlists", () => {
    const targets: Array<{ transport?: string; url: string }> = [];

    rewriteHlsManifest(
      [
        "#EXTM3U",
        "#EXT-X-MEDIA:TYPE=AUDIO,URI='audio?id=1'",
        "#EXT-X-STREAM-INF:BANDWIDTH=1800000",
        "variant?id=2",
        "#EXTINF:4,",
        "segment?id=3"
      ].join("\n"),
      "https://cdn.example.test/path/master.m3u8",
      (url, transport) => {
        targets.push({ transport, url });
        return url;
      }
    );

    expect(targets).toEqual([
      { transport: "hls", url: "https://cdn.example.test/path/audio?id=1" },
      { transport: "hls", url: "https://cdn.example.test/path/variant?id=2" },
      { transport: "direct", url: "https://cdn.example.test/path/segment?id=3" }
    ]);
  });

  it("does not forward range headers to HLS manifests", () => {
    expect(headersForProxyTarget({
      headers: {
        range: "bytes=0-",
        referer: "https://example.test/"
      },
      transport: "hls",
      url: "https://cdn.example.test/path/ZMeIQqwLoh7AmuVt.m3u8"
    }, "bytes=100-")).toEqual({
      referer: "https://example.test/"
    });
  });

  it("keeps request range headers for proxied media segments", () => {
    expect(headersForProxyTarget({
      headers: {
        referer: "https://example.test/"
      },
      transport: "direct",
      url: "https://cdn.example.test/path/segment.ts"
    }, "bytes=100-")).toEqual({
      range: "bytes=100-",
      referer: "https://example.test/"
    });
  });

  it("rejects DASH templates that cannot be safely rewritten", () => {
    expect(() =>
      rewriteDashManifest(
        '<MPD><Period><AdaptationSet><SegmentTemplate media="chunk-$Number$.m4s" /></AdaptationSet></Period></MPD>',
        "https://cdn.example.test/manifest.mpd",
        (url) => url
      )
    ).toThrow("DASH templates");
  });
});
