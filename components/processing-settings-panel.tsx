"use client";

import { RotateCcw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExtractedMedia, ProcessingSettings } from "@/lib/contracts";
import {
  AUDIO_FORMATS,
  CODEC_PREFERENCES,
  OUTPUT_CONTAINERS,
  PROCESSING_POLICIES,
  PROCESSING_POLICY_LABELS,
  QUALITY_CAPS,
  STREAM_HANDLING
} from "@/lib/processing-settings";

type ProcessingSettingsPanelProps = {
  media: ExtractedMedia | null;
  settings: ProcessingSettings;
  onSettingsChange(settings: ProcessingSettings): void;
  onReset(): void;
};

export function ProcessingSettingsPanel({
  media,
  settings,
  onSettingsChange,
  onReset
}: ProcessingSettingsPanelProps) {
  const constraints = media?.settingConstraints;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Processing settings</DialogTitle>
          <DialogDescription>Saved locally in this browser.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <SettingSelect
              label="Quality cap"
              value={settings.qualityCap}
              values={constraints?.qualityCaps ?? QUALITY_CAPS}
              onValueChange={(qualityCap) => onSettingsChange({ ...settings, qualityCap })}
            />
            <SettingSelect
              label="Output"
              value={settings.outputContainer}
              values={constraints?.outputContainers ?? OUTPUT_CONTAINERS}
              onValueChange={(outputContainer) => onSettingsChange({ ...settings, outputContainer })}
            />
            <SettingSelect
              label="Codec"
              value={settings.codecPreference}
              values={constraints?.codecPreferences ?? CODEC_PREFERENCES}
              onValueChange={(codecPreference) => onSettingsChange({ ...settings, codecPreference })}
            />
            <SettingSelect
              label="Audio format"
              value={settings.audioFormat}
              values={constraints?.audioFormats ?? AUDIO_FORMATS}
              onValueChange={(audioFormat) => onSettingsChange({ ...settings, audioFormat })}
            />
            <SettingSelect
              label="Audio bitrate"
              value={settings.audioBitrateKbps.toString()}
              values={["96", "128", "192", "256", "320"]}
              onValueChange={(audioBitrateKbps) =>
                onSettingsChange({ ...settings, audioBitrateKbps: Number(audioBitrateKbps) as ProcessingSettings["audioBitrateKbps"] })
              }
            />
            <div className="grid gap-1 text-sm font-medium sm:col-span-2">
              <span>Processing</span>
              <ProcessingPolicyTabs
                value={settings.processingPolicy}
                onValueChange={(processingPolicy) => onSettingsChange({ ...settings, processingPolicy })}
              />
            </div>
            <SettingSelect
              label="Streams"
              value={settings.streamHandling}
              values={STREAM_HANDLING}
              onValueChange={(streamHandling) => onSettingsChange({ ...settings, streamHandling })}
            />
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Filename template
              <Input
                value={settings.filenameTemplate}
                onChange={(event) => onSettingsChange({ ...settings, filenameTemplate: event.target.value })}
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleRow
              checked={settings.mergeAudioVideo}
              label="Merge audio/video"
              onCheckedChange={(mergeAudioVideo) => onSettingsChange({ ...settings, mergeAudioVideo })}
            />
            <ToggleRow
              checked={settings.embedMetadata}
              label="Embed metadata"
              onCheckedChange={(embedMetadata) => onSettingsChange({ ...settings, embedMetadata })}
            />
            <ToggleRow
              checked={settings.showProviderDebug}
              label="Provider debug"
              onCheckedChange={(showProviderDebug) => onSettingsChange({ ...settings, showProviderDebug })}
            />
          </div>

          {media ? (
            <div className="grid gap-2 rounded-md border bg-secondary/40 p-3 text-sm">
              <div className="font-medium">Provider capabilities</div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <CapabilityLabel active={media.capabilities.directDownload} label="Direct" />
                <CapabilityLabel active={media.capabilities.hls} label="HLS" />
                <CapabilityLabel active={media.capabilities.dash} label="DASH" />
                <CapabilityLabel active={media.capabilities.adaptive} label="Adaptive" />
                <CapabilityLabel active={media.capabilities.audioOnly} label="Audio" />
                <CapabilityLabel active={media.capabilities.subtitles} label="Subtitles" />
                <CapabilityLabel active={media.capabilities.thumbnails} label="Thumbnail" />
                <CapabilityLabel active={media.capabilities.requiresFfmpeg} label="ffmpeg" />
              </div>
              {settings.showProviderDebug && media.debug ? (
                <pre className="max-h-40 overflow-auto rounded-sm bg-background p-2 text-xs text-muted-foreground">
                  {JSON.stringify(media.debug, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={onReset} variant="outline">
            <RotateCcw />
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProcessingPolicyTabs({
  value,
  onValueChange
}: {
  value: ProcessingSettings["processingPolicy"];
  onValueChange(value: ProcessingSettings["processingPolicy"]): void;
}) {
  return (
    <Tabs value={value} onValueChange={(nextValue) => onValueChange(nextValue as ProcessingSettings["processingPolicy"])}>
      <TabsList aria-label="Processing mode" className="grid w-full grid-cols-4">
        {PROCESSING_POLICIES.map((policy) => (
          <TabsTrigger key={policy} value={policy}>
            {PROCESSING_POLICY_LABELS[policy]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function SettingSelect<TValue extends string>({
  label,
  value,
  values,
  onValueChange
}: {
  label: string;
  value: TValue;
  values: readonly TValue[];
  onValueChange(value: TValue): void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as TValue)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((item) => (
            <SelectItem key={item} value={item}>
              {formatSettingValue(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ToggleRow({
  checked,
  label,
  onCheckedChange
}: {
  checked: boolean;
  label: string;
  onCheckedChange(value: boolean): void;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm font-medium">
      {label}
      <input
        checked={checked}
        className="size-4 accent-primary"
        onChange={(event) => onCheckedChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function CapabilityLabel({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? "text-primary" : ""}>{active ? "Yes" : "No"} {label}</span>;
}

function formatSettingValue(value: string) {
  return value
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
