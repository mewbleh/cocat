import { CoCatError } from "@/lib/server/errors";
import { fetchJson } from "@/lib/server/http";
import {
  createMediaOption,
  createSourceResult,
  getNumber
} from "@/lib/server/providers/extract-utils";
import { optionsFromManifestUrl } from "@/lib/server/providers/manifests";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption } from "@/lib/server/providers/types";

const REDDIT_HOSTS = ["reddit.com", "redd.it"];

export const redditProvider: Provider = {
  id: "reddit",
  canHandle(url) {
    return hostMatches(url.hostname, REDDIT_HOSTS);
  },
  async extract(url) {
    const post = await fetchRedditPost(url);
    const mediaSource = getRedditMediaSource(post);
    const redditVideo = mediaSource?.reddit_video;
    const options: ProviderDownloadOption[] = [];

    if (redditVideo?.fallback_url) {
      const fallbackUrl = decodeHtml(redditVideo.fallback_url);
      const option = createMediaOption({
        providerId: "reddit",
        id: "reddit:video:fallback",
        url: fallbackUrl,
        label: redditVideo.is_gif ? "Reddit GIF video" : "Reddit video",
        mode: redditVideo.is_gif ? "gif" : "video",
        mimeType: "video/mp4",
        extension: "mp4",
        width: redditVideo.width,
        height: redditVideo.height,
        quality: redditVideo.height ? `${redditVideo.height}p` : undefined
      });

      if (option) {
        options.push(option);
      }
    }

    for (const manifest of [redditVideo?.hls_url, redditVideo?.dash_url].filter(Boolean)) {
      const manifestUrl = decodeHtml(manifest ?? "");
      options.push(...await optionsFromManifestUrl({
        manifestUrl,
        providerId: "reddit",
        titlePrefix: manifestUrl.includes(".mpd") ? "Reddit DASH" : "Reddit HLS"
      }).catch(() => []));
    }

    for (const imageUrl of redditImageUrls(post)) {
      const option = createMediaOption({
        providerId: "reddit",
        id: `reddit:image:${options.length}`,
        url: imageUrl,
        label: "Reddit image",
        mode: "photo",
        mimeType: imageMimeType(imageUrl)
      });

      if (option) {
        options.push(option);
      }
    }

    if (options.length === 0) {
      throw new CoCatError("UNSUPPORTED_MEDIA", "Reddit did not expose public hosted media for this post.");
    }

    return createSourceResult({
      providerId: "reddit",
      sourceUrl: url.href,
      title: post.title ?? "Reddit post",
      author: post.author ? `u/${post.author}` : undefined,
      thumbnailUrl: bestRedditThumbnail(post),
      durationSeconds: getNumber(redditVideo?.duration),
      options,
      debug: {
        postId: post.id ?? null,
        subreddit: post.subreddit ?? null,
        strategy: "reddit-json"
      }
    });
  },
  resolve: resolveOption
};

async function fetchRedditPost(url: URL) {
  const jsonUrl = redditJsonUrl(url);
  const listing = await fetchJson<RedditListing[]>(jsonUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "CoCat/1.0"
    }
  });
  const post = listing[0]?.data?.children?.[0]?.data;

  if (!post) {
    throw new CoCatError("UNSUPPORTED_MEDIA", "Reddit did not return a public post for that URL.");
  }

  return post;
}

function redditJsonUrl(url: URL) {
  if (url.hostname.includes("redd.it")) {
    const postId = url.pathname.split("/").filter(Boolean)[0];
    return `https://www.reddit.com/comments/${postId}.json?raw_json=1`;
  }

  const pathname = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `https://www.reddit.com${pathname}.json?raw_json=1`;
}

function getRedditMediaSource(post: RedditPost): RedditMedia | undefined {
  return post.secure_media ?? post.media ?? post.crosspost_parent_list?.[0]?.secure_media ?? post.crosspost_parent_list?.[0]?.media;
}

function redditImageUrls(post: RedditPost) {
  const urls = new Set<string>();

  if (post.url_overridden_by_dest && isImageUrl(post.url_overridden_by_dest)) {
    urls.add(decodeHtml(post.url_overridden_by_dest));
  }

  for (const image of post.preview?.images ?? []) {
    const sourceUrl = image.source?.url;

    if (sourceUrl) {
      urls.add(decodeHtml(sourceUrl));
    }
  }

  for (const item of Object.values(post.media_metadata ?? {})) {
    const mediaUrl = item.s?.u ?? item.s?.gif;

    if (mediaUrl) {
      urls.add(decodeHtml(mediaUrl));
    }
  }

  return [...urls];
}

function bestRedditThumbnail(post: RedditPost) {
  return redditImageUrls(post)[0] ?? (post.thumbnail?.startsWith("http") ? post.thumbnail : undefined);
}

function decodeHtml(value: string) {
  return value.replaceAll("&amp;", "&");
}

function isImageUrl(url: string) {
  return /\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)/i.test(url);
}

function imageMimeType(url: string) {
  const extension = url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1]?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif"
  };

  return extension ? mimeTypes[extension] : undefined;
}

type RedditListing = {
  data?: {
    children?: Array<{
      data?: RedditPost;
    }>;
  };
};

type RedditPost = {
  id?: string;
  title?: string;
  author?: string;
  subreddit?: string;
  thumbnail?: string;
  url_overridden_by_dest?: string;
  secure_media?: RedditMedia;
  media?: RedditMedia;
  crosspost_parent_list?: RedditPost[];
  preview?: {
    images?: Array<{
      source?: {
        url?: string;
      };
    }>;
  };
  media_metadata?: Record<
    string,
    {
      s?: {
        u?: string;
        gif?: string;
      };
    }
  >;
};

type RedditMedia = {
  reddit_video?: {
    fallback_url?: string;
    hls_url?: string;
    dash_url?: string;
    duration?: number;
    height?: number;
    width?: number;
    is_gif?: boolean;
  };
};
