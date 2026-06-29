import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

type CoCatConfigState = {
  defaultTokenSecret: string;
};

const CONFIG_STATE_KEY = "__cocatConfigState";

const configSchema = z.object({
  tokenSecret: z.string().min(24),
  accessToken: z.preprocess(
    (value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
    z.string().min(12).optional()
  ),
  corsAllowedOrigins: z.preprocess(
    (value) => typeof value === "string"
      ? value.split(",").map((origin) => origin.trim()).filter(Boolean)
      : [],
    z.array(z.string()).default([])
  ),
  maxActiveJobs: z.coerce.number().int().positive().max(20).default(3),
  maxActiveRemuxJobs: z.coerce.number().int().positive().max(10).default(1),
  maxSourceTokens: z.coerce.number().int().positive().max(5000).default(200),
  maxStoredJobs: z.coerce.number().int().positive().max(1000).default(100),
  maxUploadBytes: z.coerce.number().int().min(1024 * 1024).max(2 * 1024 * 1024 * 1024).default(512 * 1024 * 1024),
  maxUpstreamBodyBytes: z.coerce.number().int().min(64 * 1024).max(64 * 1024 * 1024).default(10 * 1024 * 1024),
  jobTtlSeconds: z.coerce.number().int().min(60).max(3600).default(900),
  requestTimeoutMs: z.coerce.number().int().min(1000).max(60_000).default(12_000),
  sourceTtlSeconds: z.coerce.number().int().min(60).max(1800).default(600),
  tempDir: z.string().min(1).default(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "cocat")),
  enableSpotmate: z.boolean().default(false)
});

export type ServerConfig = z.infer<typeof configSchema>;

export function getServerConfig(): ServerConfig {
  const secret = process.env.COCAT_TOKEN_SECRET ?? getConfigState().defaultTokenSecret;

  if (process.env.NODE_ENV === "production" && !process.env.COCAT_TOKEN_SECRET) {
    throw new Error("COCAT_TOKEN_SECRET must be set in production.");
  }

  return configSchema.parse({
    tokenSecret: secret,
    accessToken: process.env.COCAT_ACCESS_TOKEN,
    corsAllowedOrigins: process.env.COCAT_ALLOWED_ORIGINS,
    maxActiveJobs: process.env.COCAT_MAX_ACTIVE_JOBS,
    maxActiveRemuxJobs: process.env.COCAT_MAX_ACTIVE_REMUX_JOBS,
    maxSourceTokens: process.env.COCAT_MAX_SOURCE_TOKENS,
    maxStoredJobs: process.env.COCAT_MAX_STORED_JOBS,
    maxUploadBytes: process.env.COCAT_MAX_UPLOAD_BYTES,
    maxUpstreamBodyBytes: process.env.COCAT_MAX_UPSTREAM_BODY_BYTES,
    jobTtlSeconds: process.env.COCAT_JOB_TTL_SECONDS,
    requestTimeoutMs: process.env.COCAT_REQUEST_TIMEOUT_MS,
    sourceTtlSeconds: process.env.COCAT_SOURCE_TTL_SECONDS,
    tempDir: process.env.COCAT_TEMP_DIR,
    enableSpotmate: process.env.COCAT_ENABLE_SPOTMATE === "true"
  });
}

function getConfigState() {
  const globalStore = globalThis as typeof globalThis & {
    [CONFIG_STATE_KEY]?: CoCatConfigState;
  };

  globalStore[CONFIG_STATE_KEY] ??= {
    defaultTokenSecret: crypto.randomBytes(32).toString("hex")
  };

  return globalStore[CONFIG_STATE_KEY];
}
