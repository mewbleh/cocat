import { afterEach, describe, expect, it } from "vitest";

import { POST as extractPost } from "@/app/api/extract/route";
import { POST as jobsPost } from "@/app/api/jobs/route";
import { POST as remuxPost } from "@/app/api/remux/route";

const originalAccessToken = process.env.COCAT_ACCESS_TOKEN;

describe("api routes", () => {
  afterEach(() => {
    restoreEnv("COCAT_ACCESS_TOKEN", originalAccessToken);
  });

  it("returns a bad request for malformed extract JSON", async () => {
    const response = await extractPost(jsonRequest("{"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns a bad request for malformed job JSON", async () => {
    const response = await jobsPost(jsonRequest("{"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects remux uploads without a content length", async () => {
    const response = await remuxPost(new Request("http://localhost/api/remux", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("rejects protected API requests without the configured access token", async () => {
    process.env.COCAT_ACCESS_TOKEN = "test-access-token";
    const response = await jobsPost(jsonRequest("{"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("accepts protected API requests with the configured bearer token", async () => {
    process.env.COCAT_ACCESS_TOKEN = "test-access-token";
    const response = await jobsPost(jsonRequest("{", { authorization: "Bearer test-access-token" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/test", {
    body,
    headers: {
      "content-type": "application/json",
      ...headers
    },
    method: "POST"
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
