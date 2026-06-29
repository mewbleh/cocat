"use client";

import { useState } from "react";

import {
  DEFAULT_SERVER_SETTINGS,
  parseStoredServerSettings,
  serializeServerSettings,
  type ServerSettings
} from "@/lib/server-settings";

const STORAGE_KEY = "cocat.server-settings.v1";

export function useServerSettings() {
  const [settings, setSettings] = useState<ServerSettings>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_SERVER_SETTINGS;
    }

    return parseStoredServerSettings(window.localStorage.getItem(STORAGE_KEY));
  });

  function updateSettings(nextSettings: ServerSettings) {
    setSettings(nextSettings);
    window.localStorage.setItem(STORAGE_KEY, serializeServerSettings(nextSettings));
  }

  function resetSettings() {
    updateSettings(DEFAULT_SERVER_SETTINGS);
  }

  return {
    resetSettings,
    serverSettings: settings,
    setServerSettings: updateSettings
  };
}
