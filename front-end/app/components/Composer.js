"use client";

import { showErrorToast } from "./ErrorToast";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createPost } from "../../lib/api";
import { CATEGORIES, MOODS } from "../../lib/taxonomy";
import PostCard from "./PostCard";

const MAX_BODY = 1000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2_000_000;

export default function Composer({ user, onCreated, initialPrompt = "", focusOnOpen = false, onClose }) {
  const [body, setBody] = useState(() => initialPrompt ? `${initialPrompt}\n\n`.slice(0, MAX_BODY) : "");
  const [category, setCategory] = useState("");
  const [mood, setMood] = useState("");
  const [anon, setAnon] = useState(false);
  const [files, setFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [phone, setPhone] = useState(false);
  const fullscreen = Boolean(onClose && phone);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    function sync() { setPhone(query.matches); }
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [fullscreen]);

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviewUrls(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  function onFile(event) {
    const picked = Array.from(event.target.files);
    event.target.value = "";
    if (!picked.length) return;
    if (files.length + picked.length > MAX_IMAGES) return showErrorToast(`Pick up to ${MAX_IMAGES} images.`);
    if (picked.some(file => file.size > MAX_IMAGE_BYTES)) return showErrorToast("Each image must be 2 MB or smaller.");
    setFiles([...files, ...picked]);
  }

  function reset() {
    setBody("");
    setCategory("");
    setMood("");
    setAnon(false);
    setFiles([]);
    setShowPreview(false);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!body.trim()) return showErrorToast("Say something first.");
    if (!category) return showErrorToast("Pick a category.");
    if (!mood) return showErrorToast("Pick a mood.");
    setPending(true);
    try {
      const post = await createPost({ body: body.trim(), category, mood, isAnonymous: anon, files });
      onCreated(post);
      reset();
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setPending(false);
    }
  }

  const previewPost = {
    id: "preview",
    body: body.trim() || "your words go here…",
    category: category || "Random Thoughts",
    mood: mood || "numb",
    image_urls: previewUrls,
    is_anonymous: anon,
    author: anon ? null : { username: user.username, avatar_url: user.avatar_url },
    created_at: new Date().toISOString(),
  };

  const chip = "cursor-pointer rounded-full border-2 border-ink px-3 py-1.5 text-xs font-extrabold transition-colors hover:border-[var(--theme-accent,var(--color-ink))]";

  const form = (
    <form onSubmit={onSubmit} role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? "Create a post" : undefined}
      className={fullscreen ? "fixed inset-0 z-[80] flex h-dvh flex-col bg-white text-ink" : "story-composer border-4 border-ink bg-lime p-4 shadow-[8px_8px_0_var(--color-shadow)] sm:p-5"}>
      <header className={fullscreen ? "flex shrink-0 items-center justify-between gap-3 border-b border-ink/15 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]" : "flex items-center justify-between gap-3"}>
        <h2 className="font-display text-2xl font-extrabold">Write a post</h2>
        {onClose && <button type="button" onClick={onClose} disabled={pending} aria-label={fullscreen ? undefined : "Close composer"} className={`shrink-0 cursor-pointer border-2 border-ink bg-red-700 text-white hover:bg-red-800 disabled:cursor-default disabled:opacity-60 ${fullscreen ? "min-h-11 px-3 text-sm font-bold" : "grid h-9 w-9 place-items-center text-xl leading-none"}`}>{fullscreen ? "Cancel" : "×"}</button>}
      </header>

      <div className={fullscreen ? "min-h-0 flex-1 overflow-y-auto px-4 pb-4" : undefined}>
      <div>
        <textarea
          aria-label="Post text"
          autoFocus={focusOnOpen}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
          placeholder="waved back at someone who wasn't waving at me…"
          className="mt-4 min-h-32 w-full resize-y border-2 border-ink bg-white px-4 py-3 text-base leading-relaxed text-ink placeholder:text-ink/60"
        />
        <div className={`mt-1 text-right font-note text-lg leading-none ${fullscreen ? "text-ink/70" : "text-on-brand/70"}`}>{body.length}/{MAX_BODY}</div>
      </div>

      <div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:hidden">
          <label className="min-w-0 text-xs font-extrabold">
            Category
            <select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 min-h-11 w-full border-2 border-ink bg-white px-2 text-base text-ink">
              <option value="">Choose</option>
              {CATEGORIES.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs font-extrabold">
            Mood
            <select value={mood} onChange={event => setMood(event.target.value)} className="mt-1 min-h-11 w-full border-2 border-ink bg-white px-2 text-base text-ink">
              <option value="">Choose</option>
              {MOODS.map(item => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}
            </select>
          </label>
        </div>

        <div className="hidden sm:block">
          <p className="mt-3 font-display text-xs font-extrabold uppercase tracking-wide">Category</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
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

        </div>

        <div className="mt-3 grid grid-cols-2 items-center gap-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3">
          {files.length < MAX_IMAGES && (
            <label className="cursor-pointer border-2 border-ink bg-white px-3 py-2 text-xs font-extrabold">
              Add photos
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={onFile} />
            </label>
          )}
          <label className="col-span-2 row-start-1 flex min-h-11 items-center gap-2 border-2 border-ink bg-white px-3 py-2 text-xs font-extrabold">
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

        {files.length > 0 && (
          <div className="mt-3 grid max-w-72 grid-cols-4 gap-2" aria-label="Selected photos">
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="relative">
                {previewUrls[index] && <img src={previewUrls[index]} alt={file.name} className="aspect-square max-h-16 w-full border-2 border-ink object-cover" />}
                <button type="button" disabled={pending} aria-label={`Remove photo ${index + 1}`} onClick={() => setFiles(current => current.filter((_, position) => position !== index))} className="absolute right-0 top-0 h-6 w-6 bg-ink text-on-ink">×</button>
              </div>
            ))}
          </div>
        )}

        {showPreview ? (
          <div className="mt-4">
          <p className="font-note text-2xl leading-none text-on-brand/70">this is how it lands:</p>
            <div className="mt-2">
              <PostCard post={previewPost} preview />
            </div>
          </div>
        ) : null}
      </div>
      </div>

      <div className={fullscreen ? "flex shrink-0 gap-2 border-t border-ink/15 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" : "mt-4 flex gap-2"}>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 flex-1 cursor-pointer border-4 border-ink bg-ink px-4 py-2 font-extrabold text-on-ink shadow-[4px_4px_0_var(--color-purple)] disabled:cursor-default disabled:opacity-60"
        >
          {pending ? "Posting…" : "Publish post"}
        </button>
      </div>
    </form>
  );
  return fullscreen ? createPortal(form, document.body) : form;
}
