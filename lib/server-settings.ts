export type ServerSettings = {
  accessToken: string;
  apiBaseUrl: string;
};

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  accessToken: "",
  apiBaseUrl: ""
};

export function normalizeServerSettings(input: unknown): ServerSettings {
  if (typeof input !== "object" || input == null) {
    return DEFAULT_SERVER_SETTINGS;
  }

  const record = input as Partial<Record<keyof ServerSettings, unknown>>;

  return {
    accessToken: typeof record.accessToken === "string" ? record.accessToken.trim() : "",
    apiBaseUrl: cleanApiBaseUrl(typeof record.apiBaseUrl === "string" ? record.apiBaseUrl : "")
  };
}

export function serializeServerSettings(settings: ServerSettings) {
  return JSON.stringify(normalizeServerSettings(settings));
}

export function parseStoredServerSettings(rawValue: string | null) {
  if (!rawValue) {
    return DEFAULT_SERVER_SETTINGS;
  }

  try {
    return normalizeServerSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_SERVER_SETTINGS;
  }
}

export function serverApiUrl(pathOrUrl: string, settings: ServerSettings) {
  if (isAbsoluteUrl(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return settings.apiBaseUrl ? `${settings.apiBaseUrl}${path}` : path;
}

export function serverApiUrlWithToken(pathOrUrl: string, settings: ServerSettings) {
  const token = settings.accessToken.trim();

  if (!token) {
    return serverApiUrl(pathOrUrl, settings);
  }

  const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(serverApiUrl(pathOrUrl, settings), baseUrl);
  url.searchParams.set("access_token", token);

  if (settings.apiBaseUrl || isAbsoluteUrl(pathOrUrl)) {
    return url.href;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function serverAuthHeaders(settings: ServerSettings): Record<string, string> {
  const token = settings.accessToken.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function isValidServerBaseUrl(value: string) {
  if (!value.trim()) {
    return true;
  }

  return Boolean(cleanApiBaseUrl(value));
}

export function cleanApiBaseUrl(value: string) {
  const trimmedValue = value.trim().replace(/\/+$/, "");

  if (!trimmedValue) {
    return "";
  }

  try {
    const url = new URL(trimmedValue);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href.replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function isAbsoluteUrl(value: string) {
  try {
    void new URL(value);
    return true;
  } catch {
    return false;
  }
}
