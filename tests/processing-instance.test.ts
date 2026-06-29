import { rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRequestBodyWithinLimit,
  assertUploadFilesWithinLimit,
  createProcessingTempDir,
  processingTempRoot,
  withProcessingSlot
} from "@/lib/server/processing-instance";

const originalMaxActiveRemuxJobs = process.env.COCAT_MAX_ACTIVE_REMUX_JOBS;
const originalMaxUploadBytes = process.env.COCAT_MAX_UPLOAD_BYTES;
const originalTempDir = process.env.COCAT_TEMP_DIR;

describe("processing instance", () => {
  afterEach(async () => {
    restoreEnv("COCAT_MAX_ACTIVE_REMUX_JOBS", originalMaxActiveRemuxJobs);
    restoreEnv("COCAT_MAX_UPLOAD_BYTES", originalMaxUploadBytes);
    restoreEnv("COCAT_TEMP_DIR", originalTempDir);
    await rm(path.join(process.cwd(), ".tmp-cocat-tests"), { recursive: true, force: true });
  });

  it("requires upload requests to declare content length", () => {
    expect(() => assertRequestBodyWithinLimit(new Request("https://example.test/remux"))).toThrowError(
      /content length/i
    );
  });

  it("rejects uploads beyond the configured byte limit", () => {
    process.env.COCAT_MAX_UPLOAD_BYTES = "1048576";

    expect(() =>
      assertRequestBodyWithinLimit(requestWithContentLength("1048577"))
    ).toThrowError(/limited/i);
  });

  it("validates file sizes and upload extensions", () => {
    process.env.COCAT_MAX_UPLOAD_BYTES = "1048576";

    expect(() => assertUploadFilesWithinLimit([new File(["1234"], "clip.mp4")])).not.toThrow();
    expect(() => assertUploadFilesWithinLimit([new File(["1234"], "clip.exe")])).toThrowError(/not supported/i);
    expect(() => assertUploadFilesWithinLimit([new File([new Uint8Array(1048577)], "clip.mp4")])).toThrowError(/limited/i);
  });

  it("caps concurrent remux processing slots", async () => {
    process.env.COCAT_MAX_ACTIVE_REMUX_JOBS = "1";
    let releaseFirstSlot: (() => void) | undefined;
    const firstTask = withProcessingSlot("remux", () => new Promise<void>((resolve) => {
      releaseFirstSlot = resolve;
    }));

    await expect(withProcessingSlot("remux", async () => undefined)).rejects.toMatchObject({
      code: "JOB_LIMIT_REACHED"
    });

    releaseFirstSlot?.();
    await firstTask;
    await expect(withProcessingSlot("remux", async () => "ok")).resolves.toBe("ok");
  });

  it("creates processing temp folders inside the configured root", async () => {
    process.env.COCAT_TEMP_DIR = path.join(process.cwd(), ".tmp-cocat-tests");
    const workDir = await createProcessingTempDir("remux");

    expect(path.relative(processingTempRoot(), workDir)).not.toMatch(/^\.\./);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function requestWithContentLength(contentLength: string) {
  return {
    headers: new Headers({
      "content-length": contentLength
    })
  } as Request;
}
