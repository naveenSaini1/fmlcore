"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../../lib/api";
import { useSession } from "../../lib/session";
import { timeAgo } from "../../lib/format";

function notificationCopy(item) {
  const actor = item.is_anonymous ? "Someone anonymously" : `@${item.actor?.username ?? "Someone"}`;
  if (item.kind === "same_sky_request") return `${actor} is open to connecting with you on Same Sky.`;
  if (item.kind === "same_sky_reopened") return `${actor} reopened your declined Same Sky connection. You can send a fresh request.`;
  if (item.kind === "same_sky_declined") return `${actor} declined your Same Sky connection request.`;
  if (item.kind === "same_sky_connected") return `${actor} accepted your Same Sky request. You’re connected.`;
  if (item.kind === "reaction") return "Someone voted on your post.";
  if (item.kind === "reply") return "Someone replied to your comment.";
  return "Someone commented on your post.";
}

function notificationLink(item) {
  if (item.kind.startsWith("same_sky_")) return { href: "/same-sky", label: "Open Same Sky" };
  if (!item.post_id) return null;
  const post = `/posts/${item.post_id}`;
  return item.comment_id
    ? { href: `${post}?comment=${item.comment_id}#comment-${item.comment_id}`, label: "Open comment" }
    : { href: post, label: "Open story" };
}

export default function NotificationsPage() {
  const { user, ready } = useSession();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const loadRevision = useRef(0);

  async function load(cursorValue = null, append = false) {
    const revision = ++loadRevision.current;
    setError("");
    try {
      const data = await getNotifications(cursorValue);
      if (revision !== loadRevision.current) return;
      setItems((current) => append ? [...new Map([...current, ...data.notifications].map((item) => [item.id, item])).values()] : data.notifications);
      setCursor(data.next_cursor);
      setStatus("ready");
    } catch (err) {
      if (revision !== loadRevision.current) return;
      setError(err.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (ready && !user) window.location.replace("/login");
  }, [ready, user]);

  useEffect(() => {
    if (!ready || !user) return undefined;
    const refresh = () => load();
    window.addEventListener("fmlcore:notifications-change", refresh);
    // Covers events delivered while the initial auth request was in flight.
    refresh();
    return () => {
      loadRevision.current += 1;
      window.removeEventListener("fmlcore:notifications-change", refresh);
    };
  }, [ready, user?.id]);

  async function markOne(id) {
    try {
      await markNotificationRead(id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
    } catch (err) {
      setError(err.message);
    }
  }

  async function markAll() {
    setPending(true);
    setError("");
    try {
      await markAllNotificationsRead();
      // A new notification can arrive while the read-all request is in flight.
      await load();
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
            <p className="mt-2 font-semibold">New replies, reactions, and Same Sky updates will show up here.</p>
          </div>
        ) : null}
        <div className="space-y-3">
          {items.map((item) => {
            const link = notificationLink(item);
            return (
            <article key={item.id} className={`notification-card border-4 border-ink p-4 ${item.is_read ? "bg-white" : "bg-purple text-on-brand"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{notificationCopy(item)}</p>
                  <p className={`mt-1 font-note text-lg leading-none ${item.is_read ? "text-ink/70" : "text-on-brand/70"}`}>{timeAgo(item.created_at)}</p>
                </div>
                {!item.is_read ? <span className="mt-1 h-3 w-3 shrink-0 border-2 border-ink bg-lime" aria-label="Unread" /> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm font-extrabold">
                {link && <Link href={link.href} onClick={() => { if (!item.is_read) void markOne(item.id); }} className="underline">{link.label}</Link>}
                {!item.is_read ? <button type="button" onClick={() => markOne(item.id)} className="underline">Mark read</button> : null}
              </div>
            </article>
            );
          })}
        </div>
        {cursor ? <button type="button" onClick={() => load(cursor, true)} className="mt-4 w-full border-4 border-ink bg-white px-4 py-3 font-extrabold">Load older notifications</button> : null}
      </main>
    </>
  );
}
