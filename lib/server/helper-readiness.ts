import { getQuickJS } from "quickjs-emscripten";

export async function getHelperReadiness() {
  const quickJs = await getQuickJS()
    .then(() => true)
    .catch(() => false);

  return {
    youtubei: true,
    quickJs,
    hlsParser: true,
    dashParser: true
  };
}
