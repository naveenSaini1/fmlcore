"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getMe, getNotifications, markAllNotificationsRead, markNotificationRead } from "../../lib/api";
import { timeAgo } from "../../lib/format";

function notificationCopy(item) {
  const actor = item.is_anonymous ? "Someone anonymously" : `@${item.actor?.username ?? "Someone"}`;
  if (item.kind === "reaction") return `${actor} reacted to your post.`;
  if (item.kind === "reply") return `${actor} replied to your comment.`;
  return `${actor} commented on your post.`;
}

export default function NotificationsPage() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load(cursorValue = null, append = false) {
    setError("");
    try {
      const data = await getNotifications(cursorValue);
      setItems((current) => append ? [...current, ...data.notifications] : data.notifications);
      setCursor(data.next_cursor);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    getMe().then((me) => {
      setUser(me);
      load();
    }).catch(() => {
      window.location.replace("/login");
    });
  }, []);

  async function markOne(id) {
    try {
      await markNotificationRead(id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
      window.dispatchEvent(new Event("fmlcore:notifications-change"));
    } catch (err) {
      setError(err.message);
    }
  }

  async function markAll() {
    setPending(true);
    setError("");
    try {
      await markAllNotificationsRead();
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      window.dispatchEvent(new Event("fmlcore:notifications-change"));
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-note text-3xl leading-none">little signs of life</p>
            <h1 className="font-display text-4xl font-extrabold">Notifications</h1>
          </div>
          <button type="button" onClick={markAll} disabled={pending || !items.some((item) => !item.is_read)} className="border-2 border-ink bg-lime px-3 py-2 text-sm font-extrabold text-on-brand disabled:opacity-50">
            {pending ? "Saving…" : "Mark all read"}
          </button>
        </header>
        {error ? <p className="mb-4 border-4 border-ink bg-coral p-3 font-bold text-on-brand" role="alert">{error}</p> : null}
        {status === "loading" ? <p className="font-note text-2xl">Checking in…</p> : null}
        {status === "ready" && items.length === 0 ? (
          <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
            <p className="font-display text-2xl font-extrabold">All quiet for now.</p>
            <p className="mt-2 font-semibold">When someone reacts or replies, it will show up here.</p>
          </div>
        ) : null}
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className={`border-4 border-ink p-4 ${item.is_read ? "bg-white" : "bg-purple text-on-brand"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{notificationCopy(item)}</p>
                  <p className={`mt-1 font-note text-lg leading-none ${item.is_read ? "text-ink/70" : "text-on-brand/70"}`}>{timeAgo(item.created_at)}</p>
                </div>
                {!item.is_read ? <span className="mt-1 h-3 w-3 shrink-0 border-2 border-ink bg-lime" aria-label="Unread" /> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-extrabold">
                <Link href="/" className="underline">Open the feed</Link>
                {!item.is_read ? <button type="button" onClick={() => markOne(item.id)} className="underline">Mark read</button> : null}
              </div>
            </article>
          ))}
        </div>
        {cursor ? <button type="button" onClick={() => load(cursor, true)} className="mt-4 w-full border-4 border-ink bg-white px-4 py-3 font-extrabold">Load older notifications</button> : null}
      </main>
    </>
  );
}
