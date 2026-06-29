import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/http", () => ({
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
  readResponseText: vi.fn(readMockResponseText),
  safeFetch: vi.fn()
}));

import { fetchJson, fetchText, readResponseText, safeFetch } from "@/lib/server/http";
import { DEFAULT_PROCESSING_SETTINGS } from "@/lib/contracts";
import { bilibiliProvider } from "@/lib/server/providers/bilibili";
import { instagramProvider } from "@/lib/server/providers/instagram";
import { redditProvider } from "@/lib/server/providers/reddit";
import { soundcloudProvider } from "@/lib/server/providers/soundcloud";
import { spotifyProvider } from "@/lib/server/providers/spotify";
import { tiktokProvider } from "@/lib/server/providers/tiktok";
import { vimeoProvider } from "@/lib/server/providers/vimeo";
import { xProvider } from "@/lib/server/providers/x";
import { youtubeProvider } from "@/lib/server/providers/youtube";
import type { ProviderExtractResult } from "@/lib/server/providers/types";
import { testCapabilities, testSettingConstraints } from "@/tests/provider-fixtures";

const providerContext = { requestId: "test-request" };
const mockedFetchJson = vi.mocked(fetchJson);
const mockedFetchText = vi.mocked(fetchText);
const mockedReadResponseText = vi.mocked(readResponseText);
const mockedSafeFetch = vi.mocked(safeFetch);
const originalSpotmateFlag = process.env.COCAT_ENABLE_SPOTMATE;
const originalYtdownFlag = process.env.COCAT_ENABLE_YTDOWN;
const originalYtdownCookie = process.env.COCAT_YTDOWN_COOKIE;

