"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readApiResponse } from "./lib/api-response.mjs";
import GoogleSigninButton from "./components/GoogleSigninButton";
import UserStories from "./components/UserStories";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  return readApiResponse(response);
}

function dateLabel(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function Metric({ label, value, note }) {
  return <article className="card metric"><p className="metric-label">{label}</p><p className="metric-value">{value ?? "—"}</p><p className="metric-note">{note}</p></article>;
}

export default function AdminPage() {
  const [admin, setAdmin] = useState(null);
  const [checking, setChecking] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [authOptions, setAuthOptions] = useState(null);
  useEffect(() => {
    let alive = true;
    api("/auth/options").then(result => { if (alive) setAuthOptions(result); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const [loginFlow, setLoginFlow] = useState(null);
  const [resendWait, setResendWait] = useState(0);
  useEffect(() => {
    if (!resendWait) return;
    const timer = setTimeout(() => setResendWait(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendWait]);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState(null);
  const [settingNote, setSettingNote] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [dashboardError, setDashboardError] = useState("");
  const [workerActionNote, setWorkerActionNote] = useState("");

  const loadDashboard = useCallback(async (nextPage = page, search = query) => {
    setDashboardError("");
    const params = new URLSearchParams({ page: String(nextPage), page_size: "30" });
    if (search.trim()) params.set("q", search.trim());
    try {
      const [summary, roster] = await Promise.all([
        api("/admin/overview"),
        api(`/admin/users?${params.toString()}`),
      ]);
      setOverview(summary);
      setSettings(summary.settings);
      setUsers(roster.users);
      setTotal(roster.total);
      setPage(roster.page);
    } catch (error) {
      setDashboardError(error.message);
    }
  }, [page, query]);

  useEffect(() => {
    api("/admin/me")
      .then((result) => { setAdmin(result); return loadDashboard(1, ""); })
      .catch(() => setAdmin(null))
      .finally(() => setChecking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function signIn(event) {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = loginFlow
        ? await api("/auth/email/verify", { method: "POST", body: JSON.stringify({ challenge_id: loginFlow.challenge_id, code: form.get("code") }) })
        : await api("/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      if (result.requires_verification) { setLoginFlow(result); setResendWait(result.resend_after); return; }
      const identity = await api("/admin/me");
      setAdmin(identity);
      setLoginFlow(null);
      await loadDashboard(1, "");
    } catch (error) {
      try { await api("/auth/logout", { method: "POST" }); } catch {}
      setLoginError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function googleSignIn(result) {
    setBusy(true);
    setLoginError("");
    try {
      if (result.requires_verification) {
        setLoginFlow(result);
        setResendWait(result.resend_after || 0);
        return;
      }
      if (result.requires_username) {
        throw new Error("Create your FMLCore profile on fmlcore.com first, then return here to sign in.");
      }
      // Google authenticates the account; the backend still checks the admin allowlist.
      const identity = await api("/admin/me");
      setAdmin(identity);
      setLoginFlow(null);
      await loadDashboard(1, "");
    } catch (error) {
      try { await api("/auth/logout", { method: "POST" }); } catch {}
      setLoginError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    setAdmin(null);
    setOverview(null);
    setSelectedUser(null);
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setSettingNote("");
    try {
      const result = await api("/admin/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(result.settings);
      setSettingNote("Settings saved and applied.");
      await loadDashboard(page, query);
    } catch (error) {
      setSettingNote(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleWorker() {
    setBusy(true);
    setWorkerActionNote("");
    try {
      const isRunning = overview?.worker_status?.running;
      const endpoint = isRunning ? "/admin/worker/stop" : "/admin/worker/start";
      const res = await api(endpoint, { method: "POST" });
      setWorkerActionNote(isRunning ? "Worker stopped." : `Worker started (PID ${res.pids?.join(", ") || ""}).`);
      await loadDashboard(page, query);
    } catch (err) {
      setWorkerActionNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runBatch() {
    setBusy(true);
    setWorkerActionNote("");
    try {
      const res = await api("/admin/worker/process-batch", { method: "POST" });
      setWorkerActionNote(`Processed ${res.processed_count} jobs on-demand. (${res.remaining_queued} remaining)`);
      await loadDashboard(page, query);
    } catch (err) {
      setWorkerActionNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function showUser(userId) {
    setSelectedUser(null);
    try { setSelectedUser(await api(`/admin/users/${userId}`)); }
    catch (error) { setDashboardError(error.message); }
  }

  async function searchUsers(event) {
    event.preventDefault();
    setSelectedUser(null);
    await loadDashboard(1, query);
  }

  if (checking) return <main className="center">Checking admin access…</main>;

  if (!admin) {
    return (
      <main className="shell">
        <header className="topbar"><div className="brand"><span className="brand-mark">FC</span><span>FMLCORE<small>ADMIN CONSOLE</small></span></div><span className="pill">PRIVATE ACCESS</span></header>
        <section className="login-grid">
          <div className="login-art">
            <p className="eyebrow">keep the whole thing in check</p>
            <h1>Admin space.<br />Your call.</h1>
            <span className="login-bubble">small controls, big energy ✦</span>
            <p className="intro">Sign in with your FMLCore account. Only emails configured for admin access can open this dashboard.</p>
          </div>
          <form className="card login-card" onSubmit={signIn}>
            <p className="eyebrow">welcome back</p>
            <h2 style={{ marginBottom: 22 }}>Log in to FMLCore</h2>
            {loginFlow ? <>
              <p>Enter the code sent to {loginFlow.email_hint}.</p>
              <label className="field">Verification code<input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus required /></label>
              <button type="button" className="btn" disabled={busy || resendWait > 0} onClick={async () => {
                setBusy(true); setLoginError("");
                try { const result = await api("/auth/email/resend", { method: "POST", body: JSON.stringify({ challenge_id: loginFlow.challenge_id }) }); setResendWait(result.resend_after); }
                catch (error) { setLoginError(error.message); }
                finally { setBusy(false); }
              }}>{resendWait ? `Resend in ${resendWait}s` : "Resend code"}</button>
              <button type="button" className="btn" disabled={busy} onClick={() => { setLoginFlow(null); setLoginError(""); }}>Start again</button>
            </> : <>
              {authOptions?.google_enabled && <>
                <GoogleSigninButton api={api} onResult={googleSignIn} onError={setLoginError} disabled={busy} />
                <p className="note" style={{ marginBottom: 16 }}>or sign in with your email and password</p>
              </>}
              <label className="field">Email<input name="email" type="email" autoComplete="username" required /></label>
              <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
            </>}
            {loginError && <p className="error" role="alert">{loginError}</p>}
            <button className="btn" style={{ width: "100%", marginTop: 8 }} disabled={busy}>{busy ? "Checking access…" : "Enter admin panel"}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">FC</span><span>FMLCORE<small>ADMIN CONSOLE</small></span></div>
        <nav className="admin-tabs" aria-label="Admin pages"><Link className="admin-tab active" href="/">Overview</Link><Link className="admin-tab" href="/match-explorer">Match Explorer</Link></nav>
        <div className="head-actions"><span className="pill">{admin.username}</span><button className="btn btn-quiet" onClick={() => loadDashboard(page, query)}>Refresh data</button><button className="btn btn-coral" onClick={signOut}>Log out</button></div>
      </header>

      <section className="dashboard-head">
        <div><p className="eyebrow">the control room</p><h1>Good to see you, {admin.username}.</h1><p className="intro">Account activity, Same Sky readiness and the rules that shape matching.</p></div>
      </section>

      {dashboardError && <p className="error" role="alert">{dashboardError}</p>}

      <section className="metrics" aria-label="Platform overview">
        <Metric label="Accounts" value={overview?.users_total} note={`${overview?.users_ever_logged_in ?? "—"} have signed in`}/>
        <Metric label="Signed in · 24h" value={overview?.signins_last_24h} note={`${overview?.signins_last_7d ?? "—"} in the last 7 days`}/>
        <Metric label="Life posts" value={overview?.posts_total} note={`${overview?.confessions_total ?? "—"} confessions shared`}/>
        <Metric label="Matching enabled" value={overview?.same_sky_matching_enabled} note="Accounts that started Same Sky matching"/>
      </section>

      <section className="main-grid">
        <article className="card panel">
          <div className="panel-head"><div><h2>People on FMLCore</h2><p className="panel-subtitle">Open an account to see activity and stories.</p></div><form onSubmit={searchUsers}><input className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username or email" aria-label="Search users"/></form></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th>Last sign-in</th><th>Posts</th><th>Confessions</th><th>Same Sky</th></tr></thead>
              <tbody>
                {users.map((user) => <tr key={user.id}>
                  <td><button className="user-button" onClick={() => showUser(user.id)}>{user.username}</button><span className="muted">{user.email}</span></td>
                  <td>{dateLabel(user.last_login_at)}</td>
                  <td>{user.posts_count}</td>
                  <td>{user.confessions_count}</td>
                  <td><span className={`pill ${user.same_sky_matching_enabled ? "" : "pill-off"}`}>{user.same_sky_eligibility.replaceAll("_", " ")}</span><span className="muted">{user.same_sky_ready}/{user.same_sky_selected} analyzed</span></td>
                </tr>)}
                {!users.length && <tr><td colSpan="5">No accounts match that search.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager"><span>{total} accounts · page {page}</span><div className="head-actions"><button className="btn btn-quiet" disabled={page <= 1} onClick={() => loadDashboard(page - 1, query)}>Previous</button><button className="btn btn-quiet" disabled={page * 30 >= total} onClick={() => loadDashboard(page + 1, query)}>Next</button></div></div>
          {selectedUser && <section className="details" aria-live="polite"><div className="panel-head"><h3>{selectedUser.username} · account snapshot</h3><button className="btn btn-quiet" onClick={() => setSelectedUser(null)}>Close</button></div><div className="detail-grid">
            <div className="detail-item"><small>Email</small><strong>{selectedUser.email}</strong></div>
            <div className="detail-item"><small>Joined</small><strong>{dateLabel(selectedUser.joined_at)}</strong></div>
            <div className="detail-item"><small>Comments</small><strong>{selectedUser.comments_count}</strong></div>
            <div className="detail-item"><small>Reactions</small><strong>{selectedUser.reactions_count}</strong></div>
            <div className="detail-item"><small>Matching entries</small><strong>{selectedUser.same_sky_ready}/{selectedUser.same_sky_selected} ready</strong></div>
            <div className="detail-item"><small>Matching searches</small><strong>{selectedUser.same_sky_attempts}</strong></div>
          </div><UserStories key={selectedUser.id} userId={selectedUser.id} api={api} dateLabel={dateLabel} /></section>}
        </article>

        <aside className="card panel">
          <section className="worker-box" style={{ background: "rgba(0,0,0,0.03)", border: "2px solid #171717", borderRadius: 8, padding: 16, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <p className="eyebrow" style={{ margin: 0 }}>Background Worker</p>
              <span className={`pill ${overview?.worker_status?.running ? "" : "pill-off"}`}>
                {overview?.worker_status?.running ? (overview.worker_status.managed_externally ? "● RUNNING" : `● RUNNING (${overview.worker_status.pids.join(", ")})`) : "○ STOPPED"}
              </span>
            </div>
            <p className="panel-subtitle" style={{ fontSize: "0.82rem", marginBottom: 12 }}>
              {overview?.worker_status?.managed_externally ? "Managed by the server as a separate service." : "Event-driven via PostgreSQL LISTEN/NOTIFY. Start or stop the local worker here."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: workerActionNote ? 8 : 0 }}>
              <button
                type="button"
                className={`btn ${overview?.worker_status?.running ? "btn-coral" : ""}`}
                disabled={busy || overview?.worker_status?.managed_externally}
                onClick={toggleWorker}
              >
                {overview?.worker_status?.running ? "Turn OFF (Kill)" : "Turn ON (Start)"}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy || !overview?.worker_status?.queued_jobs}
                onClick={runBatch}
              >
                Process Backlog ({overview?.worker_status?.queued_jobs ?? 0})
              </button>
            </div>
            {workerActionNote && <p className="form-note" style={{ color: "#ff5c4d", margin: 0, marginTop: 8 }}>{workerActionNote}</p>}
          </section>

          <p className="eyebrow">same sky knobs</p><h2 style={{ marginBottom: 7 }}>Matching rules</h2><p className="panel-subtitle" style={{ marginBottom: 18 }}>Provider changes apply to analysis jobs picked up after saving. Matching rules apply immediately.</p>
          {settings && <form className="settings-form" onSubmit={saveSettings}>
            <div className="settings-field"><span>AI story analysis provider</span><div className="provider-switch" role="group" aria-label="AI story analysis provider"><button type="button" className={`btn ${settings.same_sky_ai_provider === "gemini" ? "" : "btn-quiet"}`} aria-pressed={settings.same_sky_ai_provider === "gemini"} onClick={() => setSettings({ ...settings, same_sky_ai_provider: "gemini" })}>Gemini</button><button type="button" className={`btn ${settings.same_sky_ai_provider === "groq" ? "" : "btn-quiet"}`} aria-pressed={settings.same_sky_ai_provider === "groq"} disabled={!overview?.ai_provider_status?.groq} onClick={() => setSettings({ ...settings, same_sky_ai_provider: "groq" })}>Groq</button></div><span className="field-help">New analysis jobs use this provider. Gemini still creates the matching embeddings. Completed stories are not reprocessed when you switch.</span></div>
            <label className="settings-field">Default platform theme<select value={settings.default_theme || "acid-lime"} onChange={(event) => setSettings({ ...settings, default_theme: event.target.value })}><option value="acid-lime">Acid Lime</option><option value="electric-purple">Electric Purple</option><option value="chaos-coral">Chaos Coral</option><option value="midnight">Midnight</option><option value="classic-paper">Classic Paper</option></select><span className="field-help">Used for new accounts and visitors without a saved theme. Existing personal theme choices stay as they are.</span></label>
            <label className="settings-field">Life experience posts required<input type="number" min="1" max="100" value={settings.same_sky_required_posts} onChange={(event) => setSettings({ ...settings, same_sky_required_posts: Number(event.target.value) })} required/><span className="field-help">Only opted-in entries with completed analysis count.</span></label>
            <label className="settings-field">Personal confessions required<input type="number" min="1" max="100" value={settings.same_sky_required_confessions} onChange={(event) => setSettings({ ...settings, same_sky_required_confessions: Number(event.target.value) })} required/><span className="field-help">Use separate values to tune both sides of readiness.</span></label>
            <label className="settings-field">No-match retry cooldown · minutes<input type="number" min="1" max="43200" value={settings.same_sky_retry_minutes} onChange={(event) => setSettings({ ...settings, same_sky_retry_minutes: Number(event.target.value) })} required/><span className="field-help">1 minute is handy for testing. 1440 minutes equals 1 day.</span></label>
            <p className="form-note" role="status">{settingNote}</p>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
          </form>}
          <div className="jobs"><span>AI jobs</span>{Object.entries(overview?.same_sky_jobs || {}).map(([status, count]) => <span key={status}>{status}: {count}</span>)}</div>
          <p className="note">User activity is shown as timestamps and totals only. Posts and confessions are available in the account detail view.</p>
        </aside>
      </section>
    </main>
  );
}
