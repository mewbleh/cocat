# CoCat

<p align="center">
  <img src="app/icon.svg" alt="CoCat favicon" width="96" height="96" />
</p>

CoCat is a self-hostable media downloader built with Next.js App Router. It inspects public media URLs, shows the formats it can safely download, and keeps download jobs short-lived and in memory.

Self-hosted, cleanly queued.

CoCat does not bundle or shell out to `yt-dlp` or `youtube-dl`. It uses provider-specific extractors, public page metadata, manifest parsers, and `ffmpeg` only when a stream needs merging, remuxing, or transcoding.

## What It Supports

- YouTube, TikTok, Instagram, X/Twitter, Reddit, Spotify previews, SoundCloud, Vimeo, Bilibili, Pinterest, Facebook, Threads, Bluesky, Tumblr, Dailymotion, Streamable, Imgur, Twitch, Kick, Rumble, Flickr, Mastodon, Pixelfed, and direct media URLs
- Direct files, HLS playlists, DASH manifests, image posts, audio previews, and local remux jobs
- Browser-local processing preferences for quality caps, output containers, codecs, audio format, filename templates, and debug details
- Optional API token auth for private instances
- Browser-local custom server settings, so the UI can point at a separate self-hosted CoCat API
- Docker production image with `ffmpeg` installed

## Quick Start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

For production, set `COCAT_TOKEN_SECRET` to a long random value. CoCat refuses to run in production without it.

## Using Another Server

The Server tab lets this browser use a different CoCat API instance.

- Leave the server URL empty to use the current origin.
- Enter a base URL such as `https://cocat.example.com` to use a remote API.
- If the remote API sets `COCAT_ACCESS_TOKEN`, enter that same token in the Server tab.
- If the UI and API are on different origins, set `COCAT_ALLOWED_ORIGINS` on the API server.

Example private API config:

```bash
COCAT_TOKEN_SECRET="$(openssl rand -hex 32)"
COCAT_ACCESS_TOKEN="$(openssl rand -hex 24)"
COCAT_ALLOWED_ORIGINS="https://app.example.com"
```

The server token is stored only in this browser's local settings. Anyone self-hosting CoCat should still put the app behind normal HTTPS and host-level security.

## Custom Instance Setup

Use this when you want one CoCat UI to talk to your own secured API server.

1. Deploy or run a CoCat server with Docker:

```bash
docker build -t cocat .
docker run --rm -p 3000:3000 \
  -e COCAT_TOKEN_SECRET="$(openssl rand -hex 32)" \
  -e COCAT_ACCESS_TOKEN="$(openssl rand -hex 24)" \
  cocat
```

2. If the UI is hosted on a different origin, allow that UI origin on the API server:

```bash
COCAT_ALLOWED_ORIGINS="https://app.example.com"
```

3. Open CoCat in the browser, go to the Server tab, and enter:

| Field | Value |
| --- | --- |
| CoCat server URL | Your API base URL, for example `https://api.example.com` |
| Access token | The same value as `COCAT_ACCESS_TOKEN` |

4. Click Check, then Save.

Recommended production env:

```bash
COCAT_TOKEN_SECRET="long-random-signing-secret"
COCAT_ACCESS_TOKEN="private-api-token"
COCAT_ALLOWED_ORIGINS="https://your-ui-domain.example"
COCAT_TEMP_DIR="/tmp/cocat"
```

Optional Spotify converter:

```bash
COCAT_ENABLE_SPOTMATE="true"
```

By default, Spotify support uses public Spotify preview audio when it exists and a matched Apple preview fallback when Spotify does not expose a preview. Some tracks do not expose any public preview. Enabling `COCAT_ENABLE_SPOTMATE` adds the optional Spotmate converter path for self-hosted instances.

## ffmpeg

CoCat can download direct MP4, WebM, audio, and image files without `ffmpeg`. It needs `ffmpeg` when a selected format is HLS/DASH, video-only plus audio-only, remuxed, transcoded, or forced through the ffmpeg stream setting.

Install it locally before running development downloads that need processing:

```bash
ffmpeg -version
```

If that command fails, install ffmpeg and make sure it is available in the server process `PATH`. The Docker image already includes it.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `COCAT_TOKEN_SECRET` | generated in dev | Required in production. Signs short-lived source tokens. |
| `COCAT_ACCESS_TOKEN` | unset | Optional bearer token for extract, job, remux, and health APIs. |
| `COCAT_ALLOWED_ORIGINS` | unset | Comma-separated origins allowed to call the API cross-origin. |
| `COCAT_MAX_ACTIVE_JOBS` | `3` | Maximum queued or running download jobs. |
| `COCAT_MAX_ACTIVE_REMUX_JOBS` | `1` | Maximum concurrent local remux jobs. |
| `COCAT_MAX_SOURCE_TOKENS` | `200` | Maximum extracted source records kept in memory. |
| `COCAT_MAX_STORED_JOBS` | `100` | Maximum job records kept in memory. |
| `COCAT_MAX_UPLOAD_BYTES` | `536870912` | Local remux upload limit in bytes. |
| `COCAT_MAX_UPSTREAM_BODY_BYTES` | `10485760` | Maximum upstream HTML, JSON, or manifest body read into memory. |
| `COCAT_JOB_TTL_SECONDS` | `900` | How long completed jobs and temp files remain available. |
| `COCAT_SOURCE_TTL_SECONDS` | `600` | How long extracted source tokens remain valid. |
| `COCAT_REQUEST_TIMEOUT_MS` | `12000` | Timeout for upstream provider requests. |
| `COCAT_TEMP_DIR` | system temp + `cocat` | Directory for processed downloads and remux output. |
| `COCAT_ENABLE_SPOTMATE` | `false` | Optional Spotify full-track converter path. |

