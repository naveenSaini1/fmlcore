"use client";

import { useErrorToast } from "./ErrorToast";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getExplorePosts,
  mediaUrl,
} from "../../lib/api";
import Composer from "./Composer";
import PostCard from "./PostCard";
import LeaderboardPanel from "./LeaderboardPanel";

const PAGE_SIZE = 5;

export default function Explore({ user, sessionReady }) {
  const [draft, setDraft] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState("");
  useErrorToast(pageError);
  const sentinel = useRef(null);
  const pendingPage = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  useErrorToast(error);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setCursor(null);
    setLoadingMore(false);
    setPageError("");
    setError("");
    getExplorePosts({ limit: PAGE_SIZE }).then(data => {
        if (active) {
          setPosts(data.posts);
          setCursor(data.next_cursor);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setStatus("error");
        }
      });
    return () => {
      active = false;
      pendingPage.current = null;
    };
  }, [refreshKey, user?.id]);

  const loadMore = useCallback(async () => {
    if (status !== "ready" || !cursor || pendingPage.current) return;
    const request = {};
    pendingPage.current = request;
    setLoadingMore(true);
    setPageError("");
    try {
      const data = await getExplorePosts({ cursor, limit: PAGE_SIZE });
      if (pendingPage.current !== request) return;
      setPosts(current => [...new Map([...current, ...data.posts].map(post => [post.id, post])).values()]);
      setCursor(data.next_cursor === cursor ? null : data.next_cursor);
    } catch (err) {
      if (pendingPage.current === request) setPageError(err.message);
    } finally {
      if (pendingPage.current === request) {
        pendingPage.current = null;
        setLoadingMore(false);
      }
    }
  }, [status, cursor]);

  useEffect(() => {
    if (status !== "ready" || !cursor || pageError || loadingMore || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [status, cursor, pageError, loadingMore, loadMore]);

  useEffect(() => {
    if (!user?.id) return;
    const initialPrompt = new URLSearchParams(window.location.search).get("prompt");
    if (initialPrompt) setDraft({ prompt: initialPrompt });
  }, [user?.id]);

  function postCreated(post) {
    setDraft(null);
    setRefreshKey(key => key + 1);
    window.dispatchEvent(new CustomEvent("fmlcore:post-created", { detail: post }));
  }

  const writeEntry = <>
    <img className="h-11 w-11 shrink-0 border-2 border-ink bg-white object-cover sm:h-12 sm:w-12" src={mediaUrl(user?.avatar_url) || "/image/user.png"} alt="" />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="font-display text-lg font-extrabold leading-tight sm:text-xl">Write a post</span>
      <span className="text-sm font-semibold text-ink/70">What&apos;s on your mind today?</span>
    </span>
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center border-2 border-ink bg-ink text-on-ink">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="m13.5 6.5 4 4M4 20l4.5-1 11-11a2.8 2.8 0 0 0-4-4l-11 11L4 20Z" />
      </svg>
    </span>
  </>;
  const writeClass = "explore-write flex w-full cursor-pointer items-center gap-3 rounded-xl border border-ink/15 bg-[var(--theme-tint,var(--color-white))] p-4 text-left text-ink transition-colors hover:bg-white sm:gap-4 sm:p-5";

  return (
    <main className="explore-page mx-auto px-4 py-5 sm:px-6 sm:py-8">
      <div className="discovery-layout grid gap-7">
      <div className="min-w-0">
      {sessionReady && !user && <header className="page-introduction mb-7 hidden sm:block">
        <p className="font-note text-3xl leading-none">take a left turn</p>
        <h1 className="font-display text-5xl font-extrabold leading-[0.9] tracking-tight md:text-6xl">
          Explore the weird.
        </h1>
        <p className="mt-3 max-w-xl text-lg font-semibold">Find a story that feels familiar, or one you never saw coming.</p>
      </header>}

      <section aria-label="Write a post" className="mb-5 scroll-mt-24 sm:mb-6" id="write-post">
        {user ? (
          draft ? (
            <Composer key={draft.prompt} user={user} initialPrompt={draft.prompt} focusOnOpen onClose={() => setDraft(null)} onCreated={postCreated} />
          ) : <button type="button" onClick={() => setDraft({ prompt: "" })} className={writeClass}>{writeEntry}</button>
        ) : <Link href="/login" className={writeClass}>{writeEntry}</Link>}
      </section>

      <section aria-label="Browse stories">
        <div className="story-list feed-posts space-y-4 sm:space-y-6">
          {status === "loading" ? <p className="font-note text-3xl leading-none">looking around…</p> : null}
          {status === "error" ? (
            <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="border-2 border-ink bg-white px-3 py-1 font-extrabold">Try loading stories again</button>
          ) : null}
          {status === "ready" && posts.length === 0 ? (
            <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
              <p className="font-display text-2xl font-extrabold">No stories found in this corner.</p>
            </div>
          ) : null}
          {posts.map((post, index) => <PostCard key={post.id} post={post} index={index} viewerId={user?.id} />)}
          {status === "ready" && cursor ? (
            <div ref={sentinel} className="min-h-px">
              {loadingMore && <p className="text-sm" role="status">Loading more stories…</p>}
              {(pageError || typeof IntersectionObserver === "undefined") && !loadingMore && (
                <button type="button" onClick={loadMore} className="border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold">
                  {pageError ? "Retry loading stories" : "Load more stories"}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>
      </div>
      <div className="hidden lg:contents">
        <LeaderboardPanel />
      </div>
      </div>
    </main>
  );
}
