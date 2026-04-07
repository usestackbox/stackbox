// render/hooks/useTheme.ts
// Reads theme settings from localStorage and injects CSS custom property
// overrides onto :root so components can react without re-rendering.

import { useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";

export type ThemeMode = "dark" | "light" | "system";
export type FontSize = "sm" | "md" | "lg";
export type Density = "compact" | "normal" | "relaxed";

export interface ThemeSettings {
  mode: ThemeMode;
  fontSize: FontSize;
  density: Density;
}

const DEFAULTS: ThemeSettings = {
  mode: "dark",
  fontSize: "md",
  density: "normal",
};

const FONT_SIZE_MAP: Record<FontSize, string> = {
  sm: "12px",
  md: "13px",
  lg: "15px",
};

const DENSITY_MAP: Record<Density, { spacing: string; rowH: string }> = {
  compact: { spacing: "4px", rowH: "26px" },
  normal: { spacing: "6px", rowH: "32px" },
  relaxed: { spacing: "10px", rowH: "40px" },
};

function applyVars(settings: ThemeSettings) {
  const root = document.documentElement;
  root.style.setProperty("--font-size-base", FONT_SIZE_MAP[settings.fontSize]);
  root.style.setProperty("--spacing-row", DENSITY_MAP[settings.density].spacing);
  root.style.setProperty("--row-height", DENSITY_MAP[settings.density].rowH);

  // Light mode is a future feature — dark is the only shipping theme.
  root.setAttribute(
    "data-theme",
    settings.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : settings.mode
  );
}

export function useTheme() {
  const [settings, setSettings] = useLocalStorage<ThemeSettings>("sb:theme", DEFAULTS);

  // Apply vars whenever settings change.
  useEffect(() => {
    applyVars(settings);
  }, [settings]);

  // React to system preference changes when mode = "system".
  useEffect(() => {
    if (settings.mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyVars(settings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  return { settings, setSettings };
}
