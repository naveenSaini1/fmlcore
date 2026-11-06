"use client";

import { useEffect, useState } from "react";
import { addComment, deleteComment, getComments, mediaUrl } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { profileColor, profileSticker } from "../../lib/profile-style";

function Identity({ comment }) {
  const avatar = comment.author ? mediaUrl(comment.author.avatar_url) : null;
  return (
    <div className="flex items-center gap-2">
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
        <span className="text-xs font-extrabold">Anonymous</span>
      ) : (
        <span className="inline-flex items-center gap-1 px-1 font-extrabold text-on-brand" style={{ backgroundColor: profileColor(comment.author?.profile_color) }}>
          @{comment.author?.username ?? "someone"} <span aria-hidden>{profileSticker(comment.author?.profile_sticker)}</span>
        </span>
      )}
      <span className="font-note text-base leading-none text-ink/60">{timeAgo(comment.created_at)}</span>
    </div>
  );
}

function ReplyForm({ onSubmit, pending }) {
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    await onSubmit(body.trim(), anon);
    setBody("");
    setAnon(false);
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 1000))}
        placeholder="say something back…"
        className="min-h-16 w-full resize-y border-2 border-ink bg-white px-2 py-1.5 text-sm outline-none placeholder:text-ink/40"
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-extrabold">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="h-3.5 w-3.5 accent-ink" />
          Anonymous
        </label>
        <button
          type="submit"
          disabled={pending}
          className="border-2 border-ink bg-ink px-3 py-1 text-xs font-extrabold text-on-ink disabled:opacity-60"
        >
          {pending ? "…" : "Reply"}
        </button>
      </div>
    </form>
  );
}

function CommentItem({ postId, comment, onReplyAdded, viewerId, onHideUser, hiddenAuthors }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function removeComment(id) {
    if (!window.confirm("Delete this comment permanently?")) return;
    setDeleting(true);
    try { await deleteComment(id); window.dispatchEvent(new CustomEvent("fmlcore:comment-deleted", { detail: { postId, commentId: comment.id, deletedId: id } })); }
    catch (err) { setError(err.message); setDeleting(false); }
  }

  async function submitReply(body, anon) {
    setPending(true);
    setError("");
    try {
      const reply = await addComment(postId, { body, parentId: comment.id, isAnonymous: anon });
      onReplyAdded(comment.id, reply);
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-2 border-ink bg-white p-3">
      <Identity comment={comment} />
      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold">{comment.body}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs font-extrabold text-ink/70 underline"
      >
        {open ? "Cancel" : "Reply"}
      </button>
      {comment.is_mine ? <button type="button" disabled={deleting} onClick={() => removeComment(comment.id)} className="ml-3 mt-2 text-xs font-extrabold text-ink/60 underline disabled:opacity-50">{deleting ? "Deleting…" : "Delete"}</button> : null}
      {error ? <p className="mt-1 text-xs font-bold text-danger">{error}</p> : null}
      {open ? <ReplyForm onSubmit={submitReply} pending={pending} /> : null}

      {comment.replies?.length ? (
        <div className="mt-3 space-y-2 border-l-4 border-ink pl-3">
          {comment.replies.filter((reply) => !hiddenAuthors.has(reply.author?.id)).map((reply) => (
            <div key={reply.id}>
              <Identity comment={reply} />
              <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold">{reply.body}</p>
              {reply.is_mine ? <button type="button" disabled={deleting} onClick={() => removeComment(reply.id)} className="mt-1 text-xs font-extrabold text-ink/60 underline disabled:opacity-50">{deleting ? "Deleting…" : "Delete"}</button> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Comments({ post, onCountChange, viewerId }) {
  const [comments, setComments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hiddenAuthors, setHiddenAuthors] = useState(new Set());

  function hideAuthor(id) {
    setHiddenAuthors((current) => new Set([...current, id]));
  }

  async function load(initial) {
    try {
      const data = await getComments(post.id, initial ? null : cursor);
      setComments((prev) => (initial ? data.comments : [...prev, ...data.comments]));
      setCursor(data.next_cursor);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDeleted = (event) => {
      const { postId, commentId, deletedId } = event.detail || {};
      if (postId !== post.id) return;
      let removed = 0;
      setComments((current) => current.flatMap((item) => {
        if (item.id === deletedId) { removed += 1 + (item.replies?.length || 0); return []; }
        const replies = item.replies || [];
        if (replies.some((reply) => reply.id === deletedId)) {
          removed += 1;
          return [{ ...item, replies: replies.filter((reply) => reply.id !== deletedId) }];
        }
        return [item];
      }));
      if (removed) bump(-removed);
    };
    window.addEventListener("fmlcore:comment-deleted", onDeleted);
    return () => window.removeEventListener("fmlcore:comment-deleted", onDeleted);
  }, [post.id]);

  function bump(delta) {
    onCountChange?.(delta);
  }

  async function submitTop(event) {
    event.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setError("");
    try {
      const created = await addComment(post.id, { body: body.trim(), isAnonymous: anon });
      setComments((prev) => [{ ...created, replies: [] }, ...prev]);
      setBody("");
      setAnon(false);
      bump(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  function onReplyAdded(parentId, reply) {
    setComments((prev) =>
      prev.map((c) => (c.id === parentId ? { ...c, replies: [...(c.replies || []), reply] } : c)),
    );
    bump(1);
  }

  async function loadMore() {
    setLoadingMore(true);
    await load(false);
    setLoadingMore(false);
  }

  return (
    <div className="mt-4 border-t-4 border-ink pt-4">
      <form onSubmit={submitTop} className="space-y-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 1000))}
          placeholder="add your take…"
          className="min-h-16 w-full resize-y border-2 border-ink bg-white px-2 py-1.5 text-sm outline-none placeholder:text-ink/40"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs font-extrabold">
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="h-3.5 w-3.5 accent-ink" />
            Anonymous
          </label>
          <button
            type="submit"
            disabled={posting}
            className="border-2 border-ink bg-lime px-3 py-1 text-xs font-extrabold disabled:opacity-60"
          >
            {posting ? "…" : "Comment"}
          </button>
        </div>
      </form>

      {error ? <p className="mt-2 text-xs font-bold text-danger" role="alert">{error}</p> : null}

      {status === "loading" ? <p className="mt-3 font-note text-xl leading-none text-ink/70">loading…</p> : null}

      {status === "ready" && comments.length === 0 ? (
        <p className="mt-3 font-note text-xl leading-none text-ink/70">no comments yet — go first.</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {comments.map((comment) => (
          !hiddenAuthors.has(comment.author?.id) ? (
            <CommentItem key={comment.id} postId={post.id} comment={comment} onReplyAdded={onReplyAdded} viewerId={viewerId} onHideUser={hideAuthor} hiddenAuthors={hiddenAuthors} />
          ) : null
        ))}
      </div>

      {status === "ready" && cursor ? (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="mt-3 w-full border-2 border-ink bg-white px-3 py-1.5 text-xs font-extrabold disabled:opacity-60"
        >
          {loadingMore ? "…" : "Load more comments"}
        </button>
      ) : null}
    </div>
  );
}
