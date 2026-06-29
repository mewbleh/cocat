import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import { Innertube, Platform, UniversalCache } from "youtubei.js";

type YoutubeEvalData = {
  output: string;
};

type YoutubeEvalEnv = Record<string, string | number | boolean | null | undefined>;

let isRuntimeConfigured = false;
let youtubeClientPromise: Promise<Innertube> | null = null;
const YOUTUBE_EVAL_TIMEOUT_MS = 1000;
const YOUTUBE_EVAL_MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;

export function configureYoutubeRuntime() {
  if (isRuntimeConfigured) {
    return;
  }

  Platform.load({
    ...Platform.shim,
    eval: evaluateWithQuickJs
  });
  isRuntimeConfigured = true;
}

export function getYoutubeClient() {
  configureYoutubeRuntime();

  youtubeClientPromise ??= Innertube.create({
    cache: new UniversalCache(false)
  });

  return youtubeClientPromise;
}

export async function evaluateWithQuickJs(data: YoutubeEvalData, env: YoutubeEvalEnv) {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime({
    memoryLimitBytes: YOUTUBE_EVAL_MEMORY_LIMIT_BYTES
  });
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + YOUTUBE_EVAL_TIMEOUT_MS));
  const vm = runtime.newContext();

  try {
    const envScript = Object.entries(env)
      .map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`)
      .join("\n");
    const wrappedScript = `(function(){\n${envScript}\n${data.output}\n})()`;
    const result = vm.evalCode(wrappedScript);

    if (result.error) {
      const error = vm.dump(result.error) as { message?: string };
      result.error.dispose();
      throw new Error(error.message ?? "YouTube player script evaluation failed.");
    }

    const output = vm.dump(result.value) as Record<string, unknown> | undefined;
    result.value.dispose();

    return output;
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
