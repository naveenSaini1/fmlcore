"use client";

import { showErrorToast } from "./ErrorToast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { addComment, deleteComment, getComments, mediaUrl } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { profileColor, profileSticker } from "../../lib/profile-style";

function Identity({ comment }) {
  const IdentityTag = !comment.is_anonymous && comment.author?.username ? Link : "div";
  const avatar = comment.author ? mediaUrl(comment.author.avatar_url) : null;
  return (
    <IdentityTag {...(IdentityTag === Link ? { href: `/users/${encodeURIComponent(comment.author.username)}` } : {})} className="flex items-center gap-2">
      {comment.is_anonymous ? (
        <span className="flex h-6 w-6 items-center justify-center border-2 border-ink bg-ink text-xs text-on-ink">?</span>
      ) : avatar ? (
        <img src={avatar} alt="" className="h-6 w-6 border-2 border-ink object-cover" />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center border-2 border-ink bg-paper">
          <img src="/image/user.png" alt="" className="h-3.5 w-3.5 object-contain" />
        </span>
      )}
      {comment.is_anonymous ? (
        <span className="text-xs font-extrabold">Anonymous{comment.anonymous_number ? ` #${comment.anonymous_number}` : ""}</span>
      ) : (
        <span className="inline-flex items-center gap-1 px-1 font-extrabold text-on-brand" style={{ backgroundColor: profileColor(comment.author?.profile_color) }}>
          @{comment.author?.username ?? "someone"} <span aria-hidden>{profileSticker(comment.author?.profile_sticker)}</span>
        </span>
      )}
      {comment.is_op && (
        <span aria-label="Original poster" title="Original poster" className="border border-ink bg-lime px-1 text-xs font-extrabold leading-tight text-on-brand">
          OP
        </span>
      )}
      <span className="font-note text-base leading-none text-ink/60">{timeAgo(comment.created_at)}</span>
    </IdentityTag>
  );
}

