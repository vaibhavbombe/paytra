"use client";

import { useEffect, useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY as STORAGE_KEY } from "@/lib/theme";

export type Theme = "system" | "light" | "dark";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system"; // storage blocked (private mode etc.)
  }
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted, but still applied for this page view.
  }
  applyTheme(theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the theme.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyTheme(readTheme());
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function ThemeToggle() {
  // Server render assumes "system"; the real value is read after hydration,
  // so there is no hydration mismatch.
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as const);

  // In "system" mode, follow the OS live when it switches light/dark.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-border p-0.5 text-xs">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={`rounded px-2.5 py-1 font-medium ${
            theme === t.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-hover"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
