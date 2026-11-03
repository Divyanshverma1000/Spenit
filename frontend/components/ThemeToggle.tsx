"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Smartphone } from "lucide-react";

export type ThemePref = "system" | "light" | "dark";
const STORAGE_KEY = "spenit-theme";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemePref | null;
      if (saved === "light" || saved === "dark" || saved === "system") setPref(saved);
    } catch {}
  }, []);

  // Follow the OS setting live while the user is on "system".
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  function choose(next: ThemePref) {
    setPref(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    apply(next);
  }

  return { pref, choose };
}

const OPTIONS: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "Auto", icon: <Smartphone size={14} /> },
  { value: "light", label: "Light", icon: <Sun size={14} /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} /> },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { pref, choose } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={`flex items-center gap-1 p-1 rounded-[12px] bg-[var(--paper-dim)] ${className}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => choose(o.value)}
          className={`flex-1 justify-center flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[13px] font-semibold transition-colors ${
            pref === o.value
              ? "bg-[var(--accent)] text-white shadow-sm"
              : "text-[var(--text-secondary)]"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
