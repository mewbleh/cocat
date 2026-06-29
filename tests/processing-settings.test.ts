import { describe, expect, it } from "vitest";

import { DEFAULT_PROCESSING_SETTINGS } from "@/lib/contracts";
import {
  normalizeProcessingSettings,
  parseStoredProcessingSettings,
  qualityCapToHeight,
  serializeProcessingSettings
} from "@/lib/processing-settings";

describe("processing settings", () => {
  it("applies defaults to partial input", () => {
    expect(normalizeProcessingSettings({ qualityCap: "720p" })).toEqual({
      ...DEFAULT_PROCESSING_SETTINGS,
      qualityCap: "720p"
    });
  });

  it("round-trips storage values", () => {
    const settings = normalizeProcessingSettings({ outputContainer: "webm", includeThumbnail: true });

    expect(parseStoredProcessingSettings(serializeProcessingSettings(settings))).toEqual(settings);
  });

  it("falls back on invalid stored settings", () => {
    expect(parseStoredProcessingSettings("{nope")).toEqual(DEFAULT_PROCESSING_SETTINGS);
  });

  it("maps quality caps to heights", () => {
    expect(qualityCapToHeight("720p")).toBe(720);
    expect(qualityCapToHeight("best")).toBe(Number.POSITIVE_INFINITY);
  });
});
