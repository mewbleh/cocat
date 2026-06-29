import { CoCatError } from "@/lib/server/errors";
import { fetchJson, fetchText } from "@/lib/server/http";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { optionsFromManifestUrl } from "@/lib/server/providers/manifests";
import {
  absoluteUrl,
  createMediaOption,
  createSourceResult,
  getNumber,
  getString
} from "@/lib/server/providers/extract-utils";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption } from "@/lib/server/providers/types";

const VIMEO_HOSTS = ["vimeo.com", "player.vimeo.com"];

export const vimeoProvider: Provider = {
  id: "vimeo",
  canHandle(url) {
    return hostMatches(url.hostname, VIMEO_HOSTS);
  },
  async extract(url) {
    const videoId = getVimeoVideoId(url);
    const html = await fetchText(url.href).catch(() => "");
    const htmlMetadata = html ? parseHtmlMetadata(html, url, "vimeo") : undefined;

    if (!videoId) {
      if (htmlMetadata?.options.length) {
        return createSourceResult({
          providerId: "vimeo",
          sourceUrl: url.href,
          title: htmlMetadata.title,
          author: htmlMetadata.author,
          thumbnailUrl: htmlMetadata.thumbnailUrl,
          durationSeconds: htmlMetadata.durationSeconds,
          options: htmlMetadata.options,
          debug: { strategy: "html-fallback" }
        });
      }

      throw new CoCatError("INVALID_URL", "CoCat could not find a Vimeo video id in that URL.");
    }

    const config = await fetchVimeoConfig(videoId);
    const video = config.video ?? {};
    const files = config.request?.files;
    const options: ProviderDownloadOption[] = [];

    for (const [index, file] of (files?.progressive ?? []).entries()) {
      const option = createMediaOption({
        providerId: "vimeo",
        id: `vimeo:progressive:${index}`,
        url: file.url,
        label: `${file.quality ?? file.height ? `${file.quality ?? `${file.height}p`} ` : ""}MP4`,
        mode: "video",
        mimeType: file.mime ?? "video/mp4",
        extension: "mp4",
        width: file.width,
        height: file.height,
        fps: file.fps,
        quality: file.quality ?? (file.height ? `${file.height}p` : undefined)
      });

      if (option) {
        options.push(option);
      }
    }

    for (const manifest of vimeoManifestUrls(files?.hls).slice(0, 1)) {
      options.push(...await optionsFromManifestUrl({ manifestUrl: manifest, providerId: "vimeo", titlePrefix: "Vimeo HLS" }));
    }

    for (const manifest of vimeoManifestUrls(files?.dash).slice(0, 1)) {
      options.push(...await optionsFromManifestUrl({ manifestUrl: manifest, providerId: "vimeo", titlePrefix: "Vimeo DASH" }));
    }

    if (options.length === 0 && htmlMetadata?.options.length) {
      options.push(...htmlMetadata.options);
    }

    if (options.length === 0) {
      throw new CoCatError("UNSUPPORTED_MEDIA", "Vimeo did not expose a public media file for this video.");
    }

    return createSourceResult({
      providerId: "vimeo",
      sourceUrl: url.href,
      title: video.title ?? htmlMetadata?.title ?? "Vimeo video",
      author: video.owner?.name ?? htmlMetadata?.author,
      thumbnailUrl: bestVimeoThumbnail(video.thumbs) ?? htmlMetadata?.thumbnailUrl,
      durationSeconds: getNumber(video.duration) ?? htmlMetadata?.durationSeconds,
      options,
      debug: {
        videoId,
        strategy: "player-config",
        progressiveCount: files?.progressive?.length ?? 0
      }
    });
  },
  resolve: resolveOption
};

async function fetchVimeoConfig(videoId: string) {
  return fetchJson<VimeoConfig>(`https://player.vimeo.com/video/${videoId}/config`, {
    headers: {
      referer: "https://vimeo.com/"
    }
  });
}

function getVimeoVideoId(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  const videoIndex = parts.indexOf("video");

  if (videoIndex >= 0 && parts[videoIndex + 1]) {
    return parts[videoIndex + 1];
  }

  return parts.find((part) => /^\d+$/.test(part));
}

function vimeoManifestUrls(manifestGroup?: VimeoManifestGroup) {
  if (!manifestGroup?.cdns) {
    return [];
  }

  return Object.values(manifestGroup.cdns)
    .map((cdn) => getString(cdn.url))
    .filter((url): url is string => Boolean(url))
    .map((url) => absoluteUrl(url, "https://player.vimeo.com/"))
    .filter((url): url is string => Boolean(url));
}

function bestVimeoThumbnail(thumbs?: Record<string, string>) {
  if (!thumbs) {
    return undefined;
  }

  return Object.entries(thumbs)
    .sort(([left], [right]) => Number(right) - Number(left))[0]?.[1];
}

type VimeoConfig = {
  video?: {
    title?: string;
    duration?: number;
    owner?: {
      name?: string;
    };
    thumbs?: Record<string, string>;
  };
  request?: {
    files?: {
      progressive?: Array<{
        url: string;
        mime?: string;
        quality?: string;
        width?: number;
        height?: number;
        fps?: number;
      }>;
      hls?: VimeoManifestGroup;
      dash?: VimeoManifestGroup;
    };
  };
};

type VimeoManifestGroup = {
  cdns?: Record<string, { url?: string }>;
};
