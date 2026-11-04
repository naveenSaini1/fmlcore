"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import SiteHeader from "./components/SiteHeader";
import Feed from "./components/Feed";
import LeaderboardPanel from "./components/LeaderboardPanel";
import { getMe } from "../lib/api";

function Landing({ reduce }) {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1.2fr_0.8fr] md:items-end md:py-16">
      <motion.section
        initial={reduce ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
      >
        <p className="inline-block -rotate-2 border-4 border-ink bg-coral px-3 py-1 text-sm font-extrabold text-on-brand">
          18+ · unfiltered
        </p>
        <h1 className="mt-5 font-display text-6xl font-extrabold leading-[0.9] tracking-tight md:text-8xl">
          Life is weird.
        </h1>
        <p className="mt-4 max-w-md font-note text-4xl leading-none">You&apos;re not the only one.</p>
        <p className="mt-6 max-w-md text-lg font-semibold">
          Embarrassing moments, bad days, 2 AM thoughts, and the ridiculous stuff you actually lived.
        </p>
      </motion.section>

      <section className="border-4 border-ink bg-lime p-5 text-on-brand shadow-[8px_8px_0_var(--color-shadow)]">
        <h2 className="font-display text-3xl font-extrabold leading-none">Come in as yourself.</h2>
        <p className="mt-3 font-semibold">No perfect persona. Just an account that is actually yours.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="border-4 border-ink bg-ink px-4 py-3 text-center font-extrabold text-on-ink shadow-[4px_4px_0_var(--color-purple)]"
          >
            Make a profile
          </Link>
          <Link
            href="/login"
            className="border-4 border-ink bg-white px-4 py-3 text-center font-extrabold"
          >
            I already exist
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function HomePage() {
  const reduce = useReducedMotion();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  return (
    <>
      <SiteHeader user={user} />
      {!ready ? (
        <main className="px-4 py-16 font-bold">Checking the door…</main>
      ) : user ? (
        <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="mx-auto w-full max-w-2xl">
            <div className="mb-6">
              <p className="font-note text-3xl leading-none">hey @{user.username}</p>
              <h1 className="font-display text-4xl font-extrabold leading-none">The feed</h1>
            </div>
            <Feed user={user} />
          </div>
          <LeaderboardPanel />
        </main>
      ) : (
        <Landing reduce={reduce} />
      )}
    </>
  );
}
