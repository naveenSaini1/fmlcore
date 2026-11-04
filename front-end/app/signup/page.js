"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Field, { inputClass } from "../components/Field";
import SiteHeader from "../components/SiteHeader";
import { signup } from "../../lib/api";

export default function SignupPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await signup({
        email: String(form.get("email") || ""),
        username: String(form.get("username") || ""),
        password,
        age_confirmed: form.get("age") === "on",
      });
      window.dispatchEvent(new Event("fmlcore:auth-change"));
      router.push("/profile");
      router.refresh();
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[0.8fr_1.1fr] md:py-12">
        <section className="md:pt-8">
          <p className="font-note text-4xl leading-none">no highlight reel required</p>
          <h1 className="mt-2 font-display text-5xl font-extrabold leading-[0.9]">Make the account.</h1>
          <p className="mt-4 max-w-sm font-semibold">
            This is just you. Posting, reactions, and the rest wait until the profile exists.
          </p>
        </section>
        <motion.form
          onSubmit={onSubmit}
          initial={reduce ? false : { opacity: 0, rotate: -1, y: 10 }}
          animate={{ opacity: 1, rotate: 0, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="space-y-4 border-4 border-ink bg-white p-5 shadow-[8px_8px_0_var(--color-shadow)]"
        >
          <Field label="Email">
            <input className={inputClass} name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Username" note="letters, numbers, underscores">
            <input className={inputClass} name="username" autoComplete="username" minLength={3} maxLength={20} required />
          </Field>
          <Field label="Password" note="8 characters, keep it yours">
            <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          </Field>
          <Field label="Again">
            <input className={inputClass} name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          </Field>
          <label className="flex items-start gap-3 border-4 border-ink bg-paper p-3 font-semibold">
            <input name="age" type="checkbox" className="mt-1 h-5 w-5 accent-ink" required />
            <span>I am 18 or older. FMLCore is not a place for minors.</span>
          </label>
          {error ? (
            <p className="border-4 border-ink bg-coral px-3 py-2 font-bold text-on-brand" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full border-4 border-ink bg-lime px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60"
          >
            {pending ? "Saving you…" : "Create my profile"}
          </button>
          <p className="text-sm font-semibold">
            Already here?{" "}
            <Link href="/login" className="underline">
              Log in
            </Link>
          </p>
        </motion.form>
      </main>
    </>
  );
}
