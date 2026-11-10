"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getUnreadCount } from "../../lib/api";
import { getChatUnreadCount } from "../../lib/chatApi";
import { useWebSocketEvent, WS_EVENTS } from "../../lib/websocket";
import { THEMES, SYSTEM_THEME, themeByKey } from "../../lib/themes";
import { useTheme } from "./ThemeProvider";

function ThemeSelector() {
  const { theme, chooseTheme, ready, saving, error } = useTheme();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = themeByKey(theme);
  const themes = [SYSTEM_THEME, ...THEMES];

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <motion.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Theme: ${selected.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        whileHover={reduce ? undefined : { rotate: 8, scale: 1.08 }}
        whileTap={reduce ? undefined : { scale: 0.9 }}
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-white shadow-[3px_3px_0_var(--color-shadow)]"
      >
        <span className="h-5 w-5 rounded-full border border-ink" style={{ background: selected.color }} />
      </motion.button>
      <AnimatePresence>
        {open ? (
          <motion.section
            role="dialog"
            aria-label="Choose a theme"
            initial={reduce ? false : { opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -5, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
            className="absolute right-0 top-full z-50 mt-3 w-[min(92vw,23rem)] border-4 border-ink bg-white p-4 text-ink shadow-[8px_8px_0_var(--color-shadow)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-note text-2xl leading-none">change the whole mood</p>
                <h2 className="font-display text-xl font-extrabold">Pick a theme</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close theme picker" className="border-2 border-ink px-2 py-1 font-extrabold">×</button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {themes.map((item) => {
                const active = theme === item.key;
                return (
                  <motion.button
                    key={item.key}
                    type="button"
                    disabled={!ready}
                    aria-label={item.label}
                    aria-pressed={active}
                    onClick={() => chooseTheme(item.key)}
                    whileHover={reduce || !ready ? undefined : { y: -3, scale: 1.04 }}
                    whileTap={reduce || !ready ? undefined : { scale: 0.92 }}
                    className="flex flex-col items-center gap-1 text-center text-[10px] font-extrabold disabled:opacity-50"
                  >
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink text-on-brand ${active ? "ring-2 ring-ink ring-offset-2" : ""}`} style={{ background: item.color }}>
                      {active ? <span aria-hidden>✓</span> : null}
                    </span>
                    {item.label}
                  </motion.button>
                );
              })}
            </div>
            <p className="mt-4 text-xs font-semibold text-ink/70">
              {saving ? "Saving your palette…" : ready ? "Changes preview instantly and save automatically." : "Loading your palette…"}
            </p>
            <Link href="/settings/appearance" onClick={() => setOpen(false)} className="mt-3 inline-block text-xs font-extrabold underline underline-offset-4">Open Skin Studio →</Link>
            {error ? <p className="mt-2 text-xs font-bold text-danger" role="alert">{error}</p> : null}
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function BellIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function ChatIcon({ className = "h-4 w-4" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function UnreadBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = () => getUnreadCount().then((data) => setCount(data.count)).catch(() => setCount(0));
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("fmlcore:notifications-change", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("fmlcore:notifications-change", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return count ? <span className="ml-1 inline-flex min-w-5 items-center justify-center border border-ink bg-coral px-1 text-[10px] font-extrabold text-on-brand">{count > 99 ? "99+" : count}</span> : null;
}

function ChatUnreadBadge() {
  const [count, setCount] = useState(0);

  const refresh = () => {
    getChatUnreadCount().then((data) => setCount(data.count)).catch(() => setCount(0));
  };

  useEffect(() => {
    refresh();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("fmlcore:chat-change", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("fmlcore:chat-change", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE, () => refresh());
  useWebSocketEvent(WS_EVENTS.CHAT_MESSAGE_READ, () => refresh());

  return count ? (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center border border-ink bg-coral px-1 text-[10px] font-extrabold text-on-brand animate-pulse">
      {count > 99 ? "99+" : count}
    </span>
  ) : null;
}

function ActiveIndicator({ reduce }) {
  return <motion.span layoutId="active-nav-indicator" className="absolute inset-x-1 bottom-0 h-1 bg-coral" transition={reduce ? { duration: 0 } : { type: "tween", duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />;
}

export default function SiteHeader({ user }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const isActive = (href) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const navClass = (active) => `relative border-2 border-ink px-2 py-2 shadow-[3px_3px_0_var(--color-shadow)] sm:px-3 ${active ? "bg-soft-purple text-ink" : "bg-white"}`;

  return (
    <header className="site-navigation sticky top-0 z-20 border-b-4 border-ink bg-paper/95">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="FMLCore home" aria-current={isActive("/") ? "page" : undefined} className={`relative flex items-center gap-2 ${isActive("/") ? "text-ink" : ""}`}>
          <img src="/image/logo.png" alt="" className="h-9 w-9 border-2 border-ink bg-lime object-contain p-1" />
          <span className="site-wordmark hidden font-display text-xl font-extrabold tracking-tight sm:inline">FMLCore</span>
          {isActive("/") ? <ActiveIndicator reduce={reduce} /> : null}
        </Link>
        <nav className="flex items-center gap-1 text-xs font-bold sm:gap-2 sm:text-sm" aria-label="Main navigation">
          <Link href="/explore" aria-label="Explore" aria-current={isActive("/explore") ? "page" : undefined} className={navClass(isActive("/explore"))}>
            <span className="sm:hidden" aria-hidden>✦</span><span className="hidden sm:inline">Explore</span>
            {isActive("/explore") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          <Link href="/confessions" aria-label="Confession" aria-current={isActive("/confessions") ? "page" : undefined} className={navClass(isActive("/confessions"))}>
            <span className="sm:hidden" aria-hidden>◯</span><span className="hidden sm:inline">Confession</span>
            {isActive("/confessions") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          <Link href="/leaderboard" aria-label="Leaderboard" aria-current={isActive("/leaderboard") ? "page" : undefined} className={navClass(isActive("/leaderboard"))}>
            <span className="sm:hidden" aria-hidden>🏆</span><span className="hidden sm:inline">Leaderboard</span>
            {isActive("/leaderboard") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          {user ? <Link href="/same-sky" aria-label="Same Sky" aria-current={isActive("/same-sky") ? "page" : undefined} className={navClass(isActive("/same-sky"))}>
            <span className="sm:hidden" aria-hidden>☁</span><span className="hidden sm:inline">Same Sky</span>
            {isActive("/same-sky") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link> : null}
          {user ? (
            <Link
              href="/chat"
              aria-label="Chat"
              aria-current={isActive("/chat") ? "page" : undefined}
              className={`flex items-center ${navClass(isActive("/chat"))}`}
            >
              <ChatIcon className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
              <span className="common-ground-nav-label">Chat</span>
              <ChatUnreadBadge />
              {isActive("/chat") ? <ActiveIndicator reduce={reduce} /> : null}
            </Link>
          ) : null}
          {!user ? (
            <Link href="/me" aria-current={isActive("/me") ? "page" : undefined} className={navClass(isActive("/me"))}>About{isActive("/me") ? <ActiveIndicator reduce={reduce} /> : null}</Link>
          ) : null}
          {user ? (
            <Link
              href="/notifications"
              aria-current={isActive("/notifications") ? "page" : undefined}
              aria-label="Notifications"
              className={`flex items-center ${navClass(isActive("/notifications"))}`}
            >
              <BellIcon className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
              <span className="common-ground-nav-label">Updates</span>
              <UnreadBadge />
              {isActive("/notifications") ? <ActiveIndicator reduce={reduce} /> : null}
            </Link>
          ) : (
            <>
              <Link href="/login" aria-current={isActive("/login") ? "page" : undefined} className={navClass(isActive("/login"))}>Log in{isActive("/login") ? <ActiveIndicator reduce={reduce} /> : null}</Link>
              <Link href="/signup" aria-current={isActive("/signup") ? "page" : undefined} className={navClass(isActive("/signup"))}>Join{isActive("/signup") ? <ActiveIndicator reduce={reduce} /> : null}</Link>
            </>
          )}
          {user ? <Link href="/profile" aria-current={isActive("/profile") ? "page" : undefined} className={`${navClass(isActive("/profile"))} max-w-24 truncate sm:max-w-none`}>@{user.username}{isActive("/profile") ? <ActiveIndicator reduce={reduce} /> : null}</Link> : null}
          {user ? <Link href="/settings/appearance" aria-label="Skin Studio" aria-current={isActive("/settings") ? "page" : undefined} className={`${navClass(isActive("/settings"))} hidden lg:block`}>Skin{isActive("/settings") ? <ActiveIndicator reduce={reduce} /> : null}</Link> : null}
          <ThemeSelector />
        </nav>
      </div>
    </header>
  );
}
