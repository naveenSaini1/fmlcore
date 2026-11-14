"use client";

import { showErrorToast } from "./ErrorToast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Field, { inputClass } from "./Field";
import ReportedPosts from "./ReportedPosts";
import SkinStudio from "./SkinStudio";
import { logout, mediaUrl, updateProfile, uploadAvatar } from "../../lib/api";
import { useSession } from "../../lib/session";
import { PROFILE_COLORS, PROFILE_STICKERS, profileColor, profileSticker } from "../../lib/profile-style";

function joinedLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ProfileSettings({ embedded = false, initialUser = null, onUserChange }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { user, ready: sessionReady } = useSession();
  const [username, setUsername] = useState(initialUser?.username || "");
  const [bio, setBio] = useState(initialUser?.bio || "");
  const [color, setColor] = useState(initialUser?.profile_color || "lime");
  const [sticker, setSticker] = useState(initialUser?.profile_sticker || "star");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!sessionReady) return;
    if (!user) { router.replace("/login"); return; }
    setUsername(user.username ?? "");
    setBio(user.bio || "");
    setColor(user.profile_color || "lime");
    setSticker(user.profile_sticker || "star");
    // Reinitialize drafts only when the account changes, preserving unsaved
    // edits when another preference on the shared user changes.
  }, [router, sessionReady, user?.id]);

  async function onSave(event) {
    event.preventDefault();
    setSaved("");
    setPending(true);
    try {
      const next = await updateProfile({
        username,
        bio,
        profile_color: color,
        profile_sticker: sticker,
      });
      setColor(next.profile_color);
      setSticker(next.profile_sticker);
      setSaved("Saved.");
      onUserChange?.(next);
      window.dispatchEvent(new Event("fmlcore:profile-change"));
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setPending(false);
    }
  }

  async function onAvatar(event) {
    const file = event.target.files?.[0];
    if (!file || pending) return;
    setSaved("");
    setPending(true);
    try {
      const next = await uploadAvatar(file);
      setSaved("New face, same person.");
      onUserChange?.(next);
      window.dispatchEvent(new Event("fmlcore:profile-change"));
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setPending(false);
      event.target.value = "";
    }
  }

  async function onLogout() {
    await logout();
    window.dispatchEvent(new Event("fmlcore:auth-change"));
    router.replace("/");
    router.refresh();
  }

  const Container = embedded ? "div" : "main";

  if (!user) {
    return (
      <>
        <Container className="px-4 py-16 font-bold">Opening your profile…</Container>
      </>
    );
  }

  const avatar = mediaUrl(user.avatar_url);

  return (
    <>
      <Container className={`profile-settings mx-auto grid max-w-5xl gap-6 md:grid-cols-[280px_1fr] ${embedded ? "" : "px-4 py-8"}`}>
        {!embedded && <motion.section
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 22 }}
          className="profile-identity h-fit border-4 border-ink p-4 text-on-brand shadow-[6px_6px_0_var(--color-shadow)]"
          style={{ backgroundColor: profileColor(color), "--profile-accent": profileColor(color) }}
        >
          <div className="relative flex h-40 items-center justify-center border-4 border-ink bg-paper">
            {avatar ? (
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <img src="/image/user.png" alt="" className="h-20 w-20 object-contain" />
            )}
            <motion.span
              className="absolute -right-3 -top-3 flex h-12 w-12 items-center justify-center border-2 border-ink bg-white text-2xl shadow-[3px_3px_0_var(--color-shadow)]"
              animate={reduce ? undefined : { rotate: [0, -5, 5, 0], y: [0, -2, 0] }}
              transition={reduce ? undefined : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
              aria-label={`${sticker} profile sticker`}
            >
              {profileSticker(sticker)}
            </motion.span>
          </div>
          <p className="mt-4 font-display text-2xl font-extrabold leading-none">@{user.username}</p>
          <p className="mt-2 font-note text-2xl leading-none">joined {joinedLabel(user.joined_at)}</p>
          <label className="mt-4 block cursor-pointer border-4 border-ink bg-lime px-3 py-2 text-center text-sm font-extrabold">
            Change photo
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={onAvatar} />
          </label>
        </motion.section>}

        <form onSubmit={onSave} className="space-y-4 border-4 border-ink bg-white p-5 shadow-[8px_8px_0_var(--color-shadow)]">
          {embedded ? <h3 className="font-display text-2xl font-extrabold">The details that make you.</h3> : <h1 className="font-display text-4xl font-extrabold leading-none">This is you.</h1>}
          <p className="font-semibold text-ink/80">{user.email}</p>
          {embedded && <label className="home-photo-upload">Change photo<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={onAvatar} /></label>}
          <p className="text-xs text-ink/70">Profile photos can be JPG, PNG or WebP, up to 8 MB.</p>
          <Field label="Username">
            <input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={20} required />
          </Field>
          <Field label="Bio" note={`${bio.length}/160`}>
            <textarea
              className={`${inputClass} min-h-28 resize-y`}
              value={bio}
              maxLength={160}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Say something true. Or don't."
            />
          </Field>
          <fieldset>
            <legend className="font-display text-xs font-extrabold uppercase tracking-wide">Profile color</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFILE_COLORS.map((item) => (
                <button key={item.key} type="button" aria-pressed={color === item.key} onClick={() => setColor(item.key)} className={`profile-color-choice border-2 border-ink px-3 py-2 text-sm font-extrabold text-on-brand ${color === item.key ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ backgroundColor: item.value }}>
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="font-display text-xs font-extrabold uppercase tracking-wide">Sticker</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {PROFILE_STICKERS.map((item) => (
                <button key={item.key} type="button" aria-label={item.label} aria-pressed={sticker === item.key} onClick={() => setSticker(item.key)} className={`border-2 border-ink bg-paper px-3 py-2 text-xl ${sticker === item.key ? "ring-2 ring-ink ring-offset-2" : ""}`}>
                  {item.emoji}
                </button>
              ))}
            </div>
          </fieldset>
          {saved ? <p className="font-note text-3xl leading-none">{saved}</p> : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={pending}
              className="border-4 border-ink bg-lime px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60"
            >
              {pending ? "Working…" : "Save profile"}
            </button>
            <button type="button" onClick={onLogout} className="border-4 border-ink bg-coral px-4 py-3 font-extrabold text-on-brand">
              Log out
            </button>
            {!embedded && <Link href="/" className="border-4 border-ink px-4 py-3 text-center font-extrabold">
              Home
            </Link>}
          </div>
        </form>
        <section className="md:col-span-2 border-4 border-ink bg-white p-5"><SkinStudio embedded /></section>
        <div className="md:col-span-2">
          <ReportedPosts />
        </div>
      </Container>
    </>
  );
}
