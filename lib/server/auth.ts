import crypto from "node:crypto";

import { getServerConfig } from "@/lib/server/config";
import { CoCatError } from "@/lib/server/errors";

export function authorizeRequest(request: Request) {
  const accessToken = getServerConfig().accessToken;

  if (!accessToken) {
    return;
  }

  const requestToken = tokenFromRequest(request);

  if (!requestToken || !tokensMatch(requestToken, accessToken)) {
    throw new CoCatError("AUTH_REQUIRED", "This CoCat server requires an access token.");
  }
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  try {
    const url = new URL(request.url);
    return url.searchParams.get("access_token") ?? url.searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

function tokensMatch(receivedToken: string, expectedToken: string) {
  const received = Buffer.from(receivedToken);
  const expected = Buffer.from(expectedToken);

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