describe("platform providers", () => {
  beforeEach(() => {
    delete process.env.COCAT_ENABLE_SPOTMATE;
    delete process.env.COCAT_ENABLE_YTDOWN;
    delete process.env.COCAT_YTDOWN_COOKIE;
    mockedFetchJson.mockReset();
    mockedFetchText.mockReset();
    mockedReadResponseText.mockReset();
    mockedReadResponseText.mockImplementation(readMockResponseText);
    mockedSafeFetch.mockReset();
  });

  afterEach(() => {
    if (originalSpotmateFlag) {
      process.env.COCAT_ENABLE_SPOTMATE = originalSpotmateFlag;
    } else {
      delete process.env.COCAT_ENABLE_SPOTMATE;
    }

    if (originalYtdownFlag) {
      process.env.COCAT_ENABLE_YTDOWN = originalYtdownFlag;
    } else {
      delete process.env.COCAT_ENABLE_YTDOWN;
    }

    if (originalYtdownCookie) {
      process.env.COCAT_YTDOWN_COOKIE = originalYtdownCookie;
    } else {
      delete process.env.COCAT_YTDOWN_COOKIE;
    }
  });

  it("extracts Vimeo progressive files from the player config", async () => {
    mockedFetchText.mockResolvedValue("<html><title>Fallback</title></html>");
    mockedFetchJson.mockResolvedValue({
      video: {
        title: "Vimeo Launch",
        duration: 42,
        owner: { name: "CoCat Labs" },
        thumbs: {
          "640": "https://i.vimeocdn.com/video/640.jpg"
        }
      },
      request: {
        files: {
          progressive: [
            {
              url: "https://player.vimeo.com/progressive/video.mp4",
              mime: "video/mp4",
              quality: "720p",
              width: 1280,
              height: 720,
              fps: 30
            }
          ]
        }
      }
    });

    const result = await vimeoProvider.extract(new URL("https://vimeo.com/123456"), providerContext);

    expect(result.title).toBe("Vimeo Launch");
    expect(result.options[0]).toMatchObject({
      mode: "video",
      quality: "720p",
      media: {
        transport: "direct",
        url: "https://player.vimeo.com/progressive/video.mp4"
      }
    });
  });

  it("extracts Reddit hosted video and preview images from listing JSON", async () => {
    mockedFetchJson.mockResolvedValue([
      {
        data: {
          children: [
            {
              data: {
                id: "abc123",
                title: "Reddit Clip",
                author: "poster",
                secure_media: {
                  reddit_video: {
                    fallback_url: "https://v.redd.it/abc/DASH_720.mp4?source=fallback&amp;foo=1",
                    height: 720,
                    width: 1280,
                    duration: 12
                  }
                },
                preview: {
                  images: [
                    {
                      source: {
                        url: "https://preview.redd.it/thumb.jpg?width=960&amp;crop=smart"
                      }
                    }
                  ]
                }
              }
            }
          ]
        }
      }
    ]);

    const result = await redditProvider.extract(
      new URL("https://www.reddit.com/r/videos/comments/abc123/reddit_clip/"),
      providerContext
    );

    expect(result.author).toBe("u/poster");
    expect(result.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "video",
          quality: "720p",
          media: expect.objectContaining({
            url: "https://v.redd.it/abc/DASH_720.mp4?source=fallback&foo=1"
          })
        }),
        expect.objectContaining({
          mode: "photo",
          media: expect.objectContaining({
            url: "https://preview.redd.it/thumb.jpg?width=960&crop=smart"
          })
        })
      ])
    );
  });

  it("extracts X syndication video variants", async () => {
    mockedFetchJson.mockResolvedValue({
      text: "Demo tweet",
      user: {
        screen_name: "cocat"
      },
      mediaDetails: [
        {
          type: "video",
          media_url_https: "https://pbs.twimg.com/media/thumb.jpg",
          sizes: {
            large: {
              w: 1280,
              h: 720
            }
          },
          video_info: {
            variants: [
              {
                bitrate: 2176000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/123/720.mp4"
              }
            ]
          }
        }
      ]
    });

    const result = await xProvider.extract(new URL("https://x.com/cocat/status/123456789"), providerContext);

    expect(result.author).toBe("@cocat");
    expect(result.options[0]).toMatchObject({
      bitrateKbps: 2176,
      mode: "video",
      media: {
        headers: {
          accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          range: "bytes=0-",
          referer: "https://x.com/cocat/status/123456789"
        },
        url: "https://video.twimg.com/ext_tw_video/123/720.mp4"
      }
    });
  });

  it("extracts YouTube formats through optional YTDown scraper", async () => {
    process.env.COCAT_ENABLE_YTDOWN = "true";
    process.env.COCAT_YTDOWN_COOKIE = "cf_clearance=ok; PHPSESSID=session";
    mockedSafeFetch.mockImplementation(async (input, init) => {
      expect(input.toString()).toBe("https://app.ytdown.to/proxy.php");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        cookie: "cf_clearance=ok; PHPSESSID=session",
        "content-type": "application/x-www-form-urlencoded"
      });
      expect(init?.body?.toString()).toBe("url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123");

      return jsonResponse({
        api: {
          duration: "1:05",
          mediaItems: [
            {
              mediaExtension: "mp4",
              mediaFileSize: "12.5 MB",
              mediaRes: "1920x1080",
              mediaUrl: "https://app.ytdown.to/task/video-1080",
              type: "Video"
            },
            {
              mediaExtension: "mp3",
              mediaFileSize: "3 MB",
              mediaQuality: "128 kbps",
              mediaUrl: "https://app.ytdown.to/task/audio-128",
              type: "Audio"
            }
          ],
          thumbnail: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
          title: "YTDown Clip"
        }
      });
    });

    const result = await youtubeProvider.extract(new URL("https://www.youtube.com/watch?v=abc123"), providerContext);

    expect(result.title).toBe("YTDown Clip");
    expect(result.durationSeconds).toBe(65);
    expect(result.options[0]).toMatchObject({
      id: "youtube:ytdown:video:0",
      extension: "mp4",
      mode: "video",
      quality: "1080p",
      requiresFfmpeg: false,
      sizeBytes: 13_107_200,
      media: {
        headers: {
          cookie: "cf_clearance=ok; PHPSESSID=session"
        },
        url: "https://app.ytdown.to/task/video-1080"
      }
    });
  });

  it("surfaces YTDown Cloudflare errors when the optional scraper is enabled", async () => {
    process.env.COCAT_ENABLE_YTDOWN = "true";
    mockedSafeFetch.mockResolvedValue({
      headers: {
        get: () => null,
        getSetCookie: () => []
      },
      ok: false,
      status: 403,
      text: async () => "<html><title>Just a moment...</title><div>challenge-platform</div></html>"
    } as unknown as Response);

    await expect(youtubeProvider.extract(new URL("https://www.youtube.com/watch?v=abc123"), providerContext))
      .rejects
      .toMatchObject({
        code: "AUTH_REQUIRED",
        message: expect.stringContaining("COCAT_YTDOWN_COOKIE")
      });
  });

  it("does not fall back to Innertube when enabled YTDown returns no downloadable formats", async () => {
    process.env.COCAT_ENABLE_YTDOWN = "true";
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      api: {
        mediaItems: [],
        title: "No formats"
      }
    }));

    await expect(youtubeProvider.extract(new URL("https://www.youtube.com/watch?v=abc123"), providerContext))
      .rejects
      .toMatchObject({
        code: "UNSUPPORTED_MEDIA",
        message: expect.stringContaining("YTDown")
      });
    expect(mockedFetchText).not.toHaveBeenCalled();
  });

  it("resolves YouTube YTDown downloads by polling for a completed file", async () => {
    process.env.COCAT_ENABLE_YTDOWN = "true";
    mockedSafeFetch.mockResolvedValue(jsonResponse({
      api: {
        fileName: "YTDown Clip.mp4",
        fileUrl: "https://cdn.ytdown.to/downloads/clip.mp4",
        status: "completed"
      }
    }));
    const source: ProviderExtractResult = {
      providerId: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      title: "YTDown Clip",
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      options: [
        {
          id: "youtube:ytdown:video:0",
          label: "YTDown 1080p video MP4",
          mode: "video",
          extension: "mp4",
          mimeType: "video/mp4",
          media: {
            transport: "direct",
            url: "https://app.ytdown.to/task/video-1080",
            mimeType: "video/mp4"
          }
        }
      ]
    };

    const resolved = await youtubeProvider.resolve(
      source,
      "youtube:ytdown:video:0",
      providerContext,
      DEFAULT_PROCESSING_SETTINGS
    );

    expect(resolved).toMatchObject({
      extension: "mp4",
      fileName: "YTDown Clip.mp4",
      mimeType: "video/mp4",
      requiresFfmpeg: false,
      url: "https://cdn.ytdown.to/downloads/clip.mp4"
    });
  });

  it("refreshes X media URLs during resolve", async () => {
    mockedFetchJson
      .mockResolvedValueOnce({
        text: "Old tweet",
        mediaDetails: [
          {
            type: "video",
            video_info: {
              variants: [
                {
                  bitrate: 832000,
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/ext_tw_video/123/old.mp4"
                }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "Fresh tweet",
        mediaDetails: [
          {
            type: "video",
            video_info: {
              variants: [
                {
                  bitrate: 832000,
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/ext_tw_video/123/fresh.mp4"
                }
              ]
            }
          }
        ]
      });

    const source = await xProvider.extract(new URL("https://x.com/cocat/status/123456789"), providerContext);
    const resolved = await xProvider.resolve(source, "x:video:0:0", providerContext, DEFAULT_PROCESSING_SETTINGS);

    expect(resolved.url).toBe("https://video.twimg.com/ext_tw_video/123/fresh.mp4");
    expect(resolved.headers).toMatchObject({
      range: "bytes=0-",
      referer: "https://x.com/cocat/status/123456789"
    });
  });

  it("extracts Bilibili DASH video and audio streams from embedded playinfo", async () => {
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <html>
        <head><title>Fallback Bili title</title></head>
        <script>
          window.__INITIAL_STATE__ = {
            "videoData": {
              "title": "Bilibili Launch",
              "bvid": "BV1cocat",
              "cid": 24680,
              "duration": 62,
              "pic": "//i0.hdslb.com/bfs/archive/thumb.jpg",
              "owner": { "name": "CoCat Creator" }
            }
          };
        </script>
        <script>
          window.__playinfo__ = {
            "data": {
              "timelength": 62000,
              "quality": 80,
              "accept_quality": [80],
              "accept_description": ["1080P"],
              "dash": {
                "video": [
                  {
                    "id": 80,
                    "baseUrl": "https://upos-sz-mirrorcos.bilivideo.com/video.m4s",
                    "bandwidth": 2176000,
                    "mimeType": "video/mp4",
                    "codecs": "avc1.640028",
                    "width": 1920,
                    "height": 1080,
                    "frameRate": "30"
                  }
                ],
                "audio": [
                  {
                    "id": 30280,
                    "baseUrl": "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s",
                    "bandwidth": 128000,
                    "mimeType": "audio/mp4",
                    "codecs": "mp4a.40.2"
                  }
                ]
              }
            }
          };
        </script>
      </html>
    `, ["buvid3=session-cookie; Path=/; Secure"]));

    const result = await bilibiliProvider.extract(new URL("https://www.bilibili.com/video/BV1cocat"), providerContext);

    expect(result.title).toBe("Bilibili Launch");
    expect(result.author).toBe("CoCat Creator");
    expect(result.thumbnailUrl).toBe("https://i0.hdslb.com/bfs/archive/thumb.jpg");
    expect(result.durationSeconds).toBe(62);
    expect(result.options[0]).toMatchObject({
      id: "bilibili:dash:embedded:0",
      bitrateKbps: 2176,
      hasAudio: true,
      isAdaptive: true,
      requiresFfmpeg: true,
      media: {
        audioUrl: "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s",
        headers: {
          cookie: "buvid3=session-cookie",
          range: "bytes=0-",
          referer: "https://www.bilibili.com/video/BV1cocat"
        },
        url: "https://upos-sz-mirrorcos.bilivideo.com/video.m4s"
      }
    });
  });

  it("extracts Spotify audio previews from embedded page data", async () => {
    const previewUrl = "https://p.scdn.co/mp3-preview/demo-preview?cid=123";
    mockedFetchText.mockResolvedValue(`
      <html>
        <head><title>Demo Song | Spotify</title></head>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "state": {
                  "data": {
                    "entity": {
                      "audioPreview": {
                        "url": "${previewUrl}"
                      }
                    }
                  }
                }
              }
            }
          }
        </script>
      </html>
    `);
    mockedFetchJson.mockResolvedValue({
      title: "Demo Song | Spotify",
      thumbnail_url: "https://i.scdn.co/image/cover"
    });

    const result = await spotifyProvider.extract(new URL("https://open.spotify.com/track/demo"), providerContext);

    expect(result.title).toBe("Demo Song");
    expect(result.thumbnailUrl).toBe("https://i.scdn.co/image/cover");
    expect(result.options[0]).toMatchObject({
      extension: "mp3",
      mode: "audio",
      media: {
        headers: {
          accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
          referer: "https://open.spotify.com/track/demo"
        },
        url: previewUrl
      }
    });
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("uses a matched Apple preview when Spotify does not expose preview audio", async () => {
    const previewUrl = "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview.m4a";

    mockedFetchText.mockResolvedValue(`
      <html>
        <head>
          <title>Quiet Track | Spotify</title>
          <meta name="author" content="CoCat Artist" />
        </head>
      </html>
    `);
    mockedFetchJson.mockImplementation(async (input) => {
      const url = input.toString();

      if (url.startsWith("https://open.spotify.com/oembed")) {
        return {
          title: "Quiet Track | Spotify",
          thumbnail_url: "https://i.scdn.co/image/quiet"
        };
      }

      if (url.startsWith("https://itunes.apple.com/search")) {
        return {
          results: [
            {
              artistName: "CoCat Artist",
              previewUrl,
              trackId: 123,
              trackName: "Quiet Track",
              trackViewUrl: "https://music.apple.com/us/album/quiet-track/123"
            }
          ]
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await spotifyProvider.extract(new URL("https://open.spotify.com/track/quiet"), providerContext);

    expect(result.options[0]).toMatchObject({
      id: "spotify:itunes-preview:123",
      extension: "m4a",
      label: "Matched Apple preview",
      mode: "audio",
      quality: "Preview",
      media: {
        url: previewUrl
      }
    });
    expect(result.debug).toMatchObject({
      matchedPreviewCount: 1
    });
  });

  it("adds a Spotmate full-track option for Spotify tracks", async () => {
    process.env.COCAT_ENABLE_SPOTMATE = "true";
    mockedFetchText.mockResolvedValue("<html><head><title>Fallback | Spotify</title></head></html>");
    mockedFetchJson.mockImplementation(async () => {
      return {
        title: "Fallback | Spotify",
        thumbnail_url: "https://i.scdn.co/image/fallback"
      };
    });
    mockedSafeFetch.mockImplementation(async (input, init) => {
      const url = input.toString();

      if (url === "https://spotmate.online/en1") {
        return textResponseWithCookies('<meta name="csrf-token" content="csrf-token" />', ["spotmate=session; Path=/"]);
      }

      if (url === "https://spotmate.online/getTrackData") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "x-csrf-token": "csrf-token",
          cookie: "spotmate=session"
        });
        expect(JSON.parse(init?.body?.toString() ?? "{}")).toEqual({
          spotify_url: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"
        });

        return jsonResponse({
          type: "track",
          id: "4OWa2dOlmtvMDhFrFL0QA1",
          name: "La lecon particuliere",
          duration_ms: 105_560,
          artists: [{ name: "Francis Lai" }, { name: "Christian Gaubert" }],
          album: {
            images: [{ url: "https://i.scdn.co/image/cover" }]
          },
          external_urls: {
            spotify: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"
          }
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await spotifyProvider.extract(
      new URL("https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"),
      providerContext
    );

    expect(result.title).toBe("La lecon particuliere");
    expect(result.author).toBe("Francis Lai, Christian Gaubert");
    expect(result.durationSeconds).toBe(106);
    expect(result.options[0]).toMatchObject({
      id: "spotify:spotmate:4OWa2dOlmtvMDhFrFL0QA1:mp3",
      extension: "mp3",
      label: "Spotify full track",
      mode: "audio",
      media: {
        url: "https://spotmate.online/convert"
      }
    });
  });

  it("resolves Spotify full-track downloads through Spotmate immediate conversion links", async () => {
    mockedSafeFetch.mockImplementation(async (input, init) => {
      const url = input.toString();

      if (url === "https://spotmate.online/en1") {
        return textResponseWithCookies('<meta name="csrf-token" content="csrf-token" />', ["spotmate=session; Path=/"]);
      }

      if (url === "https://spotmate.online/convert") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body?.toString() ?? "{}")).toEqual({
          urls: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"
        });

        return jsonResponse({
          error: false,
          url: "https://rapid.dlapi.app/download/tracks/683427?format=mp3"
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const source: ProviderExtractResult = {
      providerId: "spotify",
      sourceUrl: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1",
      title: "Spotmate Track",
      durationSeconds: 120,
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      debug: {
        spotmateTrackUrl: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"
      },
      options: [
        {
          id: "spotify:spotmate:4OWa2dOlmtvMDhFrFL0QA1:mp3",
          label: "Spotify full track",
          mode: "audio",
          extension: "mp3",
          media: {
            transport: "direct",
            url: "https://spotmate.online/convert"
          }
        }
      ]
    };

    const resolved = await spotifyProvider.resolve(
      source,
      "spotify:spotmate:4OWa2dOlmtvMDhFrFL0QA1:mp3",
      providerContext,
      DEFAULT_PROCESSING_SETTINGS
    );

    expect(resolved).toMatchObject({
      transport: "direct",
      url: "https://rapid.dlapi.app/download/tracks/683427?format=mp3",
      extension: "mp3",
      mimeType: "audio/mpeg",
      requiresFfmpeg: false
    });
  });

  it("polls Spotmate task conversions when the full-track download is queued", async () => {
    mockedSafeFetch.mockImplementation(async (input) => {
      const url = input.toString();

      if (url === "https://spotmate.online/en1") {
        return textResponseWithCookies('<meta name="csrf-token" content="csrf-token" />', []);
      }

      if (url === "https://spotmate.online/convert") {
        return jsonResponse({
          error: false,
          task_id: "task-1"
        });
      }

      throw new Error(`Unexpected URL ${url}`);
    });
    mockedFetchJson.mockImplementation(async (input) => {
      const url = input.toString();

      if (url === "https://spotmate.online/tasks/task-1") {
        return {
          error: false,
          data: {
            status: "finished",
            result: {
              download_url: "https://rapid.dlapi.app/download/tracks/task-result?format=mp3"
            }
          }
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    });

    const source: ProviderExtractResult = {
      providerId: "spotify",
      sourceUrl: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1",
      title: "Spotmate Track",
      durationSeconds: 120,
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      debug: {
        spotmateTrackUrl: "https://open.spotify.com/track/4OWa2dOlmtvMDhFrFL0QA1"
      },
      options: [
        {
          id: "spotify:spotmate:4OWa2dOlmtvMDhFrFL0QA1:mp3",
          label: "Spotify full track",
          mode: "audio",
          extension: "mp3",
          media: {
            transport: "direct",
            url: "https://spotmate.online/convert"
          }
        }
      ]
    };

    const resolved = await spotifyProvider.resolve(
      source,
      "spotify:spotmate:4OWa2dOlmtvMDhFrFL0QA1:mp3",
      providerContext,
      DEFAULT_PROCESSING_SETTINGS
    );

    expect(resolved).toMatchObject({
      transport: "direct",
      url: "https://rapid.dlapi.app/download/tracks/task-result?format=mp3",
      extension: "mp3",
      mimeType: "audio/mpeg",
      requiresFfmpeg: false
    });
  });

  it("rejects Spotify pages without exposed preview media", async () => {
    mockedFetchText.mockResolvedValue("<html><head><title>Quiet Track | Spotify</title></head></html>");
    mockedFetchJson.mockResolvedValue({
      title: "Quiet Track | Spotify"
    });

    await expect(
      spotifyProvider.extract(new URL("https://open.spotify.com/track/quiet"), providerContext)
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA"
    });
  });

  it("extracts TikTok video URLs from embedded state", async () => {
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <html>
        <head><meta property="og:title" content="TikTok clip" /></head>
        <script id="SIGI_STATE" type="application/json">
          {
            "ItemModule": {
              "1": {
                "desc": "Dancing robot",
                "uniqueId": "cocat",
                "video": {
                  "playAddr": "https://v16-webapp.tiktokcdn.com/video/tos/example.mp4",
                  "cover": "https://p16-sign.tiktokcdn-us.com/cover.jpeg"
                }
              }
            }
          }
        </script>
      </html>
    `, ["ttwid=session-cookie; Path=/; Secure"]));

    const result = await tiktokProvider.extract(new URL("https://www.tiktok.com/@cocat/video/123"), providerContext);

    expect(result.title).toBe("Dancing robot");
    expect(result.thumbnailUrl).toBe("https://p16-sign.tiktokcdn-us.com/cover.jpeg");
    expect(result.options[0]).toMatchObject({
      mode: "video",
      media: {
        headers: {
          accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          cookie: "ttwid=session-cookie",
          range: "bytes=0-",
          referer: "https://www.tiktok.com/@cocat/video/123"
        },
        url: "https://v16-webapp.tiktokcdn.com/video/tos/example.mp4"
      }
    });
  });

  it("refreshes TikTok media URLs during resolve", async () => {
    const oldSource: ProviderExtractResult = {
      providerId: "tiktok",
      sourceUrl: "https://www.tiktok.com/@cocat/video/123",
      title: "Old TikTok clip",
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      options: [
        {
          id: "tiktok:video:0",
          label: "TikTok video",
          mode: "video",
          extension: "mp4",
          media: {
            transport: "direct",
            url: "https://v16-webapp.tiktokcdn.com/video/old.mp4"
          }
        }
      ]
    };
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <script id="SIGI_STATE" type="application/json">
        {
          "ItemModule": {
            "1": {
              "desc": "Fresh clip",
              "video": {
                "playAddr": "https://v16-webapp.tiktokcdn.com/video/fresh.mp4"
              }
            }
          }
        }
      </script>
    `, ["ttwid=fresh-cookie; Path=/; Secure"]));

    const resolved = await tiktokProvider.resolve(
      oldSource,
      "tiktok:video:0",
      providerContext,
      DEFAULT_PROCESSING_SETTINGS
    );

    expect(resolved.url).toBe("https://v16-webapp.tiktokcdn.com/video/fresh.mp4");
    expect(resolved.headers).toMatchObject({
      cookie: "ttwid=fresh-cookie",
      range: "bytes=0-",
      referer: "https://www.tiktok.com/@cocat/video/123"
    });
  });

  it("extracts Instagram media URLs from embedded JSON fragments", async () => {
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <html>
        <head><meta property="og:title" content="Instagram post" /></head>
        <script>
          {"video_url":"https:\\/\\/scontent.cdninstagram.com\\/video.mp4","display_url":"https:\\/\\/scontent.cdninstagram.com\\/image.png"}
        </script>
      </html>
    `, ["ig_did=session-cookie; Path=/; Secure"]));

    const result = await instagramProvider.extract(new URL("https://www.instagram.com/p/example/"), providerContext);
    const imageOption = result.options.find((option) => option.mode === "photo");

    expect(result.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "video",
          media: expect.objectContaining({
            headers: expect.objectContaining({
              range: "bytes=0-",
              referer: "https://www.instagram.com/p/example/"
            }),
            url: "https://scontent.cdninstagram.com/video.mp4"
          })
        }),
        expect.objectContaining({
          extension: "png",
          mode: "photo",
          media: expect.objectContaining({
            headers: expect.objectContaining({
              accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
              range: "bytes=0-",
              referer: "https://www.instagram.com/p/example/"
            }),
            url: "https://scontent.cdninstagram.com/image.png"
          })
        })
      ])
    );
    expect(imageOption?.media.headers).not.toHaveProperty("cookie");
  });

  it("prefers Instagram nested video_versions over image fallback", async () => {
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <html>
        <head>
          <meta property="og:title" content="Instagram video post" />
          <meta property="og:image" content="https://scontent.cdninstagram.com/thumb.jpg" />
        </head>
        <script>
          {
            "items": [
              {
                "is_video": true,
                "video_versions": [
                  {
                    "height": 1920,
                    "url": "https:\\/\\/scontent.cdninstagram.com\\/o1\\/v\\/t16\\/f2\\/m69\\/clip.mp4?efg=demo\\u0026_nc_ht=scontent.cdninstagram.com",
                    "width": 1080
                  }
                ]
              }
            ]
          }
        </script>
      </html>
    `, ["ig_did=session-cookie; Path=/; Secure"]));

    const result = await instagramProvider.extract(new URL("https://www.instagram.com/reel/nested-video/"), providerContext);

    expect(result.options[0]).toMatchObject({
      extension: "mp4",
      mode: "video",
      media: {
        url: "https://scontent.cdninstagram.com/o1/v/t16/f2/m69/clip.mp4?efg=demo&_nc_ht=scontent.cdninstagram.com"
      }
    });
    expect(result.options.some((option) => option.mode === "photo")).toBe(false);
  });

  it("uses Instagram og:image fallback without exposing shell assets", async () => {
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <html>
        <head>
          <meta property="og:title" content="Instagram HEIC post" />
          <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51.82787-15/post.heic?stp=dst-jpg_e35_s640x640" />
        </head>
        <script>
          "https:\\/\\/static.cdninstagram.com\\/rsrc.php\\/yr\\/shell.webp"
          "https:\\/\\/scontent.cdninstagram.com\\/v\\/t51.2885-19\\/profile.jpg"
        </script>
      </html>
    `, ["ig_did=session-cookie; Path=/; Secure"]));

    const result = await instagramProvider.extract(new URL("https://www.instagram.com/p/heic-example/"), providerContext);

    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      extension: "jpg",
      label: "Instagram image",
      mode: "photo",
      media: {
        url: "https://scontent.cdninstagram.com/v/t51.82787-15/post.heic?stp=dst-jpg_e35_s640x640"
      }
    });
    expect(result.options[0]?.media.headers).not.toHaveProperty("cookie");
  });

  it("refreshes Instagram image URLs during resolve", async () => {
    const oldSource: ProviderExtractResult = {
      providerId: "instagram",
      sourceUrl: "https://www.instagram.com/p/example/",
      title: "Old Instagram image",
      capabilities: testCapabilities,
      settingConstraints: testSettingConstraints,
      options: [
        {
          id: "instagram:image:0",
          label: "Instagram image",
          mode: "photo",
          extension: "jpg",
          media: {
            transport: "direct",
            url: "https://scontent.cdninstagram.com/old.jpg"
          }
        }
      ]
    };
    mockedSafeFetch.mockResolvedValue(textResponseWithCookies(`
      <script>
        {"display_url":"https:\\/\\/scontent.cdninstagram.com\\/fresh.jpeg"}
      </script>
    `, ["ig_did=fresh-cookie; Path=/; Secure"]));

    const resolved = await instagramProvider.resolve(
      oldSource,
      "instagram:image:0",
      providerContext,
      DEFAULT_PROCESSING_SETTINGS
    );

    expect(resolved.url).toBe("https://scontent.cdninstagram.com/fresh.jpeg");
    expect(resolved.headers).toMatchObject({
      range: "bytes=0-",
      referer: "https://www.instagram.com/p/example/"
    });
    expect(resolved.headers).not.toHaveProperty("cookie");
  });

  it("extracts SoundCloud public stream references from hydration state", async () => {
    mockedFetchText.mockResolvedValue(`
      <html>
        <script>
          window.__sc_hydration = [
            {
              "hydratable": "sound",
              "data": {
                "title": "SoundCloud Track",
                "media": {
                  "transcodings": [
                    { "url": "https://api.soundcloud.com/media/soundcloud:tracks:1/stream/hls" }
                  ]
                }
              }
            }
          ];
        </script>
      </html>
    `);
    mockedFetchJson.mockResolvedValue({
      title: "SoundCloud Track",
      author_name: "CoCat Audio",
      thumbnail_url: "https://i1.sndcdn.com/artworks.jpg"
    });

    const result = await soundcloudProvider.extract(new URL("https://soundcloud.com/cocat/track"), providerContext);

    expect(result.author).toBe("CoCat Audio");
    expect(result.options[0]).toMatchObject({
      mode: "audio",
      media: {
        url: "https://api.soundcloud.com/media/soundcloud:tracks:1/stream/hls"
      }
    });
  });
});

function textResponseWithCookies(body: string, cookies: string[]) {
  return {
    headers: {
      get: () => null,
      getSetCookie: () => cookies
    },
    ok: true,
    status: 200,
    text: async () => body
  } as unknown as Response;
}

function jsonResponse(body: unknown) {
  return {
    headers: {
      get: () => null,
      getSetCookie: () => []
    },
    ok: true,
    status: 200,
    json: async () => body
  } as unknown as Response;
}

async function readMockResponseText(response: Response) {
  const readableResponse = response as Response & {
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  };

  if (typeof readableResponse.text === "function") {
    return readableResponse.text();
  }

  if (typeof readableResponse.json === "function") {
    return JSON.stringify(await readableResponse.json());
  }

  return "";
}
