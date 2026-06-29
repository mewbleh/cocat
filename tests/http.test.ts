import { describe, expect, it } from "vitest";

import { readResponseText } from "@/lib/server/http";

describe("http response readers", () => {
  it("rejects upstream bodies beyond the configured reader limit", async () => {
    await expect(readResponseText(new Response("12345"), { maxBytes: 4 })).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE"
    });
  });

  it("times out when an upstream body stalls", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      }
    });

    await expect(readResponseText(new Response(stream), { timeoutMs: 1 })).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT"
    });
  });
});
