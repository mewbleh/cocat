import { CoCatError } from "@/lib/server/errors";
import { validatePublicUrl } from "@/lib/server/url-safety";
import { directProvider } from "@/lib/server/providers/direct";
import {
  blueskyProvider,
  dailymotionProvider,
  facebookProvider,
  flickrProvider,
  imgurProvider,
  instagramProvider,
  kickProvider,
  mastodonProvider,
  pinterestProvider,
  pixelfedProvider,
  redditProvider,
  rumbleProvider,
  soundcloudProvider,
  spotifyProvider,
  streamableProvider,
  threadsProvider,
  tiktokProvider,
  tumblrProvider,
  twitchProvider,
  vimeoProvider,
  xProvider
} from "@/lib/server/providers/platforms";
import type { Provider, ProviderContext, ProviderExtractResult, ResolvedMedia } from "@/lib/server/providers/types";
import { toPublicOption } from "@/lib/server/providers/types";
import { youtubeProvider } from "@/lib/server/providers/youtube";
import type { ProcessingSettings } from "@/lib/contracts";

const providers: Provider[] = [
  youtubeProvider,
  tiktokProvider,
  instagramProvider,
  xProvider,
  redditProvider,
  spotifyProvider,
  soundcloudProvider,
  vimeoProvider,
  pinterestProvider,
  facebookProvider,
  threadsProvider,
  blueskyProvider,
  tumblrProvider,
  dailymotionProvider,
  streamableProvider,
  imgurProvider,
  twitchProvider,
  kickProvider,
  rumbleProvider,
  flickrProvider,
  mastodonProvider,
  pixelfedProvider,
  directProvider
];

export async function extractWithProvider(input: string, context: ProviderContext) {
  const url = await validatePublicUrl(input);
  const provider = findProvider(url);
  const result = await provider.extract(url, context);

  assertHasOptions(result);

  return result;
}

export async function resolveWithProvider(
  source: ProviderExtractResult,
  optionId: string,
  context: ProviderContext,
  settings: ProcessingSettings
): Promise<ResolvedMedia> {
  const provider = providers.find((candidate) => candidate.id === source.providerId);

  if (!provider) {
    throw new CoCatError("UNSUPPORTED_PLATFORM", "CoCat does not have a provider for that URL anymore.");
  }

  return provider.resolve(source, optionId, context, settings);
}

export function toPublicExtractResult(source: ProviderExtractResult, sourceToken: string) {
  return {
    sourceToken,
    providerId: source.providerId,
    title: source.title,
    author: source.author,
    thumbnailUrl: source.thumbnailUrl,
    durationSeconds: source.durationSeconds,
    sourceUrl: source.sourceUrl,
    options: source.options.map(toPublicOption),
    recommendedOptionId: source.recommendedOptionId,
    capabilities: source.capabilities,
    settingConstraints: source.settingConstraints,
    debug: source.debug
  };
}

export function providerIds() {
  return providers.map((provider) => provider.id);
}

function findProvider(url: URL) {
  return providers.find((provider) => provider.canHandle(url)) ?? directProvider;
}

function assertHasOptions(result: ProviderExtractResult) {
  if (result.options.length === 0) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "CoCat could not find a public downloadable media file on that page.");
  }
}
