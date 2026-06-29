import type {
  DownloadOption,
  MediaMode,
  ProcessingSettings,
  ProviderCapabilities,
  ProviderId,
  SettingConstraints
} from "@/lib/contracts";

export type { ProviderId };

export type ProviderContext = {
  requestId: string;
  signal?: AbortSignal;
};

export type MediaTransport = "direct" | "hls" | "dash";

export type ProviderMediaReference = {
  transport: MediaTransport;
  url: string;
  audioUrl?: string;
  subtitleUrl?: string;
  thumbnailUrl?: string;
  headers?: Record<string, string>;
  fallbackHeaders?: Array<Record<string, string>>;
  mimeType?: string;
  audioMimeType?: string;
  sizeBytes?: number;
};

export type ProviderDownloadOption = DownloadOption & {
  media: ProviderMediaReference;
};

export type ProviderExtractResult = {
  providerId: ProviderId;
  sourceUrl: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  options: ProviderDownloadOption[];
  recommendedOptionId?: string;
  capabilities: ProviderCapabilities;
  settingConstraints: SettingConstraints;
  debug?: Record<string, string | number | boolean | null>;
};

export type ResolvedMedia = {
  transport: MediaTransport;
  url: string;
  audioUrl?: string;
  subtitleUrl?: string;
  thumbnailUrl?: string;
  headers?: Record<string, string>;
  fallbackHeaders?: Array<Record<string, string>>;
  fileName: string;
  extension: string;
  mode: MediaMode;
  mimeType?: string;
  audioMimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  requiresFfmpeg?: boolean;
  settings: ProcessingSettings;
};

export type Provider = {
  id: ProviderId;
  canHandle(url: URL): boolean;
  extract(url: URL, context: ProviderContext): Promise<ProviderExtractResult>;
  resolve(
    source: ProviderExtractResult,
    optionId: string,
    context: ProviderContext,
    settings: ProcessingSettings
  ): Promise<ResolvedMedia>;
};

export function toPublicOption(option: ProviderDownloadOption): DownloadOption {
  const publicOption = { ...option };
  delete (publicOption as Partial<ProviderDownloadOption>).media;

  return publicOption;
}
