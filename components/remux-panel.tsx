"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Download, FileAudio, FileVideo, Loader2, PackageCheck, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { serverApiUrl, serverAuthHeaders, type ServerSettings } from "@/lib/server-settings";
import { cn, formatBytes, safeFileName } from "@/lib/utils";

const REMUX_CONTAINERS = ["mp4", "webm", "mkv", "m4a"] as const;

type RemuxContainer = (typeof REMUX_CONTAINERS)[number];

export function RemuxPanel({ serverSettings }: { serverSettings: ServerSettings }) {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [container, setContainer] = useState<RemuxContainer>("mp4");
  const [fileName, setFileName] = useState("");
  const [isRemuxing, setIsRemuxing] = useState(false);
  const [download, setDownload] = useState<{ fileName: string; url: string } | null>(null);

  const outputFileName = useMemo(() => {
    const rawBaseName = fileName || mediaFile?.name.replace(/\.[^.]+$/, "") || "cocat-remux";
    return `${stripMatchingExtension(safeFileName(rawBaseName, "cocat-remux"), container)}.${container}`;
  }, [container, fileName, mediaFile?.name]);

  useEffect(() => {
    return () => {
      if (download?.url) {
        URL.revokeObjectURL(download.url);
      }
    };
  }, [download?.url]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!mediaFile) {
      toast.error("Choose a media file first");
      return;
    }

    setIsRemuxing(true);

    if (download?.url) {
      URL.revokeObjectURL(download.url);
      setDownload(null);
    }

    try {
      const formData = new FormData();
      formData.set("media", mediaFile);
      formData.set("container", container);
      formData.set("fileName", fileName || outputFileName.replace(/\.[^.]+$/, ""));

      if (audioFile) {
        formData.set("audio", audioFile);
      }

      const response = await fetch(serverApiUrl("/api/remux", serverSettings), {
        method: "POST",
        headers: serverAuthHeaders(serverSettings),
        body: formData
      });

      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "CoCat could not remux those files.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const responseFileName = fileNameFromDisposition(response.headers.get("content-disposition")) ?? outputFileName;

      setDownload({ fileName: responseFileName, url });
      toast.success("Remux ready");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CoCat could not remux those files.");
    } finally {
      setIsRemuxing(false);
    }
  }

  function onReset() {
    setMediaFile(null);
    setAudioFile(null);
    setContainer("mp4");
    setFileName("");

    if (download?.url) {
      URL.revokeObjectURL(download.url);
    }

    setDownload(null);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Remux</h2>
          <p className="text-sm text-muted-foreground">{mediaFile ? mediaFile.name : "Local files"}</p>
        </div>
        <PackageCheck className="size-5 text-primary" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FileInput
          file={mediaFile}
          icon={<FileVideo className="size-4" />}
          label="Media file"
          onFileChange={setMediaFile}
        />
        <FileInput
          file={audioFile}
          icon={<FileAudio className="size-4" />}
          label="Audio file"
          onFileChange={setAudioFile}
          optional
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
        <label className="grid gap-1 text-sm font-medium">
          Container
          <Select value={container} onValueChange={(nextValue) => setContainer(nextValue as RemuxContainer)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMUX_CONTAINERS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="grid gap-1 text-sm font-medium">
          File name
          <Input
            aria-label="Remux file name"
            onChange={(event) => setFileName(event.target.value)}
            placeholder={mediaFile?.name.replace(/\.[^.]+$/, "") ?? "cocat-remux"}
            value={fileName}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-md border bg-background p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="truncate">{outputFileName}</span>
        <span>{formatBytes((mediaFile?.size ?? 0) + (audioFile?.size ?? 0))}</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" disabled={!mediaFile || isRemuxing} type="submit">
          {isRemuxing ? <Loader2 className="animate-spin" /> : <PackageCheck />}
          Remux
        </Button>
        <Button onClick={onReset} variant="outline">
          <RotateCcw />
          Reset
        </Button>
        {download ? (
          <a className={cn(buttonVariants({ variant: "default" }), "flex-1")} download={download.fileName} href={download.url}>
            <Download className="size-4" />
            Save file
          </a>
        ) : null}
      </div>
    </form>
  );
}

function FileInput({
  file,
  icon,
  label,
  onFileChange,
  optional = false
}: {
  file: File | null;
  icon: React.ReactNode;
  label: string;
  onFileChange(file: File | null): void;
  optional?: boolean;
}) {
  return (
    <label className="grid gap-2 rounded-md border bg-background p-3 text-sm font-medium">
      <span className="flex items-center gap-2">
        {icon}
        {label}
        {optional ? <span className="font-normal text-muted-foreground">optional</span> : null}
      </span>
      <Input
        aria-label={label}
        key={file ? `${file.name}-${file.lastModified}` : "empty"}
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        type="file"
      />
      <span className="min-h-5 truncate text-xs font-normal text-muted-foreground">
        {file ? `${file.name} - ${formatBytes(file.size)}` : "No file selected"}
      </span>
    </label>
  );
}

function fileNameFromDisposition(value: string | null) {
  const encodedFileName = value?.match(/filename\*=UTF-8''([^;]+)/)?.[1];

  if (encodedFileName) {
    try {
      return decodeURIComponent(encodedFileName);
    } catch {
      return encodedFileName;
    }
  }

  return value?.match(/filename="([^"]+)"/)?.[1];
}

function stripMatchingExtension(fileName: string, extension: string) {
  return fileName.replace(new RegExp(`\\.${escapeRegExp(extension)}$`, "i"), "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
