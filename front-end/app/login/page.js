"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import Field, { inputClass } from "../components/Field";
import SiteHeader from "../components/SiteHeader";
import { login } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      await login({
        email: String(form.get("email") || ""),
        password: String(form.get("password") || ""),
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
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[0.8fr_1fr] md:py-12">
        <section className="md:pt-8">
          <p className="inline-block rotate-2 border-4 border-ink bg-purple px-3 py-1 text-sm font-extrabold text-on-brand">welcome back</p>
          <h1 className="mt-4 font-display text-5xl font-extrabold leading-[0.9]">You left the door open.</h1>
        </section>
        <motion.form
          onSubmit={onSubmit}
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 22 }}
          className="space-y-4 border-4 border-ink bg-white p-5 shadow-[8px_8px_0_var(--color-purple)]"
        >
          <Field label="Email">
            <input className={inputClass} name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password">
            <input className={inputClass} name="password" type="password" autoComplete="current-password" required />
          </Field>
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
            {pending ? "Checking…" : "Log in"}
          </button>
          <p className="text-sm font-semibold">
            New here?{" "}
            <Link href="/signup" className="underline">
              Make a profile
            </Link>
          </p>
        </motion.form>
      </main>
    </>
  );
}
