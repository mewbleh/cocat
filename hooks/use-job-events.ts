"use client";

import { useEffect, useState } from "react";

import type { JobProgressEvent } from "@/lib/contracts";
import { serverApiUrlWithToken, type ServerSettings } from "@/lib/server-settings";

const TERMINAL_EVENT_TYPES = new Set(["complete", "failed", "expired", "cancelled"]);

export function useJobEvents(jobId: string | null, serverSettings: ServerSettings) {
  const [event, setEvent] = useState<JobProgressEvent | null>(null);
  const [connectedJobId, setConnectedJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      return undefined;
    }

    const events = new EventSource(serverApiUrlWithToken(`/api/jobs/${jobId}/events`, serverSettings));

    events.onopen = () => setConnectedJobId(jobId);
    events.onerror = () => setConnectedJobId((currentJobId) => (currentJobId === jobId ? null : currentJobId));
    events.onmessage = (message) => {
      try {
        const parsedEvent = JSON.parse(message.data) as JobProgressEvent;

        if (parsedEvent.jobId !== jobId) {
          return;
        }

        setEvent(parsedEvent);

        if (TERMINAL_EVENT_TYPES.has(parsedEvent.type)) {
          events.close();
          setConnectedJobId((currentJobId) => (currentJobId === jobId ? null : currentJobId));
        }
      } catch {
        setEvent({
          type: "failed",
          jobId,
          errorCode: "BAD_EVENT",
          message: "The job stream sent an invalid event."
        });
      }
    };

    return () => {
      events.close();
      setConnectedJobId((currentJobId) => (currentJobId === jobId ? null : currentJobId));
    };
  }, [jobId, serverSettings]);

  return jobId ? { event: event?.jobId === jobId ? event : null, isConnected: connectedJobId === jobId } : { event: null, isConnected: false };
}
