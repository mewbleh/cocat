import { describe, expect, it } from "vitest";

import { assertResolvedMediaUrlsArePublic } from "@/lib/server/jobs";

describe("resolved media safety", () => {
  it("rejects private primary media URLs before ffmpeg processing", async () => {
    await expect(
      assertResolvedMediaUrlsArePublic({
        url: "http://127.0.0.1/video.mp4"
      })
    ).rejects.toMatchObject({ code: "PRIVATE_NETWORK_BLOCKED" });
  });

  it("rejects private companion audio URLs before ffmpeg processing", async () => {
    await expect(
      assertResolvedMediaUrlsArePublic({
        url: "https://example.com/video.mp4",
        audioUrl: "http://10.0.0.5/audio.m4a"
      })
    ).rejects.toMatchObject({ code: "PRIVATE_NETWORK_BLOCKED" });
  });
});
