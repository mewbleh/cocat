"use client";

import { useState } from "react";

import { DEFAULT_PROCESSING_SETTINGS, type ProcessingSettings } from "@/lib/contracts";
import { parseStoredProcessingSettings, serializeProcessingSettings } from "@/lib/processing-settings";

const STORAGE_KEY = "cocat.processing-settings.v1";

export function useProcessingSettings() {
  const [settings, setSettings] = useState<ProcessingSettings>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PROCESSING_SETTINGS;
    }

    return parseStoredProcessingSettings(window.localStorage.getItem(STORAGE_KEY));
  });

  function updateSettings(nextSettings: ProcessingSettings) {
    setSettings(nextSettings);
    window.localStorage.setItem(STORAGE_KEY, serializeProcessingSettings(nextSettings));
  }

  function resetSettings() {
    updateSettings(DEFAULT_PROCESSING_SETTINGS);
  }

  return {
    settings,
    setSettings: updateSettings,
    resetSettings
  };
}
