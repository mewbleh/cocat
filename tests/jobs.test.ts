import { afterEach, describe, expect, it, vi } from "vitest";

import { createDownloadJob, clearJobsForTests, streamJobFile, subscribeToJob } from "@/lib/server/jobs";
import type { JobProgressEvent } from "@/lib/contracts";
import type { ProviderExtractResult } from "@/lib/server/providers/types";
import { clearSourceStoreForTests, createSourceToken } from "@/lib/server/source-tokens";
import { testCapabilities, testSettingConstraints } from "@/tests/provider-fixtures";

const source: ProviderExtractResult = {
  providerId: "direct",
  sourceUrl: "https://example.com/video.mp4",
  title: "Video",
  durationSeconds: 10,
  capabilities: testCapabilities,
  settingConstraints: testSettingConstraints,
  options: [
    {
      id: "direct:mp4",
      label: "Original",
      mode: "video",
      extension: "mp4",
      mimeType: "video/mp4",
      media: {
        transport: "direct",
        url: "https://example.com/video.mp4",
        mimeType: "video/mp4"
      }
    }
  ]
};

const originalMaxStoredJobs = process.env.COCAT_MAX_STORED_JOBS;

describe("jobs", () => {
  afterEach(() => {
    restoreEnv("COCAT_MAX_STORED_JOBS", originalMaxStoredJobs);
    clearJobsForTests();
    clearSourceStoreForTests();
    vi.restoreAllMocks();
  });

  it("creates and completes direct proxy jobs", async () => {
    const events: JobProgressEvent[] = [];
    const sourceToken = createSourceToken(source);
    const jobId = await createDownloadJob({
      sourceToken,
      optionId: "direct:mp4",
      mode: "video"
    });

    subscribeToJob(jobId, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events.some((event) => event.type === "queued")).toBe(true);
    expect(events.some((event) => event.type === "complete" && event.downloadUrl === `/api/jobs/${jobId}/file`)).toBe(true);
  });

  it("keeps active jobs visible across route module reloads", async () => {
    vi.resetModules();
    const firstSourceTokenModule = await import("@/lib/server/source-tokens");
    const firstJobsModule = await import("@/lib/server/jobs");
    const sourceToken = firstSourceTokenModule.createSourceToken(source);
    const jobId = await firstJobsModule.createDownloadJob({
      sourceToken,
      optionId: "direct:mp4",
      mode: "video"
    });

    vi.resetModules();
    const secondJobsModule = await import("@/lib/server/jobs");
    const events: JobProgressEvent[] = [];
    secondJobsModule.subscribeToJob(jobId, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events.some((event) => event.type === "queued")).toBe(true);
    expect(events.some((event) => event.type === "complete")).toBe(true);
    secondJobsModule.clearJobsForTests();
    firstSourceTokenModule.clearSourceStoreForTests();
  });

  it("retries fallback media headers when the upstream rejects the primary request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(new Response("ok", { headers: { "content-length": "1234", "content-type": "video/mp4" } }));
    const retrySource: ProviderExtractResult = {
      ...source,
      sourceUrl: "https://93.184.216.34/video.mp4",
      options: [
        {
          ...source.options[0],
          media: {
            transport: "direct",
            url: "https://93.184.216.34/video.mp4",
            headers: {
              referer: "https://first.example/"
            },
            fallbackHeaders: [
              {
                referer: "https://second.example/"
              }
            ],
            mimeType: "video/mp4"
          }
        }
      ]
    };
    const sourceToken = createSourceToken(retrySource);
    const jobId = await createDownloadJob({
      sourceToken,
      optionId: "direct:mp4",
      mode: "video"
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const file = await streamJobFile(jobId);

    expect(file.mimeType).toBe("video/mp4");
    expect(file.sizeBytes).toBe(1234);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        referer: "https://second.example/"
      })
    });
  });

  it("evicts terminal jobs when the stored job cap is reached", async () => {
    process.env.COCAT_MAX_STORED_JOBS = "1";
    const firstToken = createSourceToken(source);
    const firstJobId = await createDownloadJob({
      sourceToken: firstToken,
      optionId: "direct:mp4",
      mode: "video"
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondToken = createSourceToken({ ...source, title: "Second video" });
    const secondJobId = await createDownloadJob({
      sourceToken: secondToken,
      optionId: "direct:mp4",
      mode: "video"
    });

    expect(secondJobId).not.toBe(firstJobId);
    expect(() => subscribeToJob(firstJobId, () => undefined)).toThrow("no longer exists");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
