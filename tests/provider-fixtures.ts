import type { ProviderCapabilities, SettingConstraints } from "@/lib/contracts";

export const testCapabilities: ProviderCapabilities = {
  directDownload: true,
  hls: false,
  dash: false,
  adaptive: false,
  audioOnly: false,
  subtitles: false,
  thumbnails: false,
  requiresFfmpeg: false,
  notes: []
};

export const testSettingConstraints: SettingConstraints = {
  qualityCaps: ["best", "1080p", "720p", "480p", "360p"],
  outputContainers: ["auto", "mp4", "webm", "mkv", "mp3", "m4a", "opus"],
  audioFormats: ["mp3", "m4a", "opus", "original"],
  codecPreferences: ["auto", "h264", "vp9", "av1", "aac", "opus", "copy"]
};
