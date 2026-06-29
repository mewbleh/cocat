import { CoCatError } from "@/lib/server/errors";
import { fetchJson, fetchText } from "@/lib/server/http";
import { createMediaOption, createSourceResult } from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption } from "@/lib/server/providers/types";

const X_HOSTS = ["x.com", "twitter.com", "t.co"];

export const xProvider: Provider = {
  id: "x",
  canHandle(url) {
    return hostMatches(url.hostname, X_HOSTS);
  },
  async extract(url) {
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
            bitrateKbps: variant.bitrate ? Math.round(variant.bitrate / 1000) : undefined
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
          mimeType: "image/jpeg"
        });

        if (option) {
          options.push(option);
        }
      }
    }

    if (options.length === 0) {
      const html = await fetchText(url.href);
      metadata = parseHtmlMetadata(html, url, "x");
      options.push(...metadata.options);
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
  },
  resolve: resolveOption
};

function getTweetId(url: URL) {
  return url.pathname.match(/status(?:es)?\/(\d+)/)?.[1];
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
