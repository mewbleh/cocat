import { expect, test } from "@playwright/test";

test("downloads through the mocked happy path", async ({ page }) => {
  await page.route("**/api/extract", async (route) => {
    await route.fulfill({
      json: {
        media: {
          sourceToken: "source-token",
          providerId: "direct",
          title: "Demo clip",
          thumbnailUrl: "https://example.test/thumb.jpg",
          durationSeconds: 12,
          sourceUrl: "https://example.test/demo.mp4",
          recommendedOptionId: "direct:mp4",
          capabilities: {
            directDownload: true,
            hls: false,
            dash: false,
            adaptive: false,
            audioOnly: false,
            subtitles: false,
            thumbnails: true,
            requiresFfmpeg: false,
            notes: []
          },
          settingConstraints: {
            qualityCaps: ["best", "1080p", "720p", "480p", "360p"],
            outputContainers: ["auto", "mp4", "webm", "mkv", "mp3", "m4a", "opus"],
            audioFormats: ["mp3", "m4a", "opus", "original"],
            codecPreferences: ["auto", "h264", "vp9", "av1", "aac", "opus", "copy"]
          },
          options: [
            {
              id: "direct:mp4",
              label: "Original file",
              mode: "video",
              extension: "mp4",
              mimeType: "video/mp4",
              sizeBytes: 1024
            }
          ]
        }
      }
    });
  });

  await page.route("**/api/jobs", async (route) => {
    await route.fulfill({
      status: 202,
      json: { jobId: "job-1" }
    });
  });

  await page.route("**/api/jobs/job-1/events", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"complete","jobId":"job-1","progress":100,"message":"Download ready","downloadUrl":"/api/jobs/job-1/file"}\n\n'
    });
  });

  await page.goto("/");
  await expect(page.getByLabel("Tool").getByRole("tab", { name: "Remux" })).toBeVisible();
  await page.getByLabel("Media URL").fill("https://example.test/demo.mp4");
  await page.getByRole("button", { name: "Inspect" }).click();
  const downloadDialog = page.getByRole("dialog", { name: "Download media" });
  await expect(downloadDialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo clip" })).toBeVisible();
  await expect(page.getByLabel("Processing mode").getByRole("tab", { name: "Remux" })).toBeVisible();
  await downloadDialog.getByRole("button", { name: "Download" }).click();
  await expect(downloadDialog.getByRole("link", { name: "Save file" })).toHaveAttribute("href", "/api/jobs/job-1/file");
});
