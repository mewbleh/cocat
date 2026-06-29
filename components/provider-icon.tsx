import type { ProviderId } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { Link } from "lucide-react";
import {
  siBluesky,
  siDailymotion,
  siFacebook,
  siFlickr,
  siImgur,
  siInstagram,
  siKick,
  siMastodon,
  siPinterest,
  siPixelfed,
  siReddit,
  siRumble,
  siSoundcloud,
  siSpotify,
  siThreads,
  siTiktok,
  siTumblr,
  siTwitch,
  siVimeo,
  siX,
  siYoutube
} from "simple-icons";

type ProviderIconProps = {
  providerId?: ProviderId | string | null;
  className?: string;
};

type BrandIcon = {
  title: string;
  path: string;
  hex: string;
};

const PROVIDER_ICONS: Record<string, BrandIcon> = {
  youtube: siYoutube,
  tiktok: siTiktok,
  instagram: siInstagram,
  x: siX,
  reddit: siReddit,
  spotify: siSpotify,
  soundcloud: siSoundcloud,
  vimeo: siVimeo,
  pinterest: siPinterest,
  facebook: siFacebook,
  threads: siThreads,
  bluesky: siBluesky,
  tumblr: siTumblr,
  dailymotion: siDailymotion,
  imgur: siImgur,
  twitch: siTwitch,
  kick: siKick,
  rumble: siRumble,
  flickr: siFlickr,
  mastodon: siMastodon,
  pixelfed: siPixelfed
};

const REMOTE_PROVIDER_ICONS: Record<string, string> = {
  streamable: "https://streamable.com/favicon.ico"
};

export function ProviderIcon({ providerId, className }: ProviderIconProps) {
  const brandIcon = providerId ? PROVIDER_ICONS[providerId] : undefined;
  const remoteIcon = providerId ? REMOTE_PROVIDER_ICONS[providerId] : undefined;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-6 shrink-0 place-items-center rounded-md border bg-white text-zinc-950 shadow-sm",
        className
      )}
    >
      {brandIcon ? (
        <svg className="size-[68%]" fill={`#${brandIcon.hex}`} focusable="false" viewBox="0 0 24 24">
          <path d={brandIcon.path} />
        </svg>
      ) : remoteIcon ? (
        <span
          className="size-[68%] bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${remoteIcon}")` }}
        />
      ) : (
        <Link className="size-[68%] text-zinc-700" />
      )}
    </span>
  );
}
