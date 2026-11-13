"use client";

import { useState } from "react";
import { api } from "../../lib/api";

export default function ShareStory({ post, onCount }) {
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copyUrl, setCopyUrl] = useState("");

  async function completeShare() {
    setShared(true);
    try {
      const result = await api(`/posts/${post.id}/share`, { method: "POST" });
      onCount(result.share_count);
    } catch {
      // Copying or sharing still succeeded if the count request failed.
    }
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    const url = new URL(`/posts/${post.id}`, window.location.origin).href;
    setShared(false);
    setCopyUrl("");
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: post.surface === "confession" ? "FMLCore confession" : "FMLCore post", url });
          await completeShare();
          return;
        } catch (error) {
          if (error.name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        await completeShare();
      } catch {
        setCopyUrl(url);
      }
    } finally {
      setSharing(false);
    }
  }

  const label = post.surface === "confession" ? "Share confession" : "Share post";
  return <div className="post-share-action">
    <button type="button" onClick={share} disabled={sharing} data-shared={shared}
      aria-label={`${label} (${post.share_count ?? 0} shares)`} className="post-engagement-button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {shared ? <path d="m5 12 4 4L19 6" /> : <path d="m22 2-7 20-4-9-9-4L22 2ZM22 2 11 13" />}
      </svg>
      <span aria-hidden="true">{post.share_count ?? 0}</span>
    </button>
    {shared && <span className="sr-only" role="status">Share link ready</span>}
    {copyUrl && <input aria-label="Story link" value={copyUrl} readOnly onFocus={event => event.target.select()} onCopy={() => { if (!shared) void completeShare(); }} className="mt-1 w-full border border-ink bg-white p-1 text-xs" />}
  </div>;
}
