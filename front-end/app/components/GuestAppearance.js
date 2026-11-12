"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import SkinStudio from "./SkinStudio";

export default function GuestAppearance() {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  function show() {
    dialog.current?.showModal();
    setOpen(true);
  }
  function close() { dialog.current?.close(); }
  return <div className="guest-appearance">
    <button ref={trigger} type="button" className="guest-appearance-trigger" aria-label="Skins and colors" title="Skins and colors" aria-haspopup="dialog" aria-expanded={open} disabled={!mounted} onClick={show}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.6-3.2 1.5 1.5 0 0 1 1.2-2.4H17a4 4 0 0 0 4-4A9 9 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r=".7" /><circle cx="10" cy="6.8" r=".7" /><circle cx="14" cy="6.8" r=".7" /><circle cx="17" cy="10" r=".7" /></svg>
      <span>Skins & colors</span>
    </button>
    {mounted && createPortal(<dialog ref={dialog} className="guest-appearance-dialog" aria-labelledby="guest-appearance-title" onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    }}>
      <div className="guest-appearance-heading"><h2 id="guest-appearance-title">Skins & colors</h2><button type="button" onClick={close} aria-label="Close appearance settings">×</button></div>
      <SkinStudio embedded />
      <p className="guest-appearance-note">Your choices stay on this device.</p>
    </dialog>, document.body)}
  </div>;
}
