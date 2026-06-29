import { describe, expect, it } from "vitest";

import { evaluateWithQuickJs } from "@/lib/server/youtube-runtime";

describe("youtube runtime", () => {
  it("evaluates generated player snippets inside QuickJS", async () => {
    await expect(
      evaluateWithQuickJs(
        {
          output: `
            function reverse(value) {
              return value.split("").reverse().join("");
            }
            return { sig: reverse(sig), n: reverse(n) };
          `
        },
        {
          sig: "abc",
          n: "xyz"
        }
      )
    ).resolves.toEqual({ sig: "cba", n: "zyx" });
  });
});
