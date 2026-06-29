"use client";

import { ExternalLink, Github, Info, ShieldCheck } from "lucide-react";

import { ProviderIcon } from "@/components/provider-icon";
import { PROVIDER_IDS } from "@/lib/contracts";
import { getPlatformLabel } from "@/lib/utils";

const GITHUB_REPOSITORY_URL = "https://github.com/mewbleh/cocat";

export function AboutPanel() {
  return (
    <section className="grid gap-4 rounded-lg border bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">About CoCat</h2>
          <p className="text-sm text-muted-foreground">Privacy-minded media extraction with short-lived jobs.</p>
        </div>
        <Info className="size-5 text-primary" />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoBlock title="Processing" value="Direct downloads when possible; ffmpeg only when needed." />
        <InfoBlock title="Storage" value="Source tokens and jobs expire from server memory." />
        <InfoBlock title="Security" value="Self-hosted servers can require an access token." />
      </div>

      <a
        className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-3 text-sm font-medium transition-colors hover:bg-secondary"
        href={GITHUB_REPOSITORY_URL}
        rel="noreferrer"
        target="_blank"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Github className="size-4 shrink-0" />
          <span className="truncate">github.com/mewbleh/cocat</span>
        </span>
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
      </a>

      <section aria-label="Privacy policy" className="grid gap-3 rounded-md border bg-background/80 p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Privacy policy</h3>
          <ShieldCheck className="size-4 text-primary" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoBlock title="Browser data" value="Settings, custom server URL, and optional access token stay in this browser." />
          <InfoBlock title="Server data" value="Source tokens, jobs, and temporary files are short-lived and expire automatically." />
          <InfoBlock title="Analytics" value="CoCat does not include analytics scripts, ads, or third-party trackers." />
          <InfoBlock title="Provider requests" value="The configured CoCat server contacts source providers when inspecting public media URLs." />
        </div>
      </section>

      <section aria-label="Supported providers" className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Supported sources</h3>
          <ShieldCheck className="size-4 text-primary" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {PROVIDER_IDS.map((providerId) => (
            <span
              className="flex min-h-10 items-center gap-2 rounded-md border bg-background/80 px-2 text-sm text-muted-foreground"
              key={providerId}
            >
              <ProviderIcon className="size-6" providerId={providerId} />
              <span className="truncate">{getPlatformLabel(providerId)}</span>
            </span>
          ))}
        </div>
      </section>
    </section>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="grid gap-1 border-l-2 border-primary/40 pl-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}
