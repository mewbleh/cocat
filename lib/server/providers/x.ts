import { CoCatError } from "@/lib/server/errors";
import { fetchJson, fetchText } from "@/lib/server/http";
import { createMediaOption, createSourceResult } from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { ProcessingSettings } from "@/lib/contracts";
import type { Provider, ProviderContext, ProviderDownloadOption, ProviderExtractResult } from "@/lib/server/providers/types";

const X_HOSTS = ["x.com", "twitter.com", "t.co"];
const X_ORIGIN = "https://x.com";
const X_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export const xProvider: Provider = {
  id: "x",
  canHandle(url) {
    return hostMatches(url.hostname, X_HOSTS);
  },
  extract: extractX,
  resolve: resolveX
};

async function extractX(url: URL) {
  const tweetId = getTweetId(url);
  const options: ProviderDownloadOption[] = [];
  let metadata: ReturnType<typeof parseHtmlMetadata> | undefined;
  let tweet: SyndicationTweet | undefined;

  if (tweetId) {
    tweet = await fetchJson<SyndicationTweet>(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en`).catch(
      () => undefined
    );
  }

  for (const [mediaIndex, media] of (tweet?.mediaDetails ?? []).entries()) {
    if (media.video_info?.variants?.length) {
      for (const [variantIndex, variant] of media.video_info.variants.entries()) {
        if (!variant.url || variant.content_type !== "video/mp4") {
          continue;
        }

        const option = createMediaOption({
          providerId: "x",
          id: `x:video:${mediaIndex}:${variantIndex}`,
          url: variant.url,
          label: "X video",
          mode: "video",
          mimeType: variant.content_type,
          extension: "mp4",
          width: media.sizes?.large?.w,
          height: media.sizes?.large?.h,
          bitrateKbps: variant.bitrate ? Math.round(variant.bitrate / 1000) : undefined,
          headers: xMediaHeaders(url.href, "video"),
          fallbackHeaders: xMediaFallbackHeaders(url.href, "video")
        });

        if (option) {
          options.push(option);
        }
      }
    }

    const imageUrl = media.media_url_https;

    if (imageUrl && media.type === "photo") {
      const option = createMediaOption({
        providerId: "x",
        id: `x:image:${mediaIndex}`,
        url: `${imageUrl}?format=jpg&name=orig`,
        label: "X image",
        mode: "photo",
        mimeType: "image/jpeg",
        headers: xMediaHeaders(url.href, "photo"),
        fallbackHeaders: xMediaFallbackHeaders(url.href, "photo")
      });

      if (option) {
        options.push(option);
      }
    }
  }

  if (options.length === 0) {
    const html = await fetchText(url.href);
    metadata = parseHtmlMetadata(html, url, "x");
    options.push(...metadata.options.map((option) => withXMediaHeaders(option, url.href)));
  }

  if (options.length === 0) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "X did not expose public media for this post.");
  }

  return createSourceResult({
    providerId: "x",
    sourceUrl: url.href,
    title: tweet?.text ?? metadata?.title ?? "X post",
    author: tweet?.user?.screen_name ? `@${tweet.user.screen_name}` : metadata?.author,
    thumbnailUrl: tweet?.mediaDetails?.[0]?.media_url_https ?? metadata?.thumbnailUrl,
    durationSeconds: metadata?.durationSeconds,
    options,
    debug: {
      tweetId: tweetId ?? null,
      strategy: tweet ? "syndication" : "html-fallback"
    }
  });
}

async function resolveX(
  source: ProviderExtractResult,
  optionId: string,
  context: ProviderContext,
  settings: ProcessingSettings
) {
  const selectedOption = source.options.find((option) => option.id === optionId);
  const refreshedSource = await extractX(new URL(source.sourceUrl)).catch(() => source);
  const refreshedOption =
    refreshedSource.options.find((option) => option.id === optionId) ??
    refreshedSource.options.find((option) => option.mode === selectedOption?.mode);

  return resolveOption(refreshedSource, refreshedOption?.id ?? optionId, context, settings);
}

function getTweetId(url: URL) {
  return url.pathname.match(/status(?:es)?\/(\d+)/)?.[1];
}

function withXMediaHeaders(option: ProviderDownloadOption, referer: string): ProviderDownloadOption {
  return {
    ...option,
    media: {
      ...option.media,
      headers: {
        ...xMediaHeaders(referer, option.mode),
        ...option.media.headers
      },
      fallbackHeaders: [
        ...xMediaFallbackHeaders(referer, option.mode),
        ...(option.media.fallbackHeaders ?? [])
      ]
    }
  };
}

function xMediaHeaders(referer: string, mode: ProviderDownloadOption["mode"]) {
  return {
    accept: mode === "video" ? "video/mp4,video/*;q=0.9,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    origin: X_ORIGIN,
    range: "bytes=0-",
    referer,
    "sec-fetch-dest": mode === "video" ? "video" : "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "cross-site",
    "user-agent": X_BROWSER_USER_AGENT
  };
}

function xMediaFallbackHeaders(referer: string, mode: ProviderDownloadOption["mode"]) {
  return [
    {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer,
      "user-agent": X_BROWSER_USER_AGENT
    },
    {
      accept: mode === "video" ? "video/mp4,video/*;q=0.9,*/*;q=0.8" : "image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer: "https://twitter.com/",
      "user-agent": X_BROWSER_USER_AGENT
    },
    {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      range: "bytes=0-",
      referer: X_ORIGIN,
      "user-agent": X_BROWSER_USER_AGENT
    }
  ];
}

type SyndicationTweet = {
  text?: string;
  user?: {
    screen_name?: string;
  };
  mediaDetails?: Array<{
    type?: "photo" | "video" | "animated_gif";
    media_url_https?: string;
    sizes?: {
      large?: {
        w?: number;
        h?: number;
      };
    };
    video_info?: {
      variants?: Array<{
        bitrate?: number;
        content_type?: string;
        url?: string;
      }>;
    };
  }>;
};
