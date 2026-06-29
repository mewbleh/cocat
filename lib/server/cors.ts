import { getServerConfig } from "@/lib/server/config";

const CORS_METHODS = "GET,POST,DELETE,OPTIONS";
const CORS_HEADERS = "authorization,content-type";
const CORS_EXPOSE_HEADERS = "content-disposition,content-length,content-type";

export function optionsResponse(request: Request) {
  return withCors(request, new Response(null, { status: 204 }));
}

export function withCors<TResponse extends Response>(request: Request, response: TResponse): TResponse {
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    response.headers.set(key, value);
  }

  return response;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = safeAllowedOrigins();

  if (!origin || allowedOrigins.length === 0) {
    return {};
  }

  const allowAnyOrigin = allowedOrigins.includes("*");
  const allowedOrigin = allowAnyOrigin ? "*" : allowedOrigins.includes(origin) ? origin : undefined;

  if (!allowedOrigin) {
    return {};
  }

  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers": CORS_HEADERS,
    "access-control-expose-headers": CORS_EXPOSE_HEADERS,
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}

function safeAllowedOrigins() {
  try {
    return getServerConfig().corsAllowedOrigins;
  } catch {
    return [];
  }
}
