export const PROVIDER_IDS = [
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
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type MediaMode = "video" | "audio" | "photo" | "gif";

export type QualityCap = "best" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";

export type OutputContainer = "auto" | "mp4" | "webm" | "mkv" | "mp3" | "m4a" | "opus";

export type CodecPreference = "auto" | "h264" | "vp9" | "av1" | "aac" | "opus" | "copy";

export type ProcessingPolicy = "auto" | "remux" | "transcode" | "copy";

export type StreamHandling = "auto" | "direct" | "ffmpeg";

export type ProxyMode = "auto" | "always" | "direct";

export type ProcessingSettings = {
  qualityCap: QualityCap;
  outputContainer: OutputContainer;
  codecPreference: CodecPreference;
  audioFormat: "mp3" | "m4a" | "opus" | "original";
  audioBitrateKbps: 96 | 128 | 192 | 256 | 320;
  mergeAudioVideo: boolean;
  processingPolicy: ProcessingPolicy;
  streamHandling: StreamHandling;
  proxyMode: ProxyMode;
  embedMetadata: boolean;
  includeThumbnail: boolean;
  includeSubtitles: boolean;
  filenameTemplate: string;
  showProviderDebug: boolean;
};

export const DEFAULT_PROCESSING_SETTINGS: ProcessingSettings = {
  qualityCap: "1080p",
  outputContainer: "auto",
  codecPreference: "auto",
  audioFormat: "mp3",
  audioBitrateKbps: 192,
  mergeAudioVideo: true,
  processingPolicy: "auto",
  streamHandling: "auto",
  proxyMode: "always",
  embedMetadata: false,
  includeThumbnail: false,
  includeSubtitles: false,
  filenameTemplate: "{title}",
  showProviderDebug: false
};

export type ProviderCapabilities = {
  directDownload: boolean;
  hls: boolean;
  dash: boolean;
  adaptive: boolean;
  audioOnly: boolean;
  subtitles: boolean;
  thumbnails: boolean;
  requiresFfmpeg: boolean;
  notes: string[];
};

export type SettingConstraints = {
  qualityCaps: QualityCap[];
  outputContainers: OutputContainer[];
  audioFormats: ProcessingSettings["audioFormat"][];
  codecPreferences: CodecPreference[];
};

export type DownloadOption = {
  id: string;
  label: string;
  mode: MediaMode;
  extension: string;
  container?: OutputContainer;
  codecs?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
  isAdaptive?: boolean;
  requiresFfmpeg?: boolean;
  transport?: "direct" | "hls" | "dash";
  quality?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
};

export type ExtractedMedia = {
  sourceToken: string;
  providerId: ProviderId;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  sourceUrl: string;
  options: DownloadOption[];
  recommendedOptionId?: string;
  capabilities: ProviderCapabilities;
  settingConstraints: SettingConstraints;
  debug?: Record<string, string | number | boolean | null>;
};

export type ExtractResponse = {
  media: ExtractedMedia;
};

export type JobStatus = "queued" | "running" | "complete" | "failed" | "expired" | "cancelled";

export type JobProgressEvent = {
  type: JobStatus | "resolving" | "downloading" | "merging" | "transcoding" | "remuxing" | "metadata" | "progress";
  jobId: string;
  message?: string;
  progress?: number;
  downloadUrl?: string;
  errorCode?: string;
};

export type CreateJobResponse = {
  jobId: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};
