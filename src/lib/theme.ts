import { useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

/** Saved choice key. Also read by the inline script in index.html, so keep the two in sync. */
const KEY = "crm.theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: light)") : null;
const listeners = new Set<() => void>();

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** The user's saved choice, or the operating system's preference when they haven't picked one. */
function current(): Theme {
  return saved() ?? (media?.matches ? "light" : "dark");
}

function apply() {
  document.documentElement.dataset.theme = current();
  listeners.forEach((l) => l());
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  apply();
}

// Follow the OS setting live until the user makes a choice of their own.
// Also re-check when the tab comes back into view, in case the change event was missed.
const followSystem = () => { if (!saved() && document.documentElement.dataset.theme !== current()) apply(); };
media?.addEventListener("change", followSystem);
if (typeof document !== "undefined") document.addEventListener("visibilitychange", followSystem);
if (typeof window !== "undefined") window.addEventListener("focus", followSystem);

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, current, () => "dark" as Theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return [theme, setTheme];
}
