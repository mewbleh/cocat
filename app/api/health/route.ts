import { NextResponse } from "next/server";
import os from "node:os";

import { getServerConfig } from "@/lib/server/config";
import { withCors, optionsResponse } from "@/lib/server/cors";
import { checkFfmpegAvailable } from "@/lib/server/ffmpeg";
import { getHelperReadiness } from "@/lib/server/helper-readiness";
import { providerIds } from "@/lib/server/providers";

export const runtime = "nodejs";

const CPU_SAMPLE_KEY = "__cocatCpuSample";

export function OPTIONS(request: Request) {
  return optionsResponse(request);
}

export async function GET(request: Request) {
  try {
    const config = getServerConfig();
    const ffmpegAvailable = await checkFfmpegAvailable();
    const helpers = await getHelperReadiness();

    return withCors(request, NextResponse.json({
      ok: true,
      authRequired: Boolean(config.accessToken),
      corsEnabled: config.corsAllowedOrigins.length > 0,
      ffmpegAvailable,
      providers: providerIds(),
      helpers,
      runtime: getRuntimeStats()
    }));
  } catch (error) {
    return withCors(request, NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CoCat health check failed."
    }, { status: 500 }));
  }
}

function getRuntimeStats() {
  const memory = process.memoryUsage();
  const systemTotalBytes = os.totalmem();
  const systemFreeBytes = os.freemem();

  return {
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: getCpuStats(),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      systemUsedPercent: systemTotalBytes > 0 ? Math.round(((systemTotalBytes - systemFreeBytes) / systemTotalBytes) * 1000) / 10 : null,
      systemFreeBytes,
      systemTotalBytes
    }
  };
}

function getCpuStats() {
  const cpus = os.cpus();
  const sample = cpus.reduce(
    (totals, cpu) => {
      const idle = cpu.times.idle;
      const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);

      return {
        idle: totals.idle + idle,
        total: totals.total + total
      };
    },
    { idle: 0, total: 0 }
  );
  const globalStore = globalThis as typeof globalThis & {
    [CPU_SAMPLE_KEY]?: typeof sample;
  };
  const previousSample = globalStore[CPU_SAMPLE_KEY];
  globalStore[CPU_SAMPLE_KEY] = sample;
  const idleDelta = previousSample ? sample.idle - previousSample.idle : 0;
  const totalDelta = previousSample ? sample.total - previousSample.total : 0;
  const usagePercent = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 1000) / 10 : null;

  return {
    cores: cpus.length,
    usagePercent: usagePercent == null ? null : Math.max(0, Math.min(100, usagePercent)),
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100)
  };
}
