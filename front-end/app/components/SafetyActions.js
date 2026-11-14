"use client";

import { showErrorToast } from "./ErrorToast";
import { useState } from "react";
import { reportContent, setBlock, setMute } from "../../lib/api";

const REASONS = [
  ["harassment", "Harassment"],
  ["hate", "Hate or abuse"],
  ["spam", "Spam"],
  ["self_harm", "Self-harm concern"],
  ["other", "Something else"],
];

export function ReportAction({ targetType, targetId }) {
  const reportLabel = { post: "Report story", comment: "Report comment", user: "Report account" }[targetType] ?? "Report";
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("other");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    try {
      await reportContent({ targetType, targetId, reason, details });
      setMessage("Report sent. Thanks for looking out.");
      setOpen(false);
      setDetails("");
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((value) => !value)} className="text-xs font-extrabold underline">
        {open ? "Cancel report" : reportLabel}
      </button>
      {message ? <p className="mt-1 text-xs font-bold text-ink/70" role="status">{message}</p> : null}
      {open ? (
        <form onSubmit={submit} className="mt-2 space-y-2 border-2 border-ink bg-paper p-3">
          <label className="block text-xs font-extrabold">
            Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full border-2 border-ink bg-white px-2 py-1.5 text-sm">
              {REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-extrabold">
            Details (optional)
            <textarea value={details} onChange={(event) => setDetails(event.target.value.slice(0, 500))} className="mt-1 min-h-16 w-full border-2 border-ink bg-white px-2 py-1.5 text-sm font-semibold" />
          </label>
          <button type="submit" disabled={pending} className="border-2 border-ink bg-coral px-3 py-1.5 text-xs font-extrabold text-on-brand disabled:opacity-60">
            {pending ? "Sending…" : "Send report"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function UserSafetyActions({ target, onHide }) {
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState(false);

  async function toggle(kind) {
    setPending(true);
    const wasActive = kind === "block" ? blocked : muted;
    try {
      if (kind === "block") await setBlock(target.id, !wasActive);
      else await setMute(target.id, !wasActive);
      if (kind === "block") setBlocked(!wasActive);
      else setMuted(!wasActive);
      if (!wasActive) onHide?.();
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <ReportAction targetType="user" targetId={target.id} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => toggle("block")} className="border border-ink px-2 py-1 text-xs font-bold disabled:opacity-60">
          {blocked ? "Unblock" : `Block @${target.username}`}
        </button>
        <button type="button" disabled={pending} onClick={() => toggle("mute")} className="border border-ink px-2 py-1 text-xs font-bold disabled:opacity-60">
          {muted ? "Unmute" : `Mute @${target.username}`}
        </button>
      </div>
    </div>
  );
}
