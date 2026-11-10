"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Field, { inputClass } from "../components/Field";
import ReportedPosts from "../components/ReportedPosts";
import { getMe, logout, mediaUrl, updateProfile, uploadAvatar } from "../../lib/api";
import { PROFILE_COLORS, PROFILE_STICKERS, profileColor, profileSticker } from "../../lib/profile-style";

function joinedLabel(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ProfilePage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [color, setColor] = useState("lime");
  const [sticker, setSticker] = useState("star");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        setUser(me);
        setUsername(me.username);
        setBio(me.bio || "");
        setColor(me.profile_color || "lime");
        setSticker(me.profile_sticker || "star");
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  async function onSave(event) {
    event.preventDefault();
    setError("");
    setSaved("");
    setPending(true);
    try {
      const next = await updateProfile({
        username,
        bio,
        profile_color: color,
        profile_sticker: sticker,
      });
      setUser(next);
      setColor(next.profile_color);
      setSticker(next.profile_sticker);
      setSaved("Saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  async function onAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setSaved("");
    setPending(true);
    try {
      const next = await uploadAvatar(file);
      setUser(next);
      setSaved("New face, same person.");
    } catch (err) {
      setError(err.message);
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

  if (!user) {
    return (
      <>
        <main className="px-4 py-16 font-bold">Opening your profile…</main>
      </>
    );
  }

  const avatar = mediaUrl(user.avatar_url);

  return (
    <>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 md:grid-cols-[280px_1fr]">
        <motion.section
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
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={onAvatar} />
          </label>
        </motion.section>

        <form onSubmit={onSave} className="space-y-4 border-4 border-ink bg-white p-5 shadow-[8px_8px_0_var(--color-shadow)]">
          <h1 className="font-display text-4xl font-extrabold leading-none">This is you.</h1>
          <p className="font-semibold text-ink/80">{user.email}</p>
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
          {error ? (
            <p className="border-4 border-ink bg-coral px-3 py-2 font-bold text-on-brand" role="alert">
              {error}
            </p>
          ) : null}
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
            <Link href="/" className="border-4 border-ink px-4 py-3 text-center font-extrabold">
              Home
            </Link>
          </div>
        </form>
        <div className="md:col-span-2">
          <ReportedPosts />
        </div>
      </main>
    </>
  );
}
