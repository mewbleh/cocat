import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, getPlatformLabel, safeFileName } from "@/lib/utils";

describe("utils", () => {
  it("formats byte counts and durations", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(65)).toBe("1:05");
  });

  it("sanitizes file names", () => {
    expect(safeFileName('bad:name*/file.mp4')).toBe("badnamefile.mp4");
  });

  it("labels known platforms", () => {
    expect(getPlatformLabel("youtube")).toBe("YouTube");
    expect(getPlatformLabel("pinterest")).toBe("Pinterest");
    expect(getPlatformLabel("spotify")).toBe("Spotify");
  });
});
