"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { getUnreadCount } from "../../lib/api";
import { useWebSocket } from "../../lib/websocket";
import GuestAppearance from "./GuestAppearance";

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

function useNotificationUnread(enabled) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const requestRevision = ++revision;
      try {
        const data = await getUnreadCount();
        if (active && requestRevision === revision) setCount(data.count);
      } catch { /* Keep the last known count during a temporary outage. */ }
    };
    refresh();
    window.addEventListener("fmlcore:notifications-change", refresh);
    return () => {
      active = false;
      window.removeEventListener("fmlcore:notifications-change", refresh);
    };
  }, [enabled]);

  return count;
}

function useChatUnread(enabled) {
  const { chatUnreadCount } = useWebSocket();
  return enabled ? chatUnreadCount : 0;
}

function UnreadBadge({ count }) {
  return count ? <span className="nav-unread ml-1 inline-flex min-w-5 items-center justify-center border border-ink bg-coral px-1 text-[10px] font-extrabold text-on-brand">{count > 99 ? "99+" : count}</span> : null;
}

function MobileIcon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
    explore: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5z" /></>,
    confession: <><path d="M8 16c-2-2-3-4-3-7a7 7 0 0 1 14 0c0 3-1 5-3 7l-4 2zM12 18c-3 3 3 3 0 6" /><path d="M8 7c0-1 .5-2 2-2" /></>,
    sky: <><path d="M7 18H6a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 0 10h-1" /><path d="m12 12 1.2 2.8L16 16l-2.8 1.2L12 20l-1.2-2.8L8 16l2.8-1.2z" /></>,
    leaderboard: <><path d="M8 3h8v5a4 4 0 0 1-8 0zM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3h8m-6-3h4v3" /></>,
    about: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
  };
  if (name === "chat") return <ChatIcon className="mobile-nav-icon" />;
  if (name === "notifications") return <BellIcon className="mobile-nav-icon" />;
  return <svg className="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ActiveIndicator({ reduce }) {
  return <motion.span layoutId="active-nav-indicator" className="absolute inset-x-1 bottom-0 h-1 bg-coral" transition={reduce ? { duration: 0 } : { type: "tween", duration: 0.55, ease: [0.22, 1, 0.36, 1] }} />;
}

export default function SiteHeader({ user }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const notificationCount = useNotificationUnread(Boolean(user));
  const chatCount = useChatUnread(Boolean(user));
  const isActive = (href) => href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const navClass = (active) => `relative border-2 border-ink px-2 py-2 shadow-[3px_3px_0_var(--color-shadow)] sm:px-3 ${active ? "bg-soft-purple text-ink" : "bg-white"}`;

  const mobileItems = [
    { href: "/", label: "Home", icon: "home" },
    { href: "/explore", label: "Explore", icon: "explore" },
    { href: "/confessions", label: "Confession", icon: "confession" },
    { href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" },
    ...(user ? [
      { href: "/chat", label: "Chat", icon: "chat" },
    ] : [
      { href: "/me", label: "About", icon: "about" },
    ]),
  ];

  return <>
    <header className="site-navigation sticky top-0 z-20 border-b-4 border-ink bg-paper/95">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="FMLCore home" aria-current={isActive("/") ? "page" : undefined} className={`relative flex items-center gap-2 ${isActive("/") ? "text-ink" : ""}`}>
          <img src="/image/logo.png" alt="" className="h-9 w-9 border-2 border-ink bg-lime object-contain p-1" />
          <span className="site-wordmark hidden font-display text-xl font-extrabold tracking-tight sm:inline">FMLCore</span>
          {isActive("/") ? <ActiveIndicator reduce={reduce} /> : null}
        </Link>
        <nav className="flex items-center gap-1 text-xs font-bold sm:gap-2 sm:text-sm" aria-label="Main navigation">
          <Link href="/explore" aria-label="Explore" aria-current={isActive("/explore") ? "page" : undefined} className={navClass(isActive("/explore"))}>
            <span>Explore</span>
            {isActive("/explore") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          <Link href="/confessions" aria-label="Confession" aria-current={isActive("/confessions") ? "page" : undefined} className={navClass(isActive("/confessions"))}>
            <span>Confession</span>
            {isActive("/confessions") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          <Link href="/leaderboard" aria-label="Leaderboard" aria-current={isActive("/leaderboard") ? "page" : undefined} className={navClass(isActive("/leaderboard"))}>
            <span>Leaderboard</span>
            {isActive("/leaderboard") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link>
          {user ? <Link href="/same-sky" aria-label="Same Sky" aria-current={isActive("/same-sky") ? "page" : undefined} className={navClass(isActive("/same-sky"))}>
            <span>Same Sky</span>
            {isActive("/same-sky") ? <ActiveIndicator reduce={reduce} /> : null}
          </Link> : null}
          {user ? (
            <Link
              href="/chat"
              aria-label="Chat"
              aria-current={isActive("/chat") ? "page" : undefined}
              className={`flex items-center ${navClass(isActive("/chat"))}`}
            >
              <ChatIcon className="nav-icon h-4 w-4 sm:h-4.5 sm:w-4.5" />
              <span className="common-ground-nav-label">Chat</span>
              <UnreadBadge count={chatCount} />
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
              <BellIcon className="nav-icon h-4 w-4 sm:h-4.5 sm:w-4.5" />
              <span className="common-ground-nav-label">Notifications</span>
              <UnreadBadge count={notificationCount} />
              {isActive("/notifications") ? <ActiveIndicator reduce={reduce} /> : null}
            </Link>
          ) : (
            <>
              <Link href="/signup" aria-current={isActive("/signup") ? "page" : undefined} className={navClass(isActive("/signup"))}>Join{isActive("/signup") ? <ActiveIndicator reduce={reduce} /> : null}</Link>
            </>
          )}
        </nav>
        {!user && <GuestAppearance />}
        <div className="mobile-header-actions">
          {user ? <>
            <Link href="/same-sky" aria-label="Same Sky" title="Same Sky" aria-current={isActive("/same-sky") ? "page" : undefined}><MobileIcon name="sky" /></Link>
            <Link href="/notifications" aria-label="Notifications" title="Notifications" aria-current={isActive("/notifications") ? "page" : undefined}><MobileIcon name="notifications" /><UnreadBadge count={notificationCount} /></Link>
          </> : <Link href="/signup" className="mobile-guest-join">Join</Link>}
        </div>
      </div>
    </header>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {mobileItems.map((item) => <Link key={item.href} href={item.href} aria-label={item.label} title={item.label} aria-current={isActive(item.href) ? "page" : undefined}>
        <span className="mobile-nav-symbol"><MobileIcon name={item.icon} />{item.icon === "chat" && <UnreadBadge count={chatCount} />}</span>
        <span className="sr-only">{item.label}</span>
      </Link>)}
    </nav>
  </>;
}
