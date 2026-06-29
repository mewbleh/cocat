import { describe, expect, it } from "vitest";

import { DEFAULT_PROCESSING_SETTINGS } from "@/lib/contracts";
import { buildFfmpegArgs, buildFfmpegRemuxArgs } from "@/lib/server/ffmpeg";
import type { ResolvedMedia } from "@/lib/server/providers/types";

describe("ffmpeg args", () => {
  it("copies original audio without forcing a transcode", () => {
    const args = buildFfmpegArgs(audioMedia({ audioFormat: "original" }), "out.m4a");

    expect(args).toEqual(expect.arrayContaining(["-c", "copy"]));
    expect(args).not.toContain("libmp3lame");
  });

  it("transcodes audio when an explicit audio format is requested", () => {
    const args = buildFfmpegArgs(audioMedia({ audioFormat: "mp3", extension: "mp3" }), "out.mp3");

    expect(args).toEqual(expect.arrayContaining(["-vn", "-c:a", "libmp3lame", "-b:a", "192k"]));
  });

  it("builds local remux args with optional companion audio", () => {
    const args = buildFfmpegRemuxArgs({
      audioPath: "audio.m4a",
      inputPath: "video.mp4",
      outputPath: "out.mp4"
    });

    expect(args).toEqual(expect.arrayContaining(["-i", "video.mp4", "-i", "audio.m4a", "-map", "0:v:0?", "-map", "1:a:0?"]));
    expect(args).toEqual(expect.arrayContaining(["-c", "copy", "-shortest", "out.mp4"]));
  });
});

function audioMedia({
  audioFormat,
  extension = "m4a"
}: {
  audioFormat: ResolvedMedia["settings"]["audioFormat"];
  extension?: string;
}): ResolvedMedia {
  return {
    transport: "direct",
    url: "https://example.com/audio.m4a",
    fileName: `audio.${extension}`,
    extension,
    mode: "audio",
    mimeType: extension === "mp3" ? "audio/mpeg" : "audio/mp4",
    settings: {
      ...DEFAULT_PROCESSING_SETTINGS,
      audioFormat,
      processingPolicy: "copy"
    }
  };
}
