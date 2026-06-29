import { CoCatError } from "@/lib/server/errors";
import { fetchJson, fetchText } from "@/lib/server/http";
import {
  absoluteUrl,
  collectStringValuesByKey,
  createMediaOption,
  createSourceResult,
  parseWindowJson
} from "@/lib/server/providers/extract-utils";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import { hostMatches, resolveOption } from "@/lib/server/providers/shared";
import type { Provider, ProviderDownloadOption } from "@/lib/server/providers/types";

const SOUNDCLOUD_HOSTS = ["soundcloud.com"];

export const soundcloudProvider: Provider = {
  id: "soundcloud",
  canHandle(url) {
    return hostMatches(url.hostname, SOUNDCLOUD_HOSTS);
  },
  async extract(url) {
    const [html, oembed] = await Promise.all([
      fetchText(url.href),
      fetchJson<SoundCloudOembed>(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url.href)}`).catch(
        () => undefined
      )
    ]);
    const metadata = parseHtmlMetadata(html, url, "soundcloud");
    const hydration = parseWindowJson(html, "window.__sc_hydration");
    const options: ProviderDownloadOption[] = [...metadata.options];

    for (const [index, streamUrl] of collectStringValuesByKey(hydration, ["stream_url", "url"]).entries()) {
      const absoluteStreamUrl = absoluteUrl(streamUrl, url);

      if (!absoluteStreamUrl || !isLikelySoundCloudStream(absoluteStreamUrl)) {
        continue;
      }

      const option = createMediaOption({
        providerId: "soundcloud",
        id: `soundcloud:audio:${index}`,
        url: absoluteStreamUrl,
        label: "SoundCloud audio",
        mode: "audio",
        mimeType: absoluteStreamUrl.includes("m3u8") ? "application/vnd.apple.mpegurl" : "audio/mpeg",
        extension: absoluteStreamUrl.includes("m3u8") ? "m3u8" : "mp3",
        requiresFfmpeg: absoluteStreamUrl.includes("m3u8")
      });

      if (option) {
        options.push(option);
      }
    }

    if (options.length === 0) {
      throw new CoCatError(
        "UNSUPPORTED_MEDIA",
        "SoundCloud exposed public metadata, but not a direct public audio stream for this track."
      );
    }

    return createSourceResult({
      providerId: "soundcloud",
      sourceUrl: url.href,
      title: oembed?.title ?? metadata.title,
      author: oembed?.author_name ?? metadata.author,
      thumbnailUrl: oembed?.thumbnail_url ?? metadata.thumbnailUrl,
      durationSeconds: metadata.durationSeconds,
      options,
      debug: {
        strategy: "oembed-hydration-html",
        hasOembed: Boolean(oembed)
      }
    });
  },
  resolve: resolveOption
};

function isLikelySoundCloudStream(url: string) {
  return url.includes("api.soundcloud.com") || url.includes("sndcdn.com") || url.includes(".m3u8");
}

type SoundCloudOembed = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};
