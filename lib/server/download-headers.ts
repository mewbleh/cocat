import { safeFileName } from "@/lib/utils";

const DEFAULT_ASCII_FILE_NAME = "cocat-download";
const RFC5987_EXTRA_CHARS = /['()*]/g;

export function attachmentContentDisposition(fileName: string) {
  const cleanFileName = safeFileName(fileName);
  const fallbackFileName = asciiHeaderFileName(cleanFileName);

  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeRfc5987Value(cleanFileName)}`;
}

function asciiHeaderFileName(fileName: string) {
  const asciiFileName = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (asciiFileName && asciiFileName !== "." && asciiFileName !== ".." && !asciiFileName.startsWith(".")) {
    return asciiFileName;
  }

  return `${DEFAULT_ASCII_FILE_NAME}${asciiExtension(fileName)}`;
}

function asciiExtension(fileName: string) {
  return fileName.match(/(\.[A-Za-z0-9]{1,8})$/)?.[1] ?? "";
}

function encodeRfc5987Value(value: string) {
  return encodeURIComponent(value).replace(RFC5987_EXTRA_CHARS, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
