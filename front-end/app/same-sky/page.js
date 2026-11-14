"use client";

import { useErrorToast } from "../components/ErrorToast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  getSameSky,
  getSameSkyAttempt,
  reopenSameSkyMatch,
  respondToSameSkyMatch,
  startSameSkyAttempt,
  updateSameSkyProfile,
} from "../../lib/api";

import { useSession } from "../../lib/session";

const button = "border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold shadow-[3px_3px_0_var(--color-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50";
const primary = "border-2 border-ink bg-lime px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50";

function MatchCard({ match, onRespond, busy }) {
  return (
    <article className={`border-4 border-ink p-5 shadow-[6px_6px_0_var(--color-shadow)] ${match.status === "connected" ? "bg-lime" : "bg-soft-purple"}`}>
      <div className="flex items-center gap-3">
        {match.person.avatar_url ? <img src={`/api${match.person.avatar_url}`} alt="" className="h-12 w-12 rounded-full border-2 border-ink object-cover" /> : <span className="grid h-12 w-12 place-items-center rounded-full border-2 border-ink bg-coral font-display text-xl font-extrabold">{match.person.username.slice(0, 1).toUpperCase()}</span>}
        <div><p className="text-xs font-extrabold uppercase">{match.status === "connected" ? "You both said yes" : "A possible same-sky connection"}</p><h3 className="font-display text-xl font-extrabold">{match.person.username}</h3>{match.person.bio ? <p className="text-sm">{match.person.bio}</p> : null}</div>
      </div>
      <p className="mt-4 text-sm">{match.safe_explanation}</p>
      {match.they_accepted && !match.you_accepted ? <p className="mt-3 border-2 border-ink bg-lime px-3 py-2 text-sm font-extrabold">They’re open to connecting with you.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{match.shared_themes.map((theme) => <span key={theme} className="border border-ink bg-white px-2 py-1 text-xs font-extrabold">{theme}</span>)}</div>
      {match.status === "connected" ? (
        <div className="mt-4 border-t-2 border-ink/30 pt-3">
          <p className="text-sm font-extrabold">You are both under the same sky. You can now chat in private.</p>
          <Link
            href={`/chat?conversation=${match.conversation_id || ""}`}
            className={`${primary} mt-3 inline-block`}
          >
            OPEN CHAT →
          </Link>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2"><button className={primary} onClick={() => onRespond(match.id, true)} disabled={busy || match.you_accepted}>{match.you_accepted ? "REQUEST SENT · WAITING" : "I'M OPEN TO THIS"}</button><button className={button} onClick={() => onRespond(match.id, false)} disabled={busy}>Pass</button></div>
      )}
    </article>
  );
}

function DeclinedRequestCard({ match, onReopen, busy }) {
  return (
    <article className="flex flex-col gap-4 border-4 border-ink bg-soft-coral p-4 shadow-[5px_5px_0_var(--color-shadow)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {match.person.avatar_url ? <img src={`/api${match.person.avatar_url}`} alt="" className="h-11 w-11 shrink-0 rounded-full border-2 border-ink object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-coral font-display text-lg font-extrabold text-on-brand">{match.person.username.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0"><h3 className="font-display text-lg font-extrabold">{match.person.username}</h3><p className="text-xs">You declined this request. Reopen it to let them send a fresh request.</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-3"><span className="border-2 border-ink bg-white px-2 py-1 text-xs font-extrabold uppercase">Declined</span><button type="button" className={primary} disabled={busy} onClick={() => onReopen(match)}>{busy ? "REOPENING…" : "REOPEN REQUEST"}</button></div>
    </article>
  );
}

export default function SameSkyPage() {
  const { user, ready: sessionReady } = useSession();
  const [profile, setProfile] = useState(null);
  const [prefs, setPrefs] = useState({ timezone: "UTC", matching_enabled: false, preferred_categories: [] });
  const [attemptId, setAttemptId] = useState(null);
  const [flowStatus, setFlowStatus] = useState("idle");
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const [error, setError] = useState("");
  useErrorToast(error);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const reduceMotion = useReducedMotion();
  const loadRevision = useRef(0);
  const accountId = useRef(user?.id);
  accountId.current = user?.id;

  const refresh = useCallback(async () => {
    const revision = ++loadRevision.current;
    const requestedAccount = accountId.current;
    const data = await getSameSky({ fresh: true });
    if (revision !== loadRevision.current || requestedAccount !== accountId.current) return data;
    setProfile(data);
    setPrefs((value) => ({ ...value, timezone: data.timezone || value.timezone, matching_enabled: data.matching_enabled, preferred_categories: data.preferred_categories || [] }));
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    if (!sessionReady) return;
    if (!user) { setProfile(null); setAttemptId(null); setLoading(false); return; }
    const revision = ++loadRevision.current;
    setLoading(true);
    getSameSky().then((data) => {
      if (!active || revision !== loadRevision.current) return;
      setProfile(data);
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      setPrefs({ timezone: data.timezone && data.timezone !== "UTC" ? data.timezone : deviceTimezone, matching_enabled: data.matching_enabled, preferred_categories: data.preferred_categories || [] });
      if (data.latest_attempt && ["queued", "searching"].includes(data.latest_attempt.status)) {
        setAttemptId(data.latest_attempt.id);
        setFlowStatus("searching");
      } else if (data.latest_attempt?.status === "no_match") setFlowStatus("no_match");
      else if (data.latest_attempt?.status === "match_found" && data.latest_match_status === "declined") setFlowStatus("match_declined");
      else if (data.latest_attempt?.status === "match_found" && ["blocked", "withdrawn"].includes(data.latest_match_status)) setFlowStatus("match_unavailable");
      else if (data.latest_attempt?.status === "match_found") setFlowStatus("match_found");
    }).catch((err) => { if (active && revision === loadRevision.current) setError(err.message); }).finally(() => { if (active && revision === loadRevision.current) setLoading(false); });
    return () => { active = false; loadRevision.current += 1; };
  }, [sessionReady, user?.id]);

  useEffect(() => {
    if (!attemptId) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const result = await getSameSkyAttempt(attemptId);
        if (!active) return;
        if (["match_found", "no_match", "unavailable", "not_eligible"].includes(result.status)) {
          setAttemptId(null);
          await refresh();
          setFlowStatus(result.status);
          setNotice(result.status === "unavailable" || result.status === "not_eligible" ? "Matching could not start. Check your setup and try again." : "");
          return;
        }
        timer = window.setTimeout(poll, 5000);
      } catch {
        if (active) timer = window.setTimeout(poll, 10000);
      }
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [attemptId, refresh]);

  const postCount = Math.min(profile?.ready_experience_count || 0, profile?.required_experiences || 3);
  const confessionCount = Math.min(profile?.ready_confession_count || 0, profile?.required_confessions || 3);
  const progressTotal = (profile?.required_experiences || 3) + (profile?.required_confessions || 3);
  const progress = Math.round(((postCount + confessionCount) / progressTotal) * 100);
  const hasEnoughStories = postCount >= (profile?.required_experiences || 3) && confessionCount >= (profile?.required_confessions || 3);
  const analyses = profile?.analyses || [];
  const pendingAnalysisCount = analyses.filter((analysis) => ["pending", "processing", "reindex_required"].includes(analysis.processing_status)).length;
  const duplicateReviewCount = analyses.filter((analysis) => analysis.duplicate_status === "review" && analysis.processing_status === "needs_revision").length;
  const failedAnalysisCount = analyses.filter((analysis) => analysis.processing_status === "failed").length;
  const blockedStoryReasons = [
    duplicateReviewCount ? `${duplicateReviewCount} stories are too similar` : "",
    failedAnalysisCount ? `${failedAnalysisCount} stories need another try` : "",
  ].filter(Boolean);
  const readinessMessage = hasEnoughStories
    ? "You're ready to find your people."
    : pendingAnalysisCount
      ? `Getting ${pendingAnalysisCount === 1 ? "your story" : "your stories"} ready…`
      : blockedStoryReasons.length
        ? blockedStoryReasons.join(" · ") + "."
        : "Share a few more stories to get started.";
  const activeMatches = useMemo(() => profile?.matches || [], [profile]);
  const cooldownSeconds = profile?.next_attempt_at ? Math.max(0, Math.ceil((new Date(profile.next_attempt_at).getTime() - countdownNow) / 1000)) : 0;
  const cooldownLabel = `${Math.floor(cooldownSeconds / 3600)}h ${Math.floor((cooldownSeconds % 3600) / 60)}m ${cooldownSeconds % 60}s`;

  useEffect(() => {
    const interval = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!pendingAnalysisCount) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, 15000);
    return () => window.clearInterval(interval);
  }, [pendingAnalysisCount > 0, refresh]);

  async function startMatching() {
    if (!hasEnoughStories || busy || attemptId || cooldownSeconds > 0) return;
    setBusy(true); setError(""); setNotice(""); setFlowStatus("searching");
    try {
      if (!prefs.matching_enabled) {
        const enabledPrefs = { ...prefs, matching_enabled: true };
        const updated = await updateSameSkyProfile(enabledPrefs);
        setProfile(updated);
        setPrefs(enabledPrefs);
      }
      const attempt = await startSameSkyAttempt();
      if (attempt?.status && ["match_found", "no_match", "unavailable", "not_eligible"].includes(attempt.status)) {
        setAttemptId(null);
        await refresh();
        setFlowStatus(attempt.status);
      } else {
        setAttemptId(attempt.id);
        setFlowStatus("searching");
        await refresh();
      }
    } catch (err) {
      setFlowStatus("idle");
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function respond(matchId, accept) {
    setBusy(true); setError("");
    try { const result = await respondToSameSkyMatch(matchId, accept); await refresh(); setNotice(result.status === "connected" ? "You both said yes. You're connected!" : accept ? "Your yes is saved. The other person can decide when they feel ready." : "Passed. This person will not be suggested to you again."); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function reopenRequest(match) {
    setBusy(true); setError(""); setNotice("");
    try {
      await reopenSameSkyMatch(match.id);
      await refresh();
      setFlowStatus("match_found");
      setNotice(`You reopened the request with @${match.person.username}. They can send a fresh request now.`);
      window.dispatchEvent(new Event("fmlcore:notifications-change"));
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto max-w-5xl px-4 py-16 font-bold">Looking up your sky…</main>;
  if (!user) return <main className="mx-auto max-w-3xl px-4 py-14"><section className="border-4 border-ink bg-paper p-8 shadow-[8px_8px_0_var(--color-shadow)]"><p className="font-note text-3xl">different lives. similar wounds.</p><h1 className="mt-2 font-display text-4xl font-extrabold">SAME SKY</h1><p className="mt-4">A private matching journey for people who want to connect through shared experiences. You choose when your stories are used.</p><Link href="/login" className={`${primary} mt-6 inline-block`}>LOG IN TO START</Link></section></main>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-7 pb-16 text-ink">
      <header className="relative overflow-hidden border-4 border-ink bg-purple p-6 shadow-[8px_8px_0_var(--color-shadow)] sm:p-9">
        <p className="font-note text-3xl">your moments might help you find your person.</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-6xl">SAME SKY</h1>
      </header>

      {notice ? <p role="status" className="mt-5 border-2 border-ink bg-lime p-3 font-bold">{notice}</p> : null}
      {!profile?.latest_attempt ? <section className="mt-7 border-4 border-ink bg-paper p-5 shadow-[6px_6px_0_var(--color-shadow)] sm:p-7">
        <div><p className="font-note text-2xl">your story, at your pace</p><h2 className="font-display text-2xl font-extrabold">MATCHING READINESS</h2></div>
        <div className="mt-4 h-5 overflow-hidden border-2 border-ink bg-white"><motion.div className="h-full bg-lime" initial={false} animate={{ width: `${progress}%` }} transition={{ duration: reduceMotion ? 0 : 0.8, ease: "easeOut" }} /></div>
        <p className="mt-3 text-sm font-extrabold">{postCount}/{profile.required_experiences} posts <span className="px-1 text-ink/40">·</span> {confessionCount}/{profile.required_confessions} confessions</p>
        <p className="mt-1 text-xs">{readinessMessage}</p>
        <motion.button type="button" onClick={startMatching} disabled={!hasEnoughStories || busy || !!attemptId || cooldownSeconds > 0} whileHover={reduceMotion ? undefined : { y: -3, scale: 1.015 }} whileTap={reduceMotion ? undefined : { scale: 0.97 }} className="group relative mt-5 flex w-full items-center justify-center gap-3 overflow-hidden border-4 border-ink bg-coral px-5 py-4 font-display text-lg font-extrabold shadow-[5px_5px_0_var(--color-shadow)] transition disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-80">
          <span className="absolute inset-0 -translate-x-full bg-white/35 transition-transform duration-700 group-hover:translate-x-full" aria-hidden />
          <span className="relative animate-pulse text-xl" aria-hidden>✦</span><span className="relative">{busy ? "SEARCHING YOUR SKY…" : attemptId ? "MATCHING IN PROGRESS…" : cooldownSeconds > 0 ? `TRY AGAIN IN ${cooldownLabel}` : "START MATCHING"}</span><span className="relative text-xl" aria-hidden>↗</span>
        </motion.button>
      </section> : null}

      <AnimatePresence>
        {["analyzing", "searching"].includes(flowStatus) ? <motion.div className="relative mt-7 grid min-h-[420px] place-items-center overflow-hidden border-4 border-ink bg-[#120c28] p-6 text-white shadow-[7px_7px_0_var(--color-shadow)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,78,111,0.28),transparent_38%),radial-gradient(circle_at_25%_20%,rgba(169,130,255,0.28),transparent_32%),radial-gradient(circle_at_80%_80%,rgba(95,231,206,0.2),transparent_35%)]" />
          <div className="relative flex flex-col items-center text-center">
            <div className="relative grid h-56 w-56 place-items-center">
              {[0, 1, 2].map((ring) => <motion.div key={ring} className="absolute rounded-full border-2 border-white/30" style={{ width: `${72 + ring * 48}px`, height: `${72 + ring * 48}px` }} animate={reduceMotion ? undefined : { rotate: ring % 2 ? -360 : 360, scale: [0.86, 1.12, 0.86], opacity: [0.2, 0.75, 0.2] }} transition={{ duration: 2.8 + ring, repeat: Infinity, ease: "easeInOut" }} />)}
              <motion.div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-coral via-pink-400 to-purple text-4xl shadow-[0_0_70px_rgba(255,78,111,0.7)]" animate={reduceMotion ? undefined : { scale: [0.9, 1.12, 0.9], rotate: [-8, 8, -8] }} transition={{ duration: 1.6, repeat: Infinity }}>✦</motion.div>
              {!reduceMotion ? ["✧", "✦", "♡", "✧", "✦", "♡"].map((spark, index) => <motion.span key={`${spark}-${index}`} className="absolute text-2xl text-lime" style={{ left: `${10 + (index * 37) % 82}%`, top: `${8 + (index * 53) % 84}%` }} animate={{ y: [12, -18, 12], opacity: [0.15, 1, 0.15], rotate: [0, 40, 0] }} transition={{ duration: 1.8 + index * 0.17, repeat: Infinity, delay: index * 0.14 }}>{spark}</motion.span>) : null}
            </div>
            <motion.p className="mt-3 font-note text-3xl" animate={reduceMotion ? undefined : { opacity: [0.55, 1, 0.55] }} transition={{ duration: 1.3, repeat: Infinity }}>{flowStatus === "analyzing" ? "the universe is connecting the dots…" : "your person might be out there…"}</motion.p>
            <p className="mt-2 text-sm font-extrabold uppercase tracking-[0.2em]">{flowStatus === "analyzing" ? "Reading your stories" : "Finding your same-sky person"}</p>
          </div>
        </motion.div> : null}
      </AnimatePresence>

      {["no_match", "match_declined", "match_unavailable"].includes(flowStatus) ? <motion.section initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative mt-7 overflow-hidden border-4 border-ink bg-gradient-to-br from-[#ffe2c6] via-[#ffb9a7] to-[#f7c3dc] p-6 text-center shadow-[7px_7px_0_var(--color-shadow)] sm:p-9"><span className="pointer-events-none absolute -right-3 top-2 rotate-12 text-7xl text-white/45" aria-hidden>✦</span><span className="pointer-events-none absolute bottom-1 left-4 -rotate-12 text-5xl text-white/45" aria-hidden>✧</span><motion.div className="relative mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-ink bg-[#fff4d8] text-3xl text-[#ef594d] shadow-[3px_3px_0_var(--color-shadow)]" animate={reduceMotion ? undefined : { rotate: [0, 12, -12, 0], scale: [1, 1.08, 1] }} transition={{ duration: 3, repeat: Infinity }}>☄</motion.div><p className="relative mt-4 font-note text-3xl">your orbit is still unfolding.</p><h2 className="relative mt-1 font-display text-3xl font-extrabold">{flowStatus === "match_declined" ? "THAT CONNECTION CLOSED" : flowStatus === "match_unavailable" ? "CONNECTION NO LONGER AVAILABLE" : "NO MATCH FOUND"}</h2>{flowStatus !== "no_match" || cooldownSeconds > 0 ? <p className="relative mt-2">{flowStatus === "match_declined" ? "They passed on the connection. You can look for someone new." : flowStatus === "match_unavailable" ? "That connection ended. You can look for someone new." : "Your next try unlocks in"}</p> : null}{cooldownSeconds > 0 ? <strong className="relative mt-1 inline-block rounded-full border-2 border-ink bg-[#fff8ed]/80 px-5 py-2 font-display text-2xl tabular-nums shadow-[3px_3px_0_var(--color-shadow)]">{cooldownLabel}</strong> : null}{cooldownSeconds > 0 ? <p className="relative mt-2 text-xs font-semibold">Come back when the timer reaches zero.</p> : null}<button className={`${primary} relative mt-4`} onClick={startMatching} disabled={busy || cooldownSeconds > 0}>{busy ? "SEARCHING…" : cooldownSeconds > 0 ? "TRY AGAIN SOON" : "TRY AGAIN"}</button></motion.section> : null}

      {activeMatches.length ? <section className="mt-8"><p className="font-note text-2xl">one possible connection at a time</p><h2 className="font-display text-3xl font-extrabold">UNDER THE SAME SKY</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{activeMatches.map((match) => <MatchCard key={match.id} match={match} onRespond={respond} busy={busy} />)}</div></section> : null}

      {profile.declined_matches?.length ? <section className="mt-8"><p className="font-note text-2xl">some connections pause here</p><h2 className="font-display text-3xl font-extrabold">PAST REQUESTS</h2><p className="mt-1 text-sm">Only requests you declined appear here. Reopening lets the other person send a fresh request.</p><div className="mt-4 grid gap-3">{profile.declined_matches.map((match) => <DeclinedRequestCard key={match.id} match={match} onReopen={reopenRequest} busy={busy} />)}</div></section> : null}

    </main>
  );
}
