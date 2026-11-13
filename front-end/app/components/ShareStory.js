"use client";

import { useState } from "react";

export default function ShareStory({ post }) {
  const [message, setMessage] = useState("");
  const [copyUrl, setCopyUrl] = useState("");

  async function share() {
    const url = new URL(`/posts/${post.id}`, window.location.origin).href;
    setMessage("");
    setCopyUrl("");
    if (navigator.share) {
      try {
        await navigator.share({ title: post.surface === "confession" ? "FMLCore confession" : "FMLCore post", url });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied.");
    } catch {
      setCopyUrl(url);
    }
  }

  return <div className="mt-2">
    <button type="button" onClick={share} className="text-sm font-extrabold underline">Share {post.surface === "confession" ? "confession" : "post"}</button>
    {message && <p className="text-xs" role="status">{message}</p>}
    {copyUrl && <input aria-label="Story link" value={copyUrl} readOnly onFocus={event => event.target.select()} className="mt-1 w-full border border-ink bg-white p-1 text-xs" />}
  </div>;
}
