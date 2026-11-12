"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readApiResponse } from "../lib/api-response.mjs";
import { useRouter } from "next/navigation";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  return readApiResponse(response);
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function MatchGraph({ target, candidates, onSelect, selectedUsername }) {
  if (!candidates.length) {
    return <div className="graph-empty">No accounts have cleared stories with current embeddings to compare yet.</div>;
  }

  // Add rings as the result set grows, keeping nodes at a readable fixed size.
  const rings = [];
  let remaining = candidates.length;
  for (let ring = 0; remaining > 0; ring += 1) {
    const radius = 180 + ring * 130;
    const count = Math.min(remaining, Math.floor((2 * Math.PI * radius) / 120));
    rings.push({ radius, count });
    remaining -= count;
  }
  const size = 2 * (rings[rings.length - 1].radius + 65);
  const center = { x: size / 2, y: size / 2 };
  let offset = 0;
  const nodes = rings.flatMap(({ radius, count }) => {
    const entries = candidates.slice(offset, offset + count).map((candidate, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
      return { ...candidate, x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    });
    offset += count;
    return entries;
  });

  return (
    <div className="match-graph-scroll" role="region" aria-label="All scored candidates chart. Scroll to explore." tabIndex="0">
      <svg className="match-graph" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label={`All ${candidates.length} scored Same Sky connections for ${target.username}`}>
        <defs><pattern id="graphDots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="currentColor" opacity=".12" /></pattern></defs>
        <rect width={size} height={size} fill="url(#graphDots)" />
        {nodes.map((node) => <line key={`edge-${node.username}`} x1={center.x} y1={center.y} x2={node.x} y2={node.y} stroke={node.passed_threshold ? "#ff5c4d" : "#a875ff"} strokeWidth={2 + node.score * 5} strokeDasharray={node.passed_threshold ? undefined : "6 5"} opacity=".65" />)}
        <circle cx={center.x} cy={center.y} r="61" fill="#c5ff41" stroke="#171717" strokeWidth="3" />
        <text x={center.x} y={center.y - 7} textAnchor="middle" className="graph-center-label">@{target.username}</text>
        <text x={center.x} y={center.y + 17} textAnchor="middle" className="graph-center-sub">YOU SEARCHED</text>
        {nodes.map((node) => (
          <g key={node.username} className={`graph-node ${selectedUsername === node.username ? "selected" : ""}`} role="button" tabIndex="0" aria-pressed={selectedUsername === node.username} aria-label={`Inspect @${node.username}, score ${percent(node.score)}, ${node.passed_threshold ? "passes thresholds" : "below threshold"}`} onClick={() => onSelect(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node); } }}>
            <title>{`@${node.username} · ${percent(node.score)} · ${node.passed_threshold ? "Passes thresholds" : node.reason}`}</title>
            <circle cx={node.x} cy={node.y} r="48" fill={node.passed_threshold ? "#ffded9" : "#e7ddff"} stroke="#171717" strokeWidth="3" />
            <text x={node.x} y={node.y - 9} textAnchor="middle" className="graph-score">{percent(node.score)}</text>
            <text x={node.x} y={node.y + 8} textAnchor="middle" className="graph-node-label">@{node.username.slice(0, 13)}</text>
            <text x={node.x} y={node.y + 24} textAnchor="middle" className="graph-node-label">{node.passed_threshold ? "PASSES" : "BELOW"}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function StatusChips({ values }) {
  const entries = Object.entries(values || {});
  if (!entries.length) return <span className="muted">No records</span>;
  return <div className="status-chips">{entries.map(([key, count]) => <span className="status-chip" key={key}>{key.replaceAll("_", " ")} · {count}</span>)}</div>;
}

function ScoreBar({ label, value }) {
  return <div className="score-bar-row"><span>{label}</span><strong>{percent(value)}</strong><div className="score-track"><i style={{ width: `${Math.max(0, Math.min(100, (value || 0) * 100))}%` }} /></div></div>;
}

function AnalysisProfile({ profile }) {
  const overlapByTheme = new Map((profile.candidate_overlap || []).map((item) => [item.label, item.candidate_count]));
  return (
    <section className="card panel analysis-profile-panel">
      <div className="panel-head">
        <div><p className="eyebrow">saved AI analysis · aggregated</p><h2>Story profile</h2><p className="panel-subtitle">Broad labels from {profile.eligible_story_count} completed stories used by the matcher. Original posts and per-story summaries stay hidden.</p></div>
        <span className="pill">No new AI calls</span>
      </div>
      <div className="analysis-profile-grid">
        <div className="profile-topics">
          <h3>Topics in this account’s stories</h3>
          {profile.themes.length ? <div className="topic-grid">{profile.themes.map((theme) => {
            const candidateCount = overlapByTheme.get(theme.label) || 0;
            return <article className="topic-card" key={theme.label}>
              <strong>{theme.label}</strong>
              <span>{theme.count} story {theme.count === 1 ? "mention" : "mentions"} · {theme.posts} posts · {theme.confessions} confessions</span>
              {candidateCount > 0 && <small>Shared by {candidateCount} current {candidateCount === 1 ? "candidate" : "candidates"}</small>}
            </article>;
          })}</div> : <p className="muted">No eligible stories have completed analysis yet.</p>}
        </div>
        <div className="profile-signals">
          <div><h3>Contexts</h3>{profile.contexts.length ? <div className="profile-pills">{profile.contexts.map((item) => <span className="profile-pill" key={item.label}>{item.label} · {item.count}</span>)}</div> : <p className="muted">No context labels yet.</p>}</div>
          <div><h3>Emotional signals</h3>{profile.emotions.length ? <div className="profile-pills">{profile.emotions.map((item) => <span className="profile-pill" key={item.label}>{item.label} · {item.count}</span>)}</div> : <p className="muted">No emotion labels yet.</p>}</div>
        </div>
      </div>
      <aside className="overlap-guidance"><strong>For authentic overlap</strong><p>{profile.candidate_overlap.length ? `These themes already appear in ${profile.candidate_overlap.reduce((total, item) => total + item.candidate_count, 0)} shared-theme links among current candidates. If another person genuinely has a related experience, a real post or confession can help the system recognize that connection.` : "No shared themes surfaced among current candidates. The labels above describe this account’s existing stories; they are not a checklist for someone else to copy."} Matching is an estimate, and writing about a topic never guarantees a match.</p></aside>
    </section>
  );
}

export default function MatchExplorerPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [result, setResult] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/admin/me").then(setAdmin).catch(() => setAdmin(null)).finally(() => setChecking(false));
  }, []);

  async function search(event) {
    event.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError("");
    setResult(null);
    setSelectedCandidate(null);
    try {
      const data = await api(`/admin/match-explorer?username=${encodeURIComponent(username.trim())}`);
      setResult(data);
      setUsername(data.target.username);
    } catch (searchError) {
      setError(searchError.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    router.push("/");
  }

  const scoredCandidates = useMemo(() => result ? [
    ...result.candidates.map((candidate) => ({ ...candidate, passed_threshold: true })),
    ...result.below_threshold.map((candidate) => ({ ...candidate, passed_threshold: false })),
  ].sort((a, b) => b.score - a.score) : [], [result]);

  const selected = selectedCandidate || scoredCandidates[0] || null;

  if (checking) return <main className="center">Checking admin access…</main>;
  if (!admin) {
    return <main className="shell"><section className="card panel"><p className="eyebrow">private admin tool</p><h1>Sign in to explore matches.</h1><p className="intro">The Match Explorer is only available to configured admin accounts.</p><Link className="btn" href="/">Go to admin sign-in</Link></section></main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">FC</span><span>FMLCORE<small>ADMIN CONSOLE</small></span></div>
        <nav className="admin-tabs" aria-label="Admin pages"><Link className="admin-tab" href="/">Overview</Link><Link className="admin-tab active" href="/match-explorer">Match Explorer</Link></nav>
        <div className="head-actions"><span className="pill">{admin.username}</span><button className="btn btn-coral" onClick={signOut}>Log out</button></div>
      </header>

      <section className="explorer-hero">
        <div><p className="eyebrow">same sky · read-only diagnostics</p><h1>Match Explorer</h1><p className="intro">Search an account to see analysis health and how saved stories line up with other analyzed accounts.</p></div>
        <div className="hero-stamp"><span>NO AI CALLS</span><span>NO MATCHES CREATED</span></div>
      </section>

      <form className="card explorer-search" onSubmit={search}>
        <label htmlFor="match-username">Search a username</label>
        <div className="search-row"><input id="match-username" className="search-input" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. naveensaini" autoComplete="off" required/><button className="btn" disabled={busy}>{busy ? "Scanning saved data…" : "Explore matches"}</button></div>
        <p className="field-help">Compares cleared stories with current embeddings for all accounts, including scores below the live thresholds. Readiness and relationship status are shown separately. Story text stays hidden.</p>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {result && <>
        <section className="explorer-account-grid">
          <article className="card explorer-account">
            <p className="eyebrow">searched account</p><h2>@{result.target.username}</h2>
            <div className="readiness-row"><span className={`pill ${result.target.can_start_search ? "" : "pill-off"}`}>{result.target.can_start_search ? "Ready to search" : "Search locked"}</span><span className={`pill ${result.target.matching_enabled ? "" : "pill-off"}`}>Matching {result.target.matching_enabled ? "on" : "off"}</span></div>
            <div className="story-counts"><strong>{result.target.ready_posts}/{result.target.required_posts} posts</strong><strong>{result.target.ready_confessions}/{result.target.required_confessions} confessions</strong></div>
            {result.blockers.length > 0 && <ul className="blocker-list">{result.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          </article>
          <article className="card explorer-health">
            <p className="eyebrow">analysis health</p><h2>Story pipeline</h2>
            <p className="health-label">Analysis statuses</p><StatusChips values={result.target.analysis_status_counts}/>
            <p className="health-label">Analysis jobs</p><StatusChips values={result.target.analysis_job_status_counts}/>
            <p className="field-help">Ready rows missing the current Gemini embedding: <strong>{result.target.ready_missing_embedding}</strong></p>
          </article>
        </section>

        <AnalysisProfile profile={result.target.analysis_profile}/>

        {!result.preview_is_matchable && <p className="preview-warning" role="status">This account can’t start a live search yet. Similarities below are a diagnostic preview using the stories that are already ready.</p>}

        <section className="card graph-panel">
          <div className="panel-head"><div><p className="eyebrow">saved-data preview</p><h2>Preview candidates</h2><p className="panel-subtitle">{result.candidate_stories_evaluated} story pairs evaluated. Showing all {scoredCandidates.length} scored accounts using the live score rules.</p></div><span className="pill">{result.candidates.length} passed thresholds</span></div>
          <MatchGraph target={result.target} candidates={scoredCandidates} onSelect={setSelectedCandidate} selectedUsername={selected?.username}/>
          <p className="graph-legend"><span className="legend-line"/> Solid coral = passes thresholds · dashed purple = below threshold. Thicker lines = higher scores. Scroll to explore; select a node to inspect.</p>
        </section>

        <section className="explorer-results-grid">
          <article className="card panel">
            <div className="panel-head"><div><p className="eyebrow">ranked by live score</p><h2>Candidate breakdown</h2></div></div>
            {scoredCandidates.length ? <div className="candidate-list">{scoredCandidates.map((candidate, index) => <button type="button" key={candidate.username} className={`candidate-row ${selected?.username === candidate.username ? "selected" : ""}`} onClick={() => setSelectedCandidate(candidate)}><span className="candidate-rank">{String(index + 1).padStart(2, "0")}</span><span className="candidate-name"><span style={{ display: "flex", alignItems: "center", gap: 8 }}><strong>@{candidate.username}</strong>{candidate.relationship_status && <span className={`pill ${candidate.relationship_status === "Available" ? "" : "pill-off"}`} style={{ fontSize: "0.7rem", padding: "2px 8px" }}>{candidate.relationship_status}</span>}</span><small>{candidate.passed_threshold ? "Passes thresholds" : "Below threshold"} · {candidate.story_comparisons} story pairs · {candidate.shared_themes.join(", ") || "No shared themes"}</small></span><span className="candidate-score">{percent(candidate.score)}</span></button>)}</div> : <p className="muted">No scored candidates available yet.</p>}
          </article>
          <article className="card panel score-panel">
            <p className="eyebrow">why this candidate</p>
            {selected ? <><h2>@{selected.username} {selected.relationship_status && <span className="pill" style={{ fontSize: "0.75rem", verticalAlign: "middle", marginLeft: 8 }}>{selected.relationship_status}</span>}</h2><p className={`threshold-status ${selected.passed_threshold ? "passed" : "below"}`}>{selected.passed_threshold ? "Passes scoring thresholds" : selected.reason}</p><p className="shared-labels">{selected.shared_themes.join(" · ") || "No shared themes"}</p><ScoreBar label="Story similarity" value={selected.semantic_similarity}/><ScoreBar label="Theme + category fit" value={selected.context_score}/><ScoreBar label="Consistency across stories" value={selected.consistency_score}/><ScoreBar label="Preferences" value={selected.preference_fit}/><p className="score-formula">Final score weights: similarity 40% · context 25% · consistency 20% · preferences 15%.</p></> : <p className="muted">Select a candidate to inspect score components.</p>}
          </article>
        </section>

        {result.excluded_accounts.length > 0 && <section className="card panel exclusion-panel"><p className="eyebrow">accounts without comparable cleared stories</p><h2>Filtered accounts</h2><div className="filter-list">

          {result.excluded_accounts.map((candidate) => <div className="filter-row" key={`excluded-${candidate.username}`}><strong>@{candidate.username}</strong><span>{candidate.reason}</span><small>nearest-story similarity {percent(candidate.similarity)}</small></div>)}
        </div></section>}

        <p className="explorer-footnote">Read-only preview of saved analysis. It does not create an attempt, update cooldowns, contact AI providers, or expose original post/confession text.</p>
      </>}
    </main>
  );
}