function CommentForm({ onSubmit, pending, reply = false }) {
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (pending || !body.trim()) return;
    if (await onSubmit(body.trim(), anon)) {
      setBody("");
      setAnon(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={1000}
        aria-label={reply ? "Write a reply" : "Start a conversation"}
        placeholder={reply ? "Write a reply…" : "Start a conversation…"}
        className="min-h-16 w-full resize-y border-2 border-ink bg-white px-2 py-1.5 text-sm outline-none placeholder:text-ink/40"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-extrabold">
          <input type="checkbox" checked={anon} onChange={(event) => setAnon(event.target.checked)} className="h-3.5 w-3.5 accent-ink" />
          Anonymous
        </label>
        <button type="submit" disabled={pending || !body.trim()} className="border-2 border-ink bg-lime px-3 py-1 text-xs font-extrabold disabled:opacity-60">
          {pending ? "Posting…" : reply ? "Reply" : "Comment"}
        </button>
      </div>
    </form>
  );
}

function CommentItem({ postId, comment, refresh, viewerId, focusComment, onReplyPosted }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function removeComment() {
    if (!window.confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      await deleteComment(comment.id);
      await refresh();
    } catch (err) {
      showErrorToast(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function submitReply(body, anon) {
    setPending(true);
    try {
      const reply = await addComment(postId, { body, parentId: comment.id, isAnonymous: anon });
      onReplyPosted(reply.id);
      setOpen(false);
      await refresh();
      return true;
    } catch (err) {
      if (err.status === 401) router.push("/login");
      else showErrorToast(err.message);
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      id={`comment-${comment.id}`}
      className={`scroll-mt-24 py-2 ${focusComment === comment.id ? "ring-2 ring-coral" : ""}`}
    >
      {comment.reply_to && <p className="mb-1 break-words text-xs font-semibold text-ink/60">↳ Replying to {comment.reply_to}</p>}
      {comment.is_deleted ? <p className="text-sm italic text-ink/60">Deleted comment</p> : (
        <>
          <Identity comment={comment} />
          <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold">{comment.body}</p>
          {viewerId && (
            <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="mt-2 text-xs font-extrabold text-ink/70 underline">
              {open ? "Cancel" : "Reply"}
            </button>
          )}
          {comment.is_mine && (
            <button type="button" disabled={deleting} onClick={removeComment} className="ml-3 mt-2 text-xs font-extrabold text-ink/60 underline disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          {open && viewerId && <CommentForm reply pending={pending} onSubmit={submitReply} />}
        </>
      )}
    </div>
  );
}

const REPLIES_PER_BATCH = 3;
const COMMENTS_PER_BATCH = 5;
const threadButtonClass = "text-xs font-extrabold text-ink/70 underline disabled:opacity-60";

export function ThreadReveal({ children }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
      exit={{ height: 0, opacity: 0, overflow: "hidden" }}
      style={{ overflow: "hidden" }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

function Conversation({ root, focusComment, ...itemProps }) {
  const [visibleReplies, setVisibleReplies] = useState(REPLIES_PER_BATCH);
  const [revealedReply, setRevealedReply] = useState(focusComment);
  const revealedIndex = root.replies.findIndex((reply) => reply.id === revealedReply);
  const replyLimit = Math.max(visibleReplies, revealedIndex + 1);
  const remainingReplies = root.replies.length - replyLimit;
  const commentProps = { ...itemProps, focusComment, onReplyPosted: setRevealedReply };

  return (
    <div className="border border-ink/25 bg-white px-2 sm:px-3">
      <CommentItem key={root.id} comment={root} {...commentProps} />
      {root.replies.length > 0 && (
        <div className="mb-2 ml-2 border-l border-ink/20 pl-2">
          <AnimatePresence initial={false}>
            {root.replies.slice(0, replyLimit).map((comment) => (
              <ThreadReveal key={comment.id}>
                <CommentItem comment={comment} {...commentProps} />
              </ThreadReveal>
            ))}
          </AnimatePresence>
        </div>
      )}
      {root.replies.length > 0 && (
        <div className="mb-2 ml-2 flex flex-wrap gap-x-3">
          {remainingReplies > 0 && (
            <button type="button" className={threadButtonClass} onClick={() => setVisibleReplies(replyLimit + REPLIES_PER_BATCH)}>
              {replyLimit === 0 ? "Show replies" : "Show more replies"} ({remainingReplies})
            </button>
          )}
          {replyLimit > 0 && (
            <button type="button" className={threadButtonClass} onClick={() => { setVisibleReplies(0); setRevealedReply(null); }}>
              Hide replies
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const REFRESH_INTERVAL = 5000;

export default function Comments({ post, onCountChange, viewerId, focusComment, onHide }) {
  const router = useRouter();
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [ready, setReady] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [visibleComments, setVisibleComments] = useState(COMMENTS_PER_BATCH);
  const pages = useRef(1);
  const request = useRef(null);
  const active = useRef(false);
  const countHandler = useRef(onCountChange);

  useEffect(() => { countHandler.current = onCountChange; }, [onCountChange]);

  const refresh = useCallback(async ({ more = false, background = false } = {}) => {
    if (!active.current || (background && (request.current || document.hidden))) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const targetPages = pages.current + Number(more);
    try {
      const loaded = new Map();
      let data = await getComments(post.id, null, focusComment, controller.signal);
      const count = data.comment_count;
      for (let page = 1; ; page++) {
        for (const root of data.comments) loaded.set(root.id, root);
        if (!data.next_cursor || page >= targetPages) break;
        data = await getComments(post.id, data.next_cursor, null, controller.signal);
      }
      if (controller.signal.aborted) return;
      pages.current = targetPages;
      setComments([...loaded.values()]);
      setCursor(data.next_cursor);
      setReady(true);
      countHandler.current?.(count);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err.status === 404) {
        setComments([]);
        setCursor(null);
        showErrorToast(err.message);
      } else if (!background) {
        showErrorToast(err.message);
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [post.id, focusComment]);

  useEffect(() => {
    active.current = true;
    refresh();
    const interval = window.setInterval(() => refresh({ background: true }), REFRESH_INTERVAL);
    const resume = () => refresh({ background: true });
    document.addEventListener("visibilitychange", resume);
    return () => {
      active.current = false;
      request.current?.abort();
      request.current = null;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  useEffect(() => {
    if (ready && focusComment) {
      document.getElementById(`comment-${focusComment}`)?.scrollIntoView({ block: "center" });
    }
  }, [ready, focusComment]);

  async function submitTop(body, anon) {
    setPosting(true);
    try {
      await addComment(post.id, { body, isAnonymous: anon });
      setVisibleComments((count) => Math.max(count, COMMENTS_PER_BATCH));
      await refresh();
      return true;
    } catch (err) {
      if (err.status === 401) router.push("/login");
      else showErrorToast(err.message);
      return false;
    } finally {
      setPosting(false);
    }
  }

  async function loadMore() {
    if (commentLimit < comments.length) {
      setVisibleComments(commentLimit + COMMENTS_PER_BATCH);
      return;
    }
    setLoadingMore(true);
    try {
      if (await refresh({ more: true })) {
        setVisibleComments(commentLimit + COMMENTS_PER_BATCH);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const focusedIndex = comments.findIndex((root) => root.id === focusComment || root.replies.some((reply) => reply.id === focusComment));
  const commentLimit = Math.max(visibleComments, focusedIndex + 1);

  return (
    <div className="mt-4 border-t border-ink/25 pt-3">
      {viewerId && <CommentForm pending={posting} onSubmit={submitTop} />}
      <div className="mt-3">
        <AnimatePresence initial={false}>
          {comments.slice(0, commentLimit).map((root) => (
            <ThreadReveal key={root.id}>
              <div className="pb-3">
                <Conversation root={root} postId={post.id} viewerId={viewerId} focusComment={focusComment} refresh={refresh} />
              </div>
            </ThreadReveal>
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3">
        {(cursor || commentLimit < comments.length) && (
          <button type="button" onClick={loadMore} disabled={loadingMore} className={threadButtonClass}>
            {loadingMore ? "Loading…" : "Show more comments"}
          </button>
        )}
        {commentLimit > 0 && comments.length > 0 && (
          <button type="button" onClick={onHide} disabled={loadingMore} className={threadButtonClass}>
            Hide comments
          </button>
        )}
      </div>
    </div>
  );
}
