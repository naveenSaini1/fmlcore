"use client";

import { useState } from "react";
import { SKINS, skinById } from "../../lib/skins";
import { useSkin } from "./SkinProvider";
import ThemePicker from "./ThemePicker";

export default function SkinStudio({ embedded = false }) {
  const { skin, chooseSkin, ready, saving, error } = useSkin();
  const [notice, setNotice] = useState("");
  const Container = embedded ? "div" : "main";
  const Heading = embedded ? "h2" : "h1";
  async function select(id) {
    setNotice("");
    if (id === skin) return;
    if (await chooseSkin(id)) setNotice(skinById(id).name + " applied.");
  }
  return <Container className={"skin-studio skin-studio-compact " + (embedded ? "" : "skin-studio-page")}>
    <p className="home-eyebrow">MAKE IT FEEL LIKE YOU</p>
    <Heading>Skins</Heading>
    <p className="skin-circle-description">A different mood for your everyday.</p>
    <div className="skin-circles" role="group" aria-label="Choose your skin">
      {SKINS.map((item) => <button key={item.id} type="button" className="skin-circle-choice" aria-label={item.name} title={item.name} aria-pressed={skin === item.id} disabled={!ready || saving} onClick={() => select(item.id)}>
        <span className="skin-circle-swatch" style={{ background: "conic-gradient(" + item.preview[2] + " 0deg 135deg, " + item.preview[0] + " 135deg 270deg, " + item.preview[3] + " 270deg)" }}>
          {skin === item.id && <span className="skin-circle-check" aria-hidden="true">✓</span>}
        </span>
        <span className="skin-circle-name">{item.name === "Common Ground" ? "Ground" : item.name === "Calm Chaos" ? "Calm" : item.name === "Social Classic" ? "Social" : item.name === "After Hours" ? "Night" : item.name}</span>
      </button>)}
    </div>
    <p className="skin-current" role="status">{saving ? "Saving your look…" : notice || (skinById(skin).name + " · your current look")}</p>
    {error && <p className="text-danger" role="alert">{error}</p>}
    <ThemePicker />
  </Container>;
}
