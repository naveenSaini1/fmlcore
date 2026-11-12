"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { applicationServerKey, currentPushSubscription, pushSupported, removeBrowserPush } from "../../lib/browser-push";

export default function BrowserNotifications() {
  const { user } = useSession();
  const [status, setStatus] = useState("checking");
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!pushSupported()) { setStatus("unsupported"); return; }
    Promise.all([api("/browser-push/config"), currentPushSubscription()]).then(async ([settings, subscription]) => {
      if (!active) return;
      setConfig(settings);
      let enabled = false;
      if (subscription && Notification.permission === "granted" && settings.enabled) {
        const current = await api("/browser-push/subscriptions/status", {
          method: "POST",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        enabled = current.enabled;
      }
      if (active) setStatus(Notification.permission === "denied" ? "blocked" : enabled ? "enabled" : "disabled");
    }).catch(err => { if (active) { setError(err.message); setStatus("disabled"); } });
    return () => { active = false; };
  }, [user?.id]);
  async function toggle() {
    setBusy(true); setError("");
    try {
      if (status === "enabled") {
        await removeBrowserPush(api); setStatus("disabled"); return;
      }
      // Permission is requested only from this user click, never on page load.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(permission === "denied" ? "blocked" : "disabled"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.public_key) });
      try {
        await api("/browser-push/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      } catch (err) { await subscription.unsubscribe(); throw err; }
      setStatus("enabled");
    } catch (err) { setError(err.message || "Couldn't enable notifications. Please try again."); }
    finally { setBusy(false); }
  }
  if (!user) return null;
  return <section className="mb-6 border-4 border-ink bg-white p-5 shadow-[4px_4px_0_var(--color-shadow)]" aria-labelledby="browser-notifications-title">
    <h2 id="browser-notifications-title" className="font-display text-2xl font-extrabold">Browser notifications</h2>
    <p className="mt-2 text-sm">Get a private alert for reactions, comments, matches and messages, even when this tab is closed. Alerts hide names and message content.</p>
    <p className="mt-2 text-sm" role="status">{status === "unsupported" ? "Browser notifications are unavailable here. Try a browser that supports Web Push." : status === "blocked" ? "Notifications are blocked. Change this site's notification permission in your browser settings to enable them." : status === "enabled" ? "Enabled on this browser." : config && !config.enabled ? "Browser notifications are temporarily unavailable." : "You choose whether to allow notifications on this browser."}</p>
    {!["unsupported", "blocked"].includes(status) && <button type="button" onClick={toggle} disabled={busy || status === "checking" || !config?.enabled} className="mt-3 border-2 border-ink bg-lime px-4 py-2 font-extrabold disabled:opacity-50">{busy ? "Saving…" : status === "enabled" ? "Disable browser notifications" : "Enable browser notifications"}</button>}
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
  </section>;
}
