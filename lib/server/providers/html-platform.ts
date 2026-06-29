import { CoCatError } from "@/lib/server/errors";
import { fetchText } from "@/lib/server/http";
import { parseHtmlMetadata } from "@/lib/server/providers/html-metadata";
import {
  capabilitiesFromOptions,
  DEFAULT_SETTING_CONSTRAINTS,
  hostMatches,
  rankRecommendedOption,
  resolveOption
} from "@/lib/server/providers/shared";
import type { Provider, ProviderId } from "@/lib/server/providers/types";

type HtmlPlatformProviderOptions = {
  id: ProviderId;
  hosts: string[];
  authRequiredMarkers?: string[];
  noPublicMediaMessage?: string;
};

export function createHtmlPlatformProvider({
  id,
  hosts,
  authRequiredMarkers = [],
  noPublicMediaMessage = "This platform did not expose a public media file on the page."
}: HtmlPlatformProviderOptions): Provider {
  return {
    id,
    canHandle(url) {
      return hostMatches(url.hostname, hosts);
    },
    async extract(url) {
      const html = await fetchText(url.href);
      const metadata = parseHtmlMetadata(html, url, id);

      if (metadata.options.length === 0) {
        if (detectAuthRequired(html, authRequiredMarkers)) {
          throw new CoCatError("AUTH_REQUIRED", `${id} is not exposing this media publicly.`);
        }

        throw new CoCatError("UNSUPPORTED_MEDIA", noPublicMediaMessage);
      }

      const source = {
        providerId: id,
        sourceUrl: url.href,
        title: metadata.title,
        author: metadata.author,
        thumbnailUrl: metadata.thumbnailUrl,
        durationSeconds: metadata.durationSeconds,
        options: metadata.options,
        capabilities: capabilitiesFromOptions(metadata),
        settingConstraints: DEFAULT_SETTING_CONSTRAINTS,
        debug: {
          strategy: "html-jsonld-og"
        }
      };

      return {
        ...source,
        recommendedOptionId: rankRecommendedOption(source.options)
      };
    },
    resolve: resolveOption
  };
}

export function detectAuthRequired(html: string, markers: string[]) {
  const normalizedHtml = html.toLowerCase();
  return markers.some((marker) => normalizedHtml.includes(marker.toLowerCase()));
}
