"use client";

import { useRef, useState } from "react";
import { mediaUrl } from "../../lib/api";

export default function PostPhotos({ images }) {
  const track = useRef(null);
  const [position, setPosition] = useState(0);
  const multiple = images.length > 1;
  const current = Math.min(position, images.length - 1);

  function goTo(index) {
    const viewport = track.current;
    const next = Math.max(0, Math.min(index, images.length - 1));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollTo({ left: next * viewport.clientWidth, behavior: reducedMotion ? "instant" : "smooth" });
  }

  return (
    <div aria-label="Post photos" className="post-image mt-4 w-full min-w-0 max-w-md overflow-hidden border-4 border-ink bg-paper">
      <div className="relative">
        <div ref={track} onScroll={event => {
          const viewport = event.currentTarget;
          if (viewport.clientWidth) setPosition(Math.round(viewport.scrollLeft / viewport.clientWidth));
        }} className="flex h-[min(65vw,20rem)] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] lg:h-[clamp(20rem,27vw,24rem)]">
          {images.map((url, index) => (
            <div key={`${url}-${index}`} className="flex w-full shrink-0 snap-start items-center justify-center">
              <img src={mediaUrl(url)} alt={`Post photo ${index + 1}`} loading="lazy" className="h-full w-full object-contain" />
            </div>
          ))}
        </div>
        {multiple && (
          <>
            <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-ink px-2 py-1 text-xs font-bold text-on-ink" aria-live="polite">{current + 1} / {images.length}</span>
            <div className="pointer-events-none absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
              <button type="button" aria-label="Previous photo" disabled={current === 0} onClick={() => goTo(current - 1)} className="pointer-events-auto h-10 w-10 cursor-pointer rounded-full bg-ink text-xl leading-none text-on-ink disabled:invisible sm:h-11 sm:w-11">‹</button>
              <button type="button" aria-label="Next photo" disabled={current === images.length - 1} onClick={() => goTo(current + 1)} className="pointer-events-auto h-10 w-10 cursor-pointer rounded-full bg-ink text-xl leading-none text-on-ink disabled:invisible sm:h-11 sm:w-11">›</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
