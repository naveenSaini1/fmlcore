"use client";

import { useEffect, useState } from "react";
import { createPost } from "../../lib/api";
import { CATEGORIES, MOODS } from "../../lib/taxonomy";
import PostCard from "./PostCard";

const MAX_BODY = 1000;

export default function Composer({ user, onCreated }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [mood, setMood] = useState("");
  const [anon, setAnon] = useState(false);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    if (prompt) setBody(`${prompt.slice(0, MAX_BODY)}\n\n`);
  }, []);

  function onFile(event) {
    const picked = event.target.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (picked) {
      setFile(picked);
      setPreviewUrl(URL.createObjectURL(picked));
    } else {
      setFile(null);
      setPreviewUrl(null);
    }
  }

  function clearImage() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  }

  function reset() {
    setBody("");
    setCategory("");
    setMood("");
    setAnon(false);
    clearImage();
    setShowPreview(false);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    if (!body.trim()) return setError("Say something first.");
    if (!category) return setError("Pick a category.");
    if (!mood) return setError("Pick a mood.");
    setPending(true);
    try {
      const post = await createPost({ body: body.trim(), category, mood, isAnonymous: anon, file });
      onCreated(post);
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  const previewPost = {
    id: "preview",
    body: body.trim() || "your words go here…",
    category: category || "Random Thoughts",
    mood: mood || "numb",
    image_url: previewUrl,
    is_anonymous: anon,
    author: anon ? null : { username: user.username, avatar_url: user.avatar_url },
    created_at: new Date().toISOString(),
  };

  const chip = "border-2 border-ink px-2.5 py-1 text-xs font-extrabold transition-transform active:translate-y-0.5";

  return (
    <form onSubmit={onSubmit} className="border-4 border-ink bg-lime p-5 shadow-[8px_8px_0_var(--color-shadow)]">
      <p className="font-note text-3xl leading-none">what happened this time?</p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
        placeholder="waved back at someone who wasn't waving at me…"
        className="mt-3 min-h-28 w-full resize-y border-4 border-ink bg-white px-3 py-3 text-base outline-none placeholder:text-ink/40"
      />
      <div className="mt-1 text-right font-note text-lg leading-none text-on-brand/70">{body.length}/{MAX_BODY}</div>

      <p className="mt-3 font-display text-xs font-extrabold uppercase tracking-wide">Category</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => setCategory(c)}
            className={`${chip} ${category === c ? "bg-ink text-on-ink" : "bg-white"}`}
          >
            {c}
          </button>
        ))}
      </div>

      <p className="mt-3 font-display text-xs font-extrabold uppercase tracking-wide">Mood</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {MOODS.map((m) => (
          <button
            type="button"
            key={m.key}
            onClick={() => setMood(m.key)}
            aria-pressed={mood === m.key}
            className={`${chip} ${mood === m.key ? "bg-ink text-on-ink" : "bg-white"}`}
          >
            <span aria-hidden>{m.emoji}</span> {m.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer border-2 border-ink bg-white px-3 py-2 text-xs font-extrabold">
          {file ? "Change image" : "Add image"}
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
        </label>
        {file ? (
          <button type="button" onClick={clearImage} className="border-2 border-ink bg-coral px-3 py-2 text-xs font-extrabold text-on-brand">
            Remove image
          </button>
        ) : null}
        <label className="flex items-center gap-2 border-2 border-ink bg-white px-3 py-2 text-xs font-extrabold">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="h-4 w-4 accent-ink" />
          Post anonymously
        </label>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="border-2 border-ink bg-purple px-3 py-2 text-xs font-extrabold text-on-brand"
        >
          {showPreview ? "Hide preview" : "Preview"}
        </button>
      </div>

      {showPreview ? (
        <div className="mt-4">
        <p className="font-note text-2xl leading-none text-on-brand/70">this is how it lands:</p>
          <div className="mt-2">
            <PostCard post={previewPost} preview />
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 border-4 border-ink bg-coral px-3 py-2 font-bold text-on-brand" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full border-4 border-ink bg-ink px-4 py-3 font-extrabold text-on-ink shadow-[4px_4px_0_var(--color-purple)] disabled:opacity-60"
      >
        {pending ? "Posting…" : "Post it"}
      </button>
    </form>
  );
}