## Docker

```bash
docker build -t cocat .
docker run --rm -p 3000:3000 \
  -e COCAT_TOKEN_SECRET="$(openssl rand -hex 32)" \
  cocat
```

The container runs as a non-root user, stores temporary files under `/tmp/cocat`, exposes `/api/health`, and includes `ffmpeg`.

## Deployments

CoCat is easiest to deploy on platforms that can build and run the root `Dockerfile`. The Docker image already includes `ffmpeg`, uses the `PORT` environment variable, binds to `0.0.0.0`, and serves the Next.js standalone server.

Minimum production variables:

```bash
COCAT_TOKEN_SECRET="replace-with-a-long-random-secret"
```

Recommended private instance variables:

```bash
COCAT_TOKEN_SECRET="replace-with-a-long-random-secret"
COCAT_ACCESS_TOKEN="replace-with-a-private-api-token"
COCAT_ALLOWED_ORIGINS="https://your-ui-domain.example"
```

Set `COCAT_ALLOWED_ORIGINS` only when the browser UI and API are on different origins. If they are served from the same deployed CoCat app, leave it empty.

### Railway

Railway automatically uses a root `Dockerfile` when it finds one in the repository. See the official [Railway Dockerfile docs](https://docs.railway.com/builds/dockerfiles).

1. Create a Railway project from your GitHub repository.
2. Confirm the service is using the root `Dockerfile`.
3. Add `COCAT_TOKEN_SECRET` in the service Variables tab.
4. Add `COCAT_ACCESS_TOKEN` if the instance should be private.
5. Deploy the service.
6. In Settings -> Networking -> Public Networking, generate a Railway domain or attach a custom domain. See [Railway public networking](https://docs.railway.com/networking/public-networking).
7. Open `https://your-domain/api/health` to confirm the app can start and see `ffmpeg`.

Railway variables are available to the build and running service, and Railway can suggest values from `.env.example`. See [Railway variables](https://docs.railway.com/variables).

### Render

Render supports Docker-based web services and runtime environment variables. See [Docker on Render](https://render.com/docs/docker) and [Render web services](https://render.com/docs/web-services).

1. Create a new Render Web Service from the repository.
2. Select Docker as the runtime if Render does not auto-detect the Dockerfile.
3. Add `COCAT_TOKEN_SECRET` under Environment.
4. Add `COCAT_ACCESS_TOKEN` for a private instance.
5. Set the health check path to `/api/health`.
6. Deploy and open the generated `onrender.com` URL or your custom domain.

Render web services should bind to `0.0.0.0` and use `PORT`; the Dockerfile already does this. Render's default port is `10000`, but the app reads whatever `PORT` Render provides.

### Other PaaS Hosts

Use the Dockerfile path for Fly.io, Northflank, Koyeb, DigitalOcean App Platform, Coolify, Dokploy, or any host that can run a container.

Checklist:

- Build from the root `Dockerfile`.
- Set `COCAT_TOKEN_SECRET`.
- Set `COCAT_ACCESS_TOKEN` if the instance should not be public.
- Route external HTTP traffic to the container's `PORT`.
- Keep `HOSTNAME=0.0.0.0`.
- Use `/api/health` as the health check path.
- Avoid relying on persistent local storage; CoCat jobs, source tokens, and temp files are intentionally short-lived.
- If you deploy without Docker, install `ffmpeg` on the server image or processing-heavy downloads will fail.

## Security Model

CoCat treats pasted URLs and uploaded files as untrusted input.

- URL fetching validates public `http` and `https` URLs and blocks private, loopback, link-local, multicast, and reserved IP ranges.
- Upstream requests use manual redirect handling and DNS-pinned dispatchers.
- Source tokens are signed, short-lived, stored in memory, and capped.
- Jobs are short-lived, stored in memory, capped, and cleaned after expiry.
- Remux uploads require declared content length, known media extensions, and configured size limits.
- Upstream HTML, JSON, and manifests are size-limited and timeout-bound.
- QuickJS player evaluation uses runtime limits.

`COCAT_ACCESS_TOKEN` is instance-level API protection. It is not a multi-user account system, quota system, or replacement for normal server security.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the full verification set:

```bash
pnpm verify
```

Run browser tests:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Useful paths:

- `app/api` - API routes
- `components` - client UI
- `lib/server/providers` - provider extractors and resolvers
- `lib/server/jobs.ts` - in-memory download queue
- `lib/server/ffmpeg.ts` - ffmpeg processing
- `lib/server/remux.ts` - local remux workflow
- `tests` - unit and integration tests

## Notes

Providers can change markup, public APIs, and media delivery behavior without warning. When a provider stops exposing public media, CoCat should fail cleanly instead of trying unsafe fallbacks.

Use CoCat for content you have permission to access and save.
