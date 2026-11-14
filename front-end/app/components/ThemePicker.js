"use client";

import { useErrorToast } from "./ErrorToast";
import { useId } from "react";
import { THEMES, SYSTEM_THEME, themeByKey } from "../../lib/themes";
import { useTheme } from "./ThemeProvider";

const LABELS = { system: "Auto", "acid-lime": "Lime", "electric-purple": "Purple", "chaos-coral": "Coral", midnight: "Night", "classic-paper": "Paper" };

export default function ThemePicker() {
  const headingId = useId();
  const { theme, chooseTheme, ready, saving, error } = useTheme();
  useErrorToast(error);
  return <section className="theme-picker" aria-labelledby={headingId}>
    <h3 id={headingId}>Color theme</h3>
    <p className="theme-picker-description">Set the colors. Keep your favorite layout.</p>
    <div className="theme-circles" role="group" aria-label="Choose your color theme">
      {[SYSTEM_THEME, ...THEMES].map((item) => <button type="button" key={item.key} className="skin-circle-choice" aria-label={item.label} title={item.label} aria-pressed={theme === item.key} disabled={!ready || saving} onClick={() => chooseTheme(item.key)}>
        <span className="skin-circle-swatch" style={{ background: item.color }}>{theme === item.key && <span className="skin-circle-check" aria-hidden="true">✓</span>}</span>
        <span className="skin-circle-name">{LABELS[item.key]}</span>
      </button>)}
    </div>
    <p className="skin-current" role="status">{saving ? "Saving your colors…" : themeByKey(theme).label + " · your colors"}</p>
  </section>;
}
