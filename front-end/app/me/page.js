"use client";

import { useEffect, useState } from "react";
import { getMe } from "../../lib/api";

const platformFacts = [
  { label: "Made for", value: "Real life, in all its weirdness" },
  { label: "The point", value: "Relatability over likes and followers" },
  { label: "For adults", value: "An 18+ community" },
];

export default function MePage() {
  const [user, setUser] = useState(null);
  useEffect(() => { getMe().then(setUser).catch(() => setUser(null)); }, []);

  return (
    <>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <section className="relative overflow-hidden border-4 border-ink bg-lime p-6 shadow-[8px_8px_0_var(--color-shadow)] sm:p-12">
          <span className="absolute -right-3 -top-8 rotate-12 font-display text-8xl font-black text-ink/10 sm:text-9xl" aria-hidden>FML</span>
          <p className="font-note text-2xl">life is weird. you're not the only one.</p>
          <h1 className="mt-3 max-w-3xl font-display text-5xl font-black leading-[0.95] sm:text-7xl">A little about FMLCore</h1>
          <p className="mt-6 max-w-2xl text-lg font-semibold leading-relaxed sm:text-xl">
            FMLCore is a social platform for the funny, embarrassing, painful, and completely random parts of being human. Share what happened, find the people who get it, and feel a little less alone.
          </p>
        </section>

        <div className="mt-10 grid gap-6 md:grid-cols-[0.8fr_1.2fr]">
          <section className="border-4 border-ink bg-soft-purple p-6 shadow-[6px_6px_0_var(--color-shadow)] sm:p-8">
            <p className="font-note text-2xl">the person behind it</p>
            <h2 className="mt-2 font-display text-3xl font-black">Naveen Saini</h2>
            <p className="mt-4 leading-relaxed">
              Founder of FMLCore, building a place for honest stories and the small relief of knowing somebody else has been there too.
            </p>
          </section>

          <section className="border-4 border-ink bg-white p-6 shadow-[6px_6px_0_var(--color-shadow)] sm:p-8">
            <p className="font-note text-2xl">what we're here for</p>
            <h2 className="mt-2 font-display text-3xl font-black">Real stories. Real connection.</h2>
            <p className="mt-4 max-w-2xl leading-relaxed">
              Bad days, awkward moments, 2 AM thoughts, friendship, work, heartbreak, and ridiculous incidents all belong here. FMLCore puts the story and the people who relate to it first.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {platformFacts.map((fact) => (
                <div key={fact.label} className="border-2 border-ink bg-paper p-4">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-ink/60">{fact.label}</p>
                  <p className="mt-2 font-bold leading-snug">{fact.value}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t-2 border-ink/20 pt-6">
          <p className="font-semibold">Come for the story. Stay because someone gets it.</p>
          <a href="/explore" className="border-2 border-ink bg-coral px-5 py-3 font-extrabold text-on-brand shadow-[4px_4px_0_var(--color-shadow)] transition-transform hover:-translate-y-0.5">Explore FMLCore <span aria-hidden>↗</span></a>
        </div>
      </main>
    </>
  );
}
