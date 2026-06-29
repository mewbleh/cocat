"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, Save, Server, ShieldCheck, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  cleanApiBaseUrl,
  isValidServerBaseUrl,
  serverApiUrl,
  serverAuthHeaders,
  type ServerSettings
} from "@/lib/server-settings";
import { cn } from "@/lib/utils";

type ServerPanelProps = {
  onReset(): void;
  onSettingsChange(settings: ServerSettings): void;
  settings: ServerSettings;
};

type ServerCheckState =
  | { type: "idle"; message: string }
  | { type: "checking"; message: string }
  | { type: "ok"; message: string }
  | { type: "error"; message: string };

export function ServerPanel({ onReset, onSettingsChange, settings }: ServerPanelProps) {
  const [draft, setDraft] = useState(settings);
  const [checkState, setCheckState] = useState<ServerCheckState>({
    type: "idle",
    message: settings.apiBaseUrl ? settings.apiBaseUrl : "Current CoCat server"
  });

  function onSave() {
    if (!isValidServerBaseUrl(draft.apiBaseUrl)) {
      toast.error("Enter a valid http or https server URL.");
      return;
    }

    onSettingsChange({
      accessToken: draft.accessToken.trim(),
      apiBaseUrl: cleanApiBaseUrl(draft.apiBaseUrl)
    });
    setCheckState({
      type: "idle",
      message: cleanApiBaseUrl(draft.apiBaseUrl) || "Current CoCat server"
    });
    toast.success("Server settings saved");
  }

  async function onCheck() {
    if (!isValidServerBaseUrl(draft.apiBaseUrl)) {
      toast.error("Enter a valid http or https server URL.");
      return;
    }

    const nextSettings = {
      accessToken: draft.accessToken.trim(),
      apiBaseUrl: cleanApiBaseUrl(draft.apiBaseUrl)
    };

    setCheckState({ type: "checking", message: "Checking server" });

    try {
      const response = await fetch(serverApiUrl("/api/health", nextSettings), {
        headers: serverAuthHeaders(nextSettings)
      });
      const body = await response.json() as {
        authRequired?: boolean;
        ffmpegAvailable?: boolean;
        ok?: boolean;
        providers?: string[];
      };

      if (!response.ok || !body.ok) {
        throw new Error("The server did not pass its health check.");
      }

      setCheckState({
        type: "ok",
        message: `${body.providers?.length ?? 0} providers, ffmpeg ${body.ffmpegAvailable ? "ready" : "missing"}${body.authRequired ? ", secured" : ""}`
      });
    } catch (error) {
      setCheckState({
        type: "error",
        message: error instanceof Error ? error.message : "Could not reach that CoCat server."
      });
    }
  }

  function onResetClick() {
    setDraft({
      accessToken: "",
      apiBaseUrl: ""
    });
    setCheckState({ type: "idle", message: "Current CoCat server" });
    onReset();
    toast.success("Using current server");
  }

  return (
    <section className="grid gap-4 rounded-lg border bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Server</h2>
          <p className="text-sm text-muted-foreground">{settings.apiBaseUrl || "Current instance"}</p>
        </div>
        <Server className="size-5 text-primary" />
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <label className="grid gap-1 text-sm font-medium">
          CoCat server URL
          <Input
            autoComplete="url"
            inputMode="url"
            onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}
            placeholder="Current server"
            value={draft.apiBaseUrl}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Access token
          <Input
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, accessToken: event.target.value })}
            placeholder="Optional"
            type="password"
            value={draft.accessToken}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2 rounded-md border bg-background p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className={cn("inline-flex items-center gap-2", checkState.type === "ok" && "text-primary", checkState.type === "error" && "text-destructive")}>
          {checkIcon(checkState.type)}
          {checkState.message}
        </span>
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4" />
          Browser local
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={onCheck} variant="outline">
          {checkState.type === "checking" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          Check
        </Button>
        <Button className="flex-1" onClick={onSave}>
          <Save />
          Save
        </Button>
        <Button onClick={onResetClick} variant="outline">
          <RotateCcw />
          Reset
        </Button>
      </div>
    </section>
  );
}

function checkIcon(type: ServerCheckState["type"]) {
  if (type === "checking") {
    return <Loader2 className="size-4 animate-spin" />;
  }

  if (type === "ok") {
    return <CheckCircle2 className="size-4" />;
  }

  if (type === "error") {
    return <XCircle className="size-4" />;
  }

  return <Server className="size-4" />;
}
