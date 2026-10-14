"use client";

import { useEffect, useState } from "react";
import { followSystemTheme, setSiteTheme, themeChoice, type ThemeChoice } from "../lib/site-theme";

const options: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" }
];

/** Light / Dark / System. System follows the device until the viewer picks one. */
export function ThemeChoicePicker({ className = "theme-choice" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => setChoice(themeChoice()), []);
  const pick = (next: ThemeChoice) => {
    if (next === "system") followSystemTheme(); else setSiteTheme(next);
    setChoice(next);
  };
  return (
    <div className={className} role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={choice === option.id} className={choice === option.id ? "on" : ""} onClick={() => pick(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}
