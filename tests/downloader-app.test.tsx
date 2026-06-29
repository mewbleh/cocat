import { describe, expect, it } from "vitest";

import { legacyFormatOptionLabel } from "@/components/downloader-app";
import type { DownloadOption } from "@/lib/contracts";

const baseOption: DownloadOption = {
  id: "direct:mp4",
  label: "Original file",
  mode: "video",
  extension: "mp4",
  hasAudio: true,
  hasVideo: true
};

describe("download option labels", () => {
  it("omits size text when size is unknown", () => {
    expect(legacyFormatOptionLabel(baseOption)).not.toContain("Unknown size");
  });

  it("shows size text when size is known", () => {
    expect(legacyFormatOptionLabel({ ...baseOption, sizeBytes: 1024 })).toContain("1.0 KB");
  });

  it("uses concrete media details instead of generic embedded labels", () => {
    const label = legacyFormatOptionLabel({
      ...baseOption,
      label: "Embedded media",
      quality: "720p",
      width: 1280,
      height: 720,
      bitrateKbps: 832,
      transport: "direct"
    });

    expect(label).toBe("720p - 1280x720 - 832 kbps - MP4 - video+audio - direct");
    expect(label).not.toContain("Embedded media");
  });
});
