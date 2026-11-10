"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SKINS, skinById } from "../../lib/skins";
import { useSkin } from "./SkinProvider";

function Preview({ skin }) {
  if (skin.id === "common-ground") return <div className="ground-preview" aria-hidden="true">
    <div className="ground-preview-header"><b>FMLCore<span>✳</span></b><span>Explore　 Stories　 You</span></div>
    <div className="ground-preview-content"><div><span className="ground-preview-eyebrow">A LITTLE SHARED HUMANITY</span><strong>Life happens.<br />You belong here.</strong><div className="ground-preview-story"><span>●　a familiar feeling</span><p>Sometimes, “same here” is all you need.</p><small>♡　Been there　　↗　Reply</small></div></div><aside><span>✳</span><b>Find your people.</b><i /><i /></aside></div>
  </div>;
  return <div className="skin-preview" data-preview-skin={skin.id} style={{ "--preview-bg": skin.preview[0], "--preview-surface": skin.preview[1], "--preview-primary": skin.preview[2], "--preview-accent": skin.preview[3] }} aria-hidden="true">
    <span className="skin-preview-brand">FML</span><span className="skin-preview-nav" />
    <div className="skin-preview-main"><i /><b /><small /></div><div className="skin-preview-side"><i /><small /></div>
  </div>;
}

export default function SkinStudio() {
  const { skin: savedSkin, chooseSkin, ready, saving, error } = useSkin();
  const [previewSkin, setPreviewSkin] = useState(null);
  const [notice, setNotice] = useState("");
  const reduce = useReducedMotion();
  const active = previewSkin || savedSkin;
  const appliedRef = useRef(savedSkin);
  appliedRef.current = savedSkin;

  useEffect(() => () => {
    document.documentElement.dataset.skin = appliedRef.current;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.skin = previewSkin || savedSkin;
  }, [previewSkin, savedSkin]);

  const preview = (id) => {
    setNotice(""); setPreviewSkin(id); document.documentElement.dataset.skin = id;
  };
  const cancel = () => { setPreviewSkin(null); document.documentElement.dataset.skin = savedSkin; };
  const apply = async () => {
    const choice = active;
    const ok = await chooseSkin(choice);
    if (ok) { setPreviewSkin(null); setNotice(`${skinById(choice).name} is now your FMLCore skin.`); }
  };

  return <main className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
    <section className="skin-studio-hero">
      <p className="font-note text-2xl">Skin Studio</p><h1>Make FMLCore yours.</h1>
      <p>Choose the way you want to experience the internet.</p>
    </section>
    <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {SKINS.map((item) => {
        const selected = active === item.id;
        const applied = savedSkin === item.id;
        return <motion.article key={item.id} layout={!reduce} className={`skin-card ${selected ? "skin-card-selected" : ""}`}>
          <Preview skin={item} />
          <div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2>{item.name}</h2><p>{item.tagline}</p></div>{applied ? <span className="skin-selected">Applied</span> : null}</div>
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => preview(item.id)} className="skin-secondary" aria-pressed={selected}>Preview</button>{selected ? <button type="button" onClick={apply} disabled={!ready || saving} className="skin-primary">{saving ? "Applying…" : applied ? "Apply again" : "Apply"}</button> : null}</div></div>
        </motion.article>;
      })}
    </div>
    <AnimatePresence>{previewSkin ? <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: 8 }} className="skin-preview-bar" role="status"><span>Previewing <strong>{skinById(previewSkin).name}</strong></span><div><button type="button" onClick={cancel} className="skin-secondary">Cancel</button><button type="button" onClick={apply} disabled={!ready || saving} className="skin-primary">{saving ? "Applying…" : "Apply this skin"}</button></div></motion.div> : null}</AnimatePresence>
    {notice ? <p className="mt-6 font-bold text-lime" role="status">✓ {notice}</p> : null}{error ? <p className="mt-4 font-bold text-danger" role="alert">{error}</p> : null}
  </main>;
}
