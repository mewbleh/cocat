"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clipboard,
  Cpu,
  Download,
  Eraser,
  Gauge,
  HardDrive,
  Info,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  RefreshCcw,
  Server,
  Settings2,
  ShieldCheck,
  Timer,
  X
} from "lucide-react";

import { AboutPanel } from "@/components/about-panel";
import { ProcessingSettingsPanel } from "@/components/processing-settings-panel";
import { ProviderIcon } from "@/components/provider-icon";
import { RemuxPanel } from "@/components/remux-panel";
import { ServerPanel } from "@/components/server-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useClipboard } from "@/hooks/use-clipboard";
import { useJobEvents } from "@/hooks/use-job-events";
import { useProcessingSettings } from "@/hooks/use-processing-settings";
import { useServerSettings } from "@/hooks/use-server-settings";
import {
  type ApiErrorResponse,
  type CreateJobResponse,
  type DownloadOption,
  type ExtractResponse,
  type ExtractedMedia,
  type MediaMode,
  type ProcessingPolicy,
  type ProcessingSettings
} from "@/lib/contracts";
import { PROCESSING_POLICIES, PROCESSING_POLICY_LABELS, qualityCapToHeight } from "@/lib/processing-settings";
import { serverApiUrl, serverApiUrlWithToken, serverAuthHeaders, type ServerSettings } from "@/lib/server-settings";
import { cn, formatBytes, formatDuration, getPlatformLabel, safeFileName } from "@/lib/utils";

const MEDIA_MODES: Array<{ value: MediaMode; label: string }> = [
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "photo", label: "Photo" },
  { value: "gif", label: "GIF" }
];

const NAV_ITEMS = [
  { value: "download", label: "Download", icon: Download },
  { value: "remux", label: "Remux", icon: RefreshCcw },
  { value: "server", label: "Server", icon: Server },
  { value: "about", label: "About", icon: Info }
];

type ServerHealth = {
  ok?: boolean;
  error?: string;
  authRequired?: boolean;
  corsEnabled?: boolean;
  ffmpegAvailable?: boolean;
  providers?: string[];
  runtime?: {
    uptimeSeconds?: number;
    nodeVersion?: string;
    platform?: string;
    cpu: {
      cores?: number;
      usagePercent?: number | null;
      loadAverage?: number[];
    };
    memory: {
      rssBytes?: number;
      heapUsedBytes?: number;
      heapTotalBytes?: number;
      systemUsedPercent?: number | null;
      systemFreeBytes?: number;
      systemTotalBytes?: number;
    };
  };
};

type JobEvent = ReturnType<typeof useJobEvents>["event"];

