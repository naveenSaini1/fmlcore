"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { OVERFLOW_REACTIONS, PRIMARY_REACTIONS, REACTIONS } from "../../lib/taxonomy";
import { removeReaction, setReaction } from "../../lib/api";

export default function ReactionBar({ post, onChange }) {
  const reduce = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const mine = post.my_reaction;

  async function pick(key) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const updated = key === mine ? await removeReaction(post.id) : await setReaction(post.id, key);
      onChange(updated);
      window.dispatchEvent(new Event("fmlcore:leaderboard-change"));
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  function button(r) {
    const active = mine === r.key;
    return (
      <motion.button
        key={r.key}
        type="button"
        onClick={() => pick(r.key)}
        disabled={pending}
        whileTap={reduce ? undefined : { scale: 0.82 }}
        animate={active && !reduce ? { scale: [1, 1.25, 1] } : { scale: 1 }}
        transition={{ duration: 0.25 }}
        title={r.label}
        aria-pressed={active}
        className={`flex items-center gap-1 border-2 border-ink px-2 py-1 text-xs font-extrabold leading-none ${active ? "text-on-brand" : "bg-white"} disabled:opacity-60`}
        style={active ? { backgroundColor: r.color } : undefined}
      >
        <span className="text-base" aria-hidden>{r.emoji}</span>
        <span>{r.label}</span>
      </motion.button>
    );
  }

  // If the viewer's reaction is one of the overflow ones, promote it into the main row.
  const promoted = OVERFLOW_REACTIONS.find((r) => r.key === mine) || null;
  const panelItems = OVERFLOW_REACTIONS.filter((r) => r.key !== mine);

  // Counts shown quietly, in fixed taxonomy order — never ranked.
  const used = REACTIONS.filter((r) => (post.reactions?.[r.key] || 0) > 0);

  return (
    <div className="post-reactions">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRIMARY_REACTIONS.map(button)}
        {promoted ? button(promoted) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          aria-expanded={open}
          aria-label="More reactions"
          className="border-2 border-ink bg-white px-2.5 py-1 text-sm font-extrabold leading-none disabled:opacity-60"
        >
          •••
        </button>
      </div>

      {open ? (
        <div className="mt-2 border-2 border-dashed border-ink bg-paper p-2">
          <p className="mb-2 font-note text-lg leading-none text-ink/70">more ways to relate</p>
          <div className="flex flex-wrap gap-1.5">{panelItems.map(button)}</div>
        </div>
      ) : null}

      {used.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-ink/70">
          {used.map((r) => (
            <span key={r.key} title={r.label}>
              <span aria-hidden>{r.emoji}</span> {post.reactions[r.key]}
            </span>
          ))}
        </p>
      ) : null}

      {error ? <p className="mt-1 text-xs font-bold text-danger">{error}</p> : null}
    </div>
  );
}
