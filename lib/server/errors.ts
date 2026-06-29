import type { ApiErrorResponse } from "@/lib/contracts";
import { ZodError } from "zod";

export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  PRIVATE_NETWORK_BLOCKED: 400,
  UNSUPPORTED_PLATFORM: 422,
  UNSUPPORTED_MEDIA: 422,
  AUTH_REQUIRED: 403,
  PAYLOAD_TOO_LARGE: 413,
  PROVIDER_FAILED: 502,
  UPSTREAM_TIMEOUT: 504,
  TOKEN_EXPIRED: 410,
  JOB_NOT_FOUND: 404,
  JOB_LIMIT_REACHED: 429,
  JOB_NOT_READY: 409,
  CANCELLED: 499,
  INTERNAL_ERROR: 500
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class CoCatError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "CoCatError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.cause = cause;
  }
}

export function toCoCatError(error: unknown) {
  if (error instanceof CoCatError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new CoCatError("UPSTREAM_TIMEOUT", "The upstream request timed out.", error);
  }

  if (error instanceof ZodError) {
    return new CoCatError("BAD_REQUEST", error.issues[0]?.message ?? "The request payload is invalid.", error);
  }

  return new CoCatError("INTERNAL_ERROR", "CoCat hit an unexpected server error.", error);
}

export function toApiError(error: unknown): { body: ApiErrorResponse; status: number } {
  const cocatError = toCoCatError(error);

  return {
    status: cocatError.status,
    body: {
      error: {
        code: cocatError.code,
        message: cocatError.message
      }
    }
  };
}

export function errorMessageForCode(code: string) {
  const messages: Record<string, string> = {
    BAD_REQUEST: "The request is missing required fields.",
    INVALID_URL: "That URL is not valid for CoCat.",
    PRIVATE_NETWORK_BLOCKED: "CoCat only accepts public web URLs.",
    UNSUPPORTED_PLATFORM: "CoCat does not have a provider for that URL yet.",
    UNSUPPORTED_MEDIA: "CoCat could not find a public downloadable media file on that page.",
    AUTH_REQUIRED: "That platform is not exposing this media publicly.",
    PAYLOAD_TOO_LARGE: "That upload is too large.",
    PROVIDER_FAILED: "The provider could not read that page.",
    UPSTREAM_TIMEOUT: "The upstream site took too long to respond.",
    TOKEN_EXPIRED: "That download session expired.",
    JOB_NOT_FOUND: "That download job no longer exists.",
    JOB_LIMIT_REACHED: "CoCat is already handling the maximum number of downloads.",
    JOB_NOT_READY: "That download is not ready yet.",
    CANCELLED: "The download was cancelled.",
    INTERNAL_ERROR: "CoCat hit an unexpected server error."
  };

  return messages[code] ?? messages.INTERNAL_ERROR;
}