export function DownloaderApp() {
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<ExtractedMedia | null>(null);
  const [selectedMode, setSelectedMode] = useState<MediaMode>("video");
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState("download");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [serverHealthError, setServerHealthError] = useState<string | null>(null);
  const [isCheckingServerHealth, setIsCheckingServerHealth] = useState(false);
  const { copy } = useClipboard();
  const { settings, setSettings, resetSettings } = useProcessingSettings();
  const { serverSettings, setServerSettings, resetSettings: resetServerSettings } = useServerSettings();
  const { event: jobEvent, isConnected } = useJobEvents(jobId, serverSettings);

  const optionsForMode = useMemo(() => {
    const modeOptions = media?.options.filter((option) => option.mode === selectedMode) ?? [];
    const compatibleOptions = modeOptions.filter((option) => isOptionCompatible(option, settings));

    return compatibleOptions.length > 0 ? compatibleOptions : modeOptions;
  }, [media?.options, selectedMode, settings]);

  const selectedOption = useMemo(() => {
    return media?.options.find((option) => option.id === selectedOptionId) ?? optionsForMode[0] ?? null;
  }, [media?.options, optionsForMode, selectedOptionId]);

  const activeModes = useMemo(() => {
    const modes = new Set(media?.options.map((option) => option.mode) ?? []);
    return MEDIA_MODES.filter((mode) => modes.has(mode.value));
  }, [media?.options]);

  useEffect(() => {
    if (jobEvent?.type === "complete") {
      toast.success("Download ready");
    }

    if (jobEvent?.type === "failed" || jobEvent?.type === "expired" || jobEvent?.type === "cancelled") {
      toast.error(jobEvent.message ?? "The download did not complete.");
    }
  }, [jobEvent]);

  useEffect(() => {
    let isCancelled = false;

    async function refreshServerHealth() {
      setIsCheckingServerHealth(true);

      try {
        const response = await fetch(serverApiUrl("/api/health", serverSettings), {
          headers: serverAuthHeaders(serverSettings)
        });
        const body = await response.json() as ServerHealth;

        if (!response.ok || !body.ok) {
          throw new Error(body.error ?? "CoCat server health check failed.");
        }

        if (!isCancelled) {
          setServerHealth(body);
          setServerHealthError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setServerHealth(null);
          setServerHealthError(error instanceof Error ? error.message : "Could not reach the CoCat server.");
        }
      } finally {
        if (!isCancelled) {
          setIsCheckingServerHealth(false);
        }
      }
    }

    void refreshServerHealth();
    const interval = window.setInterval(() => {
      void refreshServerHealth();
    }, 15_000);

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [serverSettings]);

  async function onExtract(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage(null);
    setMedia(null);
    setJobId(null);
    setIsDownloadDialogOpen(false);
    setIsExtracting(true);

    try {
      const response = await fetch(serverApiUrl("/api/extract", serverSettings), {
        method: "POST",
        headers: { "content-type": "application/json", ...serverAuthHeaders(serverSettings) },
        body: JSON.stringify({ url: url.trim() })
      });
      const body = await readJson<ExtractResponse>(response);

      if (!response.ok) {
        throw new Error((body as ApiErrorResponse).error.message);
      }

      const extractedMedia = (body as ExtractResponse).media;
      const firstOption =
        extractedMedia.options.find((option) => option.id === extractedMedia.recommendedOptionId) ?? extractedMedia.options[0];

      setMedia(extractedMedia);
      setSelectedMode(firstOption?.mode ?? "video");
      setSelectedOptionId(firstOption?.id ?? "");
      setIsDownloadDialogOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CoCat could not inspect that URL.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsExtracting(false);
    }
  }

  async function onPaste() {
    const pastedText = await navigator.clipboard.readText();
    setUrl(pastedText.trim());
  }

  async function onCopySource() {
    if (!media?.sourceUrl) {
      return;
    }

    const copied = await copy(media.sourceUrl);
    toast[copied ? "success" : "error"](copied ? "Source copied" : "Could not copy source");
  }

  async function onCreateJob() {
    if (!media || !selectedOption) {
      return;
    }

    setErrorMessage(null);
    setIsStartingJob(true);

    try {
      const response = await fetch(serverApiUrl("/api/jobs", serverSettings), {
        method: "POST",
        headers: { "content-type": "application/json", ...serverAuthHeaders(serverSettings) },
        body: JSON.stringify({
          sourceToken: media.sourceToken,
          optionId: selectedOption.id,
          mode: selectedOption.mode,
          settings
        })
      });
      const body = await readJson<CreateJobResponse>(response);

      if (!response.ok) {
        throw new Error((body as ApiErrorResponse).error.message);
      }

      setJobId((body as CreateJobResponse).jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CoCat could not start that download.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsStartingJob(false);
    }
  }

  async function onCancelJob() {
    if (!jobId) {
      return;
    }

    await fetch(serverApiUrl(`/api/jobs/${jobId}`, serverSettings), {
      method: "DELETE",
      headers: serverAuthHeaders(serverSettings)
    });
    setJobId(null);
  }

  function onClear() {
    setUrl("");
    setMedia(null);
    setJobId(null);
    setErrorMessage(null);
    setSelectedOptionId("");
    setIsDownloadDialogOpen(false);
  }

  function onModeChange(mode: MediaMode) {
    const nextOption = media?.options.find((option) => option.mode === mode && isOptionCompatible(option, settings))
      ?? media?.options.find((option) => option.mode === mode);

    setSelectedMode(mode);
    setSelectedOptionId(nextOption?.id ?? "");
  }

  const progressValue = jobEvent?.progress ?? (jobEvent?.type === "complete" ? 100 : jobId ? 18 : 0);
  const isBusy = isExtracting || isStartingJob || jobEvent?.type === "queued" || jobEvent?.type === "running";
  const downloadHref = jobEvent?.downloadUrl ? serverApiUrlWithToken(jobEvent.downloadUrl, serverSettings) : null;
  const visibleErrorMessage =
    errorMessage ??
    (jobEvent?.type === "failed" || jobEvent?.type === "expired" || jobEvent?.type === "cancelled"
      ? jobEvent.message ?? "The download did not complete."
      : null);

  return (
    <TooltipProvider>
      <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
        <Tabs value={activeTool} onValueChange={setActiveTool}>
          <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[244px_minmax(0,1fr)]">
            <AppSidebar onClear={onClear} onPaste={onPaste} />

            <section className="min-w-0">
              <TabsContent className="mt-0 grid gap-5" value="download">
                <form onSubmit={onExtract} className="grid gap-3 rounded-lg border bg-card/80 p-3 shadow-sm sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Input
                        aria-label="Media URL"
                        autoComplete="url"
                        inputMode="url"
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://"
                        value={url}
                      />
                      {url ? (
                        <button
                          aria-label="Clear URL"
                          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                          onClick={() => setUrl("")}
                          type="button"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="flex gap-2 sm:w-auto">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button aria-label="Paste from clipboard" onClick={onPaste} size="icon" variant="outline">
                            <Clipboard />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Paste</TooltipContent>
                      </Tooltip>
                      <Button className="min-w-32 flex-1 sm:flex-none" disabled={!url.trim() || isExtracting} type="submit">
                        {isExtracting ? <Loader2 className="animate-spin" /> : <span className="text-base font-black leading-none">&gt;&gt;</span>}
                        Inspect
                      </Button>
                    </div>
                  </div>
                  {visibleErrorMessage ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {visibleErrorMessage}
                    </div>
                  ) : null}
                </form>

                <HomeStatusPanel
                  isCheckingServerHealth={isCheckingServerHealth}
                  media={media}
                  onOpenDownload={() => setIsDownloadDialogOpen(true)}
                  onOpenServer={() => setActiveTool("server")}
                  onResetSettings={resetSettings}
                  onSettingsChange={setSettings}
                  serverHealth={serverHealth}
                  serverHealthError={serverHealthError}
                  serverSettings={serverSettings}
                  settings={settings}
                />

                <DownloadResultDialog
                  activeModes={activeModes}
                  downloadHref={downloadHref}
                  isBusy={isBusy}
                  isConnected={isConnected}
                  isOpen={Boolean(media) && isDownloadDialogOpen}
                  isStartingJob={isStartingJob}
                  jobEvent={jobEvent}
                  media={media}
                  onCancelJob={onCancelJob}
                  onCopySource={onCopySource}
                  onCreateJob={onCreateJob}
                  onModeChange={onModeChange}
                  onOpenChange={setIsDownloadDialogOpen}
                  onOptionChange={setSelectedOptionId}
                  onSettingsChange={setSettings}
                  optionsForMode={optionsForMode}
                  progressValue={progressValue}
                  resetSettings={resetSettings}
                  selectedMode={selectedMode}
                  selectedOption={selectedOption}
                  settings={settings}
                />
              </TabsContent>

              <TabsContent className="mt-0" value="remux">
                <RemuxPanel serverSettings={serverSettings} />
              </TabsContent>

              <TabsContent className="mt-0" value="server">
                <ServerPanel onReset={resetServerSettings} onSettingsChange={setServerSettings} settings={serverSettings} />
              </TabsContent>

              <TabsContent className="mt-0" value="about">
                <AboutPanel />
              </TabsContent>
            </section>
          </div>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}

function AppSidebar({ onClear, onPaste }: { onClear(): void; onPaste(): void }) {
  return (
    <aside className="rounded-lg border bg-card/95 p-3 shadow-sm backdrop-blur lg:sticky lg:top-5 lg:grid lg:h-[calc(100vh-2.5rem)] lg:grid-rows-[auto_1fr_auto]">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="size-11 shrink-0 rounded-lg shadow-sm ring-1 ring-border" src="/icon.svg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">CoCat</h1>
            <p className="truncate text-sm text-muted-foreground">self-hosted, cleanly queued</p>
          </div>
        </div>
        <HeaderActions className="lg:hidden" onClear={onClear} onPaste={onPaste} />
      </div>

      <TabsList aria-label="Tool" className="mt-3 grid h-auto w-full grid-cols-4 gap-1 bg-secondary/70 p-1 lg:grid-cols-1 lg:content-start lg:bg-transparent lg:p-0">
        {NAV_ITEMS.map((item) => (
          <TabsTrigger
            className="gap-2 rounded-md px-2 lg:h-10 lg:justify-start lg:px-3 [&_svg]:hidden sm:[&_svg]:block"
            key={item.value}
            value={item.value}
          >
            <item.icon className="size-4" />
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <div className="hidden border-t pt-3 lg:block">
        <HeaderActions onClear={onClear} onPaste={onPaste} />
      </div>
    </aside>
  );
}

function HeaderActions({
  className,
  onClear,
  onPaste
}: {
  className?: string;
  onClear(): void;
  onPaste(): void;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      <PrivacyPolicyDialog />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Open actions" size="icon" variant="ghost">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onPaste}>
            <Clipboard className="size-4" />
            Paste
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onClear}>
            <Eraser className="size-4" />
            Clear
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PrivacyPolicyDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button aria-label="Privacy policy" size="icon" variant="ghost">
          <ShieldCheck />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Privacy policy</DialogTitle>
          <DialogDescription>CoCat keeps the app intentionally local, short-lived, and self-hostable.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <PolicyItem title="No analytics" value="CoCat does not include analytics scripts, ad scripts, or third-party trackers in the UI." />
          <PolicyItem title="Browser storage" value="Processing settings, server URL, and optional server token are saved in this browser only." />
          <PolicyItem title="Server memory" value="Extracted source tokens and download jobs are kept in server memory and expire automatically." />
          <PolicyItem title="Temporary files" value="Files created for processed downloads or remux jobs are stored temporarily and removed after expiry." />
          <PolicyItem title="Provider requests" value="When you inspect a URL, the CoCat server contacts the source provider to resolve public media metadata." />
          <PolicyItem title="Self-hosting" value="If you use a custom server, that server owner controls its logs, network, access token, and retention policy." />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PolicyItem({ title, value }: { title: string; value: string }) {
  return (
    <div className="grid gap-1 border-l-2 border-primary/40 pl-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-muted-foreground">{value}</p>
    </div>
  );
}

function HomeStatusPanel({
  isCheckingServerHealth,
  media,
  onOpenDownload,
  onOpenServer,
  onResetSettings,
  onSettingsChange,
  serverHealth,
  serverHealthError,
  serverSettings,
  settings
}: {
  isCheckingServerHealth: boolean;
  media: ExtractedMedia | null;
  onOpenDownload(): void;
  onOpenServer(): void;
  onResetSettings(): void;
  onSettingsChange(settings: ProcessingSettings): void;
  serverHealth: ServerHealth | null;
  serverHealthError: string | null;
  serverSettings: ServerSettings;
  settings: ProcessingSettings;
}) {
  return (
    <section aria-label="Settings and server details" className="grid gap-4 rounded-lg border bg-card/65 p-4 shadow-sm">
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <div>
            <h2 className="text-sm font-semibold">Shortcuts</h2>
            <p className="text-xs text-muted-foreground">Tune processing or switch servers.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <ProcessingSettingsPanel media={media} onReset={onResetSettings} onSettingsChange={onSettingsChange} settings={settings} />
            <Button className="justify-start" onClick={onOpenServer} variant="outline">
              <Server />
              Server settings
            </Button>
            {media ? (
              <Button className="justify-start" onClick={onOpenDownload}>
                <Download />
                Open download modal
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Server detail</h2>
              <p className="truncate text-xs text-muted-foreground">{serverSettings.apiBaseUrl || "Current instance"}</p>
            </div>
            <span className={cn("inline-flex items-center gap-2 text-xs", serverHealthError ? "text-destructive" : "text-primary")}>
              {isCheckingServerHealth ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
              {serverHealthError ? "Offline" : serverHealth ? "Online" : "Checking"}
            </span>
          </div>

          {serverHealthError ? (
            <p className="border-t pt-3 text-sm text-destructive">{serverHealthError}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 border-t pt-3 lg:grid-cols-4">
              <ServerMetric icon={Gauge} label="CPU" value={formatPercent(serverHealth?.runtime?.cpu.usagePercent) ?? "warming"} />
              <ServerMetric icon={Cpu} label="Cores" value={formatNumber(serverHealth?.runtime?.cpu.cores)} />
              <ServerMetric icon={HardDrive} label="Memory" value={formatPercent(serverHealth?.runtime?.memory.systemUsedPercent) ?? "checking"} />
              <ServerMetric icon={Timer} label="Uptime" value={formatUptime(serverHealth?.runtime?.uptimeSeconds)} />
              <ServerMetric icon={Download} label="Providers" value={formatNumber(serverHealth?.providers?.length)} />
              <ServerMetric icon={RefreshCcw} label="ffmpeg" value={serverHealth ? (serverHealth.ffmpegAvailable ? "ready" : "missing") : "checking"} />
              <ServerMetric icon={ShieldCheck} label="Auth" value={serverHealth ? (serverHealth.authRequired ? "required" : "open") : "checking"} />
              <ServerMetric icon={Settings2} label="Node" value={serverHealth?.runtime?.nodeVersion ?? "checking"} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ServerMetric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        {label}
      </span>
      <span className="truncate text-sm font-semibold">{value}</span>
    </div>
  );
}

function DownloadResultDialog({
  activeModes,
  downloadHref,
  isBusy,
  isConnected,
  isOpen,
  isStartingJob,
  jobEvent,
  media,
  onCancelJob,
  onCopySource,
  onCreateJob,
  onModeChange,
  onOpenChange,
  onOptionChange,
  onSettingsChange,
  optionsForMode,
  progressValue,
  resetSettings,
  selectedMode,
  selectedOption,
  settings
}: {
  activeModes: Array<{ value: MediaMode; label: string }>;
  downloadHref: string | null;
  isBusy: boolean;
  isConnected: boolean;
  isOpen: boolean;
  isStartingJob: boolean;
  jobEvent: JobEvent;
  media: ExtractedMedia | null;
  onCancelJob(): void;
  onCopySource(): void;
  onCreateJob(): void;
  onModeChange(mode: MediaMode): void;
  onOpenChange(open: boolean): void;
  onOptionChange(optionId: string): void;
  onSettingsChange(settings: ProcessingSettings): void;
  optionsForMode: DownloadOption[];
  progressValue: number;
  resetSettings(): void;
  selectedMode: MediaMode;
  selectedOption: DownloadOption | null;
  settings: ProcessingSettings;
}) {
  if (!media) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Download media</DialogTitle>
          <DialogDescription>{getPlatformLabel(media.providerId)} - {media.options.length} formats available</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <MediaSummary media={media} />

          <div className="grid content-start gap-4 rounded-md border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">Download</h3>
                <p className="text-sm text-muted-foreground">{getPlatformLabel(media.providerId)}</p>
              </div>
              <ProviderIcon className="size-8" providerId={media.providerId} />
            </div>

            <ProcessingSettingsPanel media={media} onReset={resetSettings} onSettingsChange={onSettingsChange} settings={settings} />

            {activeModes.length > 0 ? (
              <>
                <Tabs
                  value={settings.processingPolicy}
                  onValueChange={(value) => onSettingsChange({ ...settings, processingPolicy: value as ProcessingPolicy })}
                >
                  <TabsList aria-label="Processing mode" className="grid w-full grid-cols-4">
                    {PROCESSING_POLICIES.map((policy) => (
                      <TabsTrigger key={policy} value={policy}>
                        {PROCESSING_POLICY_LABELS[policy]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <Tabs value={selectedMode} onValueChange={(value) => onModeChange(value as MediaMode)}>
                  <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${activeModes.length}, minmax(0, 1fr))` }}>
                    {activeModes.map((mode) => (
                      <TabsTrigger key={mode.value} value={mode.value}>
                        {mode.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <Select value={selectedOption?.id ?? ""} onValueChange={onOptionChange}>
                  <SelectTrigger aria-label="Download option">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    {optionsForMode.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {formatOptionLabel(option, settings)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <label className="grid gap-1 text-sm font-medium">
                  File name
                  <Input
                    aria-label="Download file name"
                    onChange={(event) => onSettingsChange({ ...settings, filenameTemplate: event.target.value })}
                    placeholder="{title}"
                    value={settings.filenameTemplate}
                  />
                  {selectedOption ? (
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {previewDownloadFileName(media, selectedOption, settings)}
                    </span>
                  ) : null}
                </label>

                <Button disabled={!selectedOption || isBusy} onClick={onCreateJob}>
                  {isStartingJob || jobEvent?.type === "running" ? <Loader2 className="animate-spin" /> : <Download />}
                  Download
                </Button>
              </>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No media selected.</div>
            )}

            {jobEvent ? (
              <div className="grid gap-3 rounded-md border bg-card p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{jobEvent.message ?? "Connecting"}</span>
                  <span className={cn("text-muted-foreground", isConnected && "text-primary")}>
                    {jobEvent.type === "complete" ? "Ready" : `${progressValue}%`}
                  </span>
                </div>
                <Progress value={progressValue} />
                <div className="flex gap-2">
                  {downloadHref ? (
                    <a className={cn(buttonVariants({ variant: "default" }), "flex-1")} href={downloadHref}>
                      <Download className="size-4" />
                      Save file
                    </a>
                  ) : null}
                  <Button onClick={onCancelJob} variant="outline">
                    <PauseCircle />
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <Button onClick={onCopySource} variant="ghost">
              <Clipboard />
              Copy source
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MediaSummary({ media }: { media: ExtractedMedia }) {
  return (
    <div className="grid content-start gap-4 rounded-md border bg-card/72 p-4">
      <div className="overflow-hidden rounded-md border bg-secondary">
        {media.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="aspect-video w-full object-cover" src={media.thumbnailUrl} />
        ) : (
          <div className="grid aspect-video place-items-center text-muted-foreground">
            <Download className="size-10" />
          </div>
        )}
      </div>
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold">{media.title}</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {media.author ? <span>{media.author}</span> : null}
          <span className="inline-flex items-center gap-1.5">
            <ProviderIcon className="size-5 text-[9px]" providerId={media.providerId} />
            {getPlatformLabel(media.providerId)}
          </span>
          {hasKnownDuration(media.durationSeconds) ? <span>{formatDuration(media.durationSeconds)}</span> : null}
          <span>{media.options.length} formats</span>
        </div>
      </div>
    </div>
  );
}

function formatPercent(value?: number | null) {
  return Number.isFinite(value) && value != null ? `${Math.round(value * 10) / 10}%` : undefined;
}

function formatNumber(value?: number | null) {
  return Number.isFinite(value) && value != null ? value.toLocaleString() : "checking";
}

function formatUptime(seconds?: number | null) {
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) {
    return "checking";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(1, minutes)}m`;
}

function formatOptionLabel(option: DownloadOption, settings?: ProcessingSettings) {
  const parts = uniqueOptionParts([
    option.quality,
    resolutionLabel(option),
    bitrateLabel(option),
    option.fps ? `${option.fps}fps` : undefined,
    option.extension.toUpperCase(),
    mediaCompositionLabel(option),
    processingPathLabel(option, settings),
    formatKnownBytes(option.sizeBytes)
  ]);

  return parts.length > 0 ? parts.join(" - ") : option.label;
}

function previewDownloadFileName(media: ExtractedMedia, option: DownloadOption, settings: ProcessingSettings) {
  const extension = outputExtensionForOption(option, settings);
  const renderedName = settings.filenameTemplate
    .replaceAll("{title}", media.title)
    .replaceAll("{ext}", extension)
    .trim() || media.title;
  const cleanName = stripMatchingExtension(safeFileName(renderedName), extension);

  return `${cleanName}.${extension}`;
}

function outputExtensionForOption(option: DownloadOption, settings: ProcessingSettings) {
  const audioContainers = new Set(["mp3", "m4a", "opus"]);

  if (option.mode === "audio" && settings.audioFormat !== "original") {
    return settings.audioFormat;
  }

  if (option.mode === "video" && settings.outputContainer !== "auto" && !audioContainers.has(settings.outputContainer)) {
    return settings.outputContainer;
  }

  return option.extension;
}

function stripMatchingExtension(fileName: string, extension: string) {
  return fileName.replace(new RegExp(`\\.${escapeRegExp(extension)}$`, "i"), "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKnownDuration(seconds?: number | null) {
  return Number.isFinite(seconds) && seconds != null && seconds >= 0;
}

function formatKnownBytes(bytes?: number | null) {
  return Number.isFinite(bytes) && bytes != null && bytes >= 0 ? formatBytes(bytes) : undefined;
}

export function legacyFormatOptionLabel(option: DownloadOption) {
  return formatOptionLabel(option);
}

function uniqueOptionParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();

  return parts.filter((part): part is string => {
    if (!part) {
      return false;
    }

    const normalizedPart = part.toLowerCase();

    if (seen.has(normalizedPart)) {
      return false;
    }

    seen.add(normalizedPart);
    return true;
  });
}

function resolutionLabel(option: DownloadOption) {
  return option.width && option.height ? `${option.width}x${option.height}` : undefined;
}

function bitrateLabel(option: DownloadOption) {
  return Number.isFinite(option.bitrateKbps) && option.bitrateKbps != null && option.bitrateKbps > 0
    ? `${option.bitrateKbps} kbps`
    : undefined;
}

function mediaCompositionLabel(option: DownloadOption) {
  if (option.hasVideo && option.hasAudio) {
    return "video+audio";
  }

  if (option.hasVideo) {
    return "video";
  }

  if (option.hasAudio) {
    return "audio";
  }

  return option.mode;
}

function processingPathLabel(option: DownloadOption, settings?: ProcessingSettings) {
  if (option.transport === "hls") {
    return "HLS";
  }

  if (option.transport === "dash") {
    return "DASH";
  }

  return optionNeedsClientFfmpeg(option, settings) ? "ffmpeg" : "direct";
}

function optionNeedsClientFfmpeg(option: DownloadOption, settings?: ProcessingSettings) {
  return Boolean(
    option.requiresFfmpeg ||
      settings?.streamHandling === "ffmpeg" ||
      (option.mode === "audio" && settings?.audioFormat !== undefined && settings.audioFormat !== "original") ||
      (settings?.processingPolicy !== undefined && settings.processingPolicy !== "auto" && settings.processingPolicy !== "copy")
  );
}

async function readJson<T>(response: Response): Promise<T | ApiErrorResponse> {
  return response.json() as Promise<T | ApiErrorResponse>;
}

function isOptionCompatible(option: DownloadOption, settings: ReturnType<typeof useProcessingSettings>["settings"]) {
  const audioContainers = new Set(["mp3", "m4a", "opus"]);

  if (settings.streamHandling === "direct" && option.requiresFfmpeg) {
    return false;
  }

  if (option.mode === "video" && audioContainers.has(settings.outputContainer)) {
    return false;
  }

  if (option.height && option.height > qualityCapToHeight(settings.qualityCap)) {
    return false;
  }

  return true;
}
