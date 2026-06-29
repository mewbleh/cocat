import { createHtmlPlatformProvider } from "@/lib/server/providers/html-platform";

const LOGIN_MARKERS = ["log in to continue", "login required", "sign in to continue", "not available"];

export const pinterestProvider = createHtmlPlatformProvider({
  id: "pinterest",
  hosts: ["pinterest.com", "pin.it"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Pinterest did not expose a public image or video file on the page."
});

export const facebookProvider = createHtmlPlatformProvider({
  id: "facebook",
  hosts: ["facebook.com", "fb.watch", "m.facebook.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Facebook did not expose a public media file on the page."
});

export const threadsProvider = createHtmlPlatformProvider({
  id: "threads",
  hosts: ["threads.net"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Threads did not expose a public media file on the page."
});

export const blueskyProvider = createHtmlPlatformProvider({
  id: "bluesky",
  hosts: ["bsky.app"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Bluesky did not expose a public media file on the page."
});

export const tumblrProvider = createHtmlPlatformProvider({
  id: "tumblr",
  hosts: ["tumblr.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Tumblr did not expose a public media file on the page."
});

export const dailymotionProvider = createHtmlPlatformProvider({
  id: "dailymotion",
  hosts: ["dailymotion.com", "dai.ly"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Dailymotion did not expose a public media file on the page."
});

export const streamableProvider = createHtmlPlatformProvider({
  id: "streamable",
  hosts: ["streamable.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Streamable did not expose a public media file on the page."
});

export const imgurProvider = createHtmlPlatformProvider({
  id: "imgur",
  hosts: ["imgur.com", "i.imgur.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Imgur did not expose a public image, GIF, or video file on the page."
});

export const twitchProvider = createHtmlPlatformProvider({
  id: "twitch",
  hosts: ["twitch.tv", "clips.twitch.tv"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Twitch did not expose a public clip or video file on the page."
});

export const kickProvider = createHtmlPlatformProvider({
  id: "kick",
  hosts: ["kick.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Kick did not expose a public media file on the page."
});

export const rumbleProvider = createHtmlPlatformProvider({
  id: "rumble",
  hosts: ["rumble.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Rumble did not expose a public media file on the page."
});

export const flickrProvider = createHtmlPlatformProvider({
  id: "flickr",
  hosts: ["flickr.com", "flic.kr", "staticflickr.com"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Flickr did not expose a public photo or video file on the page."
});

export const mastodonProvider = createHtmlPlatformProvider({
  id: "mastodon",
  hosts: ["mastodon.social", "mstdn.social", "mas.to", "fosstodon.org", "infosec.exchange"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Mastodon did not expose a public media attachment on the page."
});

export const pixelfedProvider = createHtmlPlatformProvider({
  id: "pixelfed",
  hosts: ["pixelfed.social", "pixelfed.de", "pixelfed.fr"],
  authRequiredMarkers: LOGIN_MARKERS,
  noPublicMediaMessage: "Pixelfed did not expose a public media attachment on the page."
});
