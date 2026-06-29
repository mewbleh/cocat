import { describe, expect, it } from "vitest";

import { attachmentContentDisposition } from "@/lib/server/download-headers";

describe("download headers", () => {
  it("uses an ASCII filename fallback for Unicode names", () => {
    const header = attachmentContentDisposition("hello 😺 world.mp4");

    expect(() => new Headers({ "content-disposition": header })).not.toThrow();
    expect(header).toContain('filename="hello world.mp4"');
    expect(header).toContain("filename*=UTF-8''hello%20%F0%9F%98%BA%20world.mp4");
  });

  it("preserves the extension when the ASCII fallback would be empty", () => {
    const header = attachmentContentDisposition("猫.mp4");

    expect(() => new Headers({ "content-disposition": header })).not.toThrow();
    expect(header).toContain('filename="cocat-download.mp4"');
  });
});
