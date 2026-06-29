import { describe, expect, it } from "vitest";

import { isBlockedIpAddress, validatePublicUrl } from "@/lib/server/url-safety";

describe("url safety", () => {
  it("accepts public http and https URLs", async () => {
    const url = await validatePublicUrl("https://example.com/video.mp4", {
      resolveHostname: async () => ["93.184.216.34"]
    });

    expect(url.href).toBe("https://example.com/video.mp4");
  });

  it("rejects private host resolutions", async () => {
    await expect(
      validatePublicUrl("https://media.example.test/file.mp4", {
        resolveHostname: async () => ["192.168.1.10"]
      })
    ).rejects.toMatchObject({ code: "PRIVATE_NETWORK_BLOCKED" });
  });

  it("rejects embedded credentials", async () => {
    await expect(
      validatePublicUrl("https://user:pass@example.com/file.mp4", {
        resolveHostname: async () => ["93.184.216.34"]
      })
    ).rejects.toMatchObject({ code: "INVALID_URL" });
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.1.1",
    "192.168.1.4",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1"
  ])(
    "blocks %s",
    (address) => {
      expect(isBlockedIpAddress(address)).toBe(true);
    }
  );
});
