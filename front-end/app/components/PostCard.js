"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { mediaUrl } from "../../lib/api";
import { categoryAccent, moodByKey } from "../../lib/taxonomy";
import { timeAgo } from "../../lib/format";
import { profileColor, profileSticker } from "../../lib/profile-style";
import ReactionBar from "./ReactionBar";
import Comments from "./Comments";
import ShareStory from "./ShareStory";
import EditStory from "./EditStory";
import { ReportAction, UserSafetyActions } from "./SafetyActions";

export default function PostCard({ post: initial, index = 0, preview = false, viewerId = null, onEdit, showSafety = true, onDelete, deleting = false, focusComment = null }) {
  const [livePost, setLivePost] = useState(initial);
  useEffect(() => setLivePost(initial), [initial]);
  const [showComments, setShowComments] = useState(Boolean(focusComment));
  const panelId = useId();
  const [editing, setEditing] = useState(false);
  const [hiddenBySafety, setHiddenBySafety] = useState(false);
  // In preview mode the parent re-renders with fresh props each keystroke,
  // so read straight from the prop; otherwise use the card's own state.
  const post = preview ? initial : livePost;

  if (hiddenBySafety) {
    return <p className="border-2 border-dashed border-ink bg-paper p-3 text-sm font-bold">You muted or blocked this account. Its stories are hidden.</p>;
  }

  const AuthorTag = !preview && !post.is_anonymous && post.author?.username ? Link : "div";
  const mood = moodByKey(post.mood);
  const accent = categoryAccent(post.category);
  const avatar = post.author ? mediaUrl(post.author.avatar_url) : null;
  const image = mediaUrl(post.image_url);
  const tilt = preview ? "" : index % 3 === 0 ? "-rotate-1" : index % 3 === 1 ? "rotate-1" : "";
  const shadow = preview ? "shadow-[6px_6px_0_var(--color-shadow)]" : "shadow-[8px_8px_0_var(--color-shadow)]";

  return (
    <article
      data-card-layout={index % 4}
      data-preview={preview ? "true" : undefined}
      className={`post-card post-card--${index % 4} border-4 border-ink bg-white p-5 ${shadow} ${tilt}`}
    >
      <div className="post-byline flex items-center justify-between gap-3">
        <AuthorTag {...(AuthorTag === Link ? { href: `/users/${encodeURIComponent(post.author.username)}`, "aria-label": `View @${post.author.username} profile` } : {})} className="post-author flex items-center gap-2">
          {post.is_anonymous ? (
            <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-ink text-lg text-on-ink">
              ?
            </span>
          ) : avatar ? (
            <img src={avatar} alt="" className="h-9 w-9 border-2 border-ink object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center border-2 border-ink bg-paper">
              <img src="/image/user.png" alt="" className="h-5 w-5 object-contain" />
            </span>
          )}
          {post.is_anonymous ? (
            <span className="font-display text-sm font-extrabold">Anonymous</span>
          ) : (
            <span className="post-author-name inline-flex items-center gap-1 border border-ink px-1.5 py-0.5 font-display text-sm font-extrabold text-on-brand" style={{ backgroundColor: profileColor(post.author?.profile_color) }}>
              <span className="post-handle">@{post.author?.username ?? "someone"}</span> <span aria-hidden>{profileSticker(post.author?.profile_sticker)}</span>
            </span>
          )}
        </AuthorTag>
        <span className="post-time font-note text-xl leading-none text-ink/70">{timeAgo(post.created_at)}</span>
        <div className="post-card-menu">{!preview && (onDelete || (viewerId && (!post.author || post.author.id !== viewerId))) ? <details className="post-actions"><summary aria-label="Post actions" title="Post actions">•••</summary><div className="post-actions-menu">{onDelete ? <>{onEdit && <button type="button" onClick={event => { event.currentTarget.closest("details").open = false; setEditing(true); }} className="block w-full border-2 border-ink bg-white px-2 py-1 text-left text-xs font-extrabold">Edit {post.surface === "confession" ? "confession" : "post"}</button>}<button type="button" disabled={deleting} onClick={onDelete} className="block w-full border-2 border-ink bg-coral px-2 py-1 text-left text-xs font-extrabold">{deleting ? "Deleting…" : "Delete post"}</button></> : <><ReportAction targetType="post" targetId={post.id} />{post.author ? <UserSafetyActions target={post.author} onHide={() => setHiddenBySafety(true)} /> : null}</>}</div></details> : null}</div>
      </div>

      <div className="post-context">
        <span
          className="post-category inline-block -rotate-1 border-2 border-ink px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-on-brand"
          style={{ backgroundColor: accent }}
        >
          {post.category}
        </span>
        <div className="post-mood inline-flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1">
          <span className="text-lg leading-none" aria-hidden>{mood.emoji}</span>
          <span className="text-xs font-extrabold lowercase">{mood.label}</span>
        </div>
      </div>

      {editing ? <EditStory post={post} onCancel={() => setEditing(false)} onSave={updated => { setLivePost(updated); onEdit(updated); setEditing(false); }} /> : <p className="post-body mt-3 whitespace-pre-wrap break-words text-lg font-semibold leading-snug">
        {post.body}
      </p>}

      {image ? (
        <img
          src={image}
          alt=""
          className="post-image mt-4 max-h-96 w-full border-4 border-ink object-cover"
        />
      ) : null}



      {!preview ? (
        <div className="post-interactions mt-4 border-t-2 border-dashed border-ink/40 pt-4">
          <ReactionBar post={post} onChange={setLivePost} />
          <div className="post-engagement">
            <button
              type="button"
              onClick={() => setShowComments(open => !open)}
              aria-expanded={showComments}
              aria-controls={panelId}
              aria-label={`${showComments ? "Hide" : "Show"} comments (${post.comment_count})`}
              className="post-engagement-button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.7-3.4A8.5 8.5 0 1 1 21 11.5Z" />
              </svg>
              <span aria-hidden="true">{post.comment_count}</span>
            </button>
            {post.visibility === "public" && <ShareStory post={post} onCount={share_count => setLivePost(current => ({ ...current, share_count }))} />}
          </div>
          <div id={panelId} hidden={!showComments}>
            {showComments && <Comments
              post={post}
              focusComment={focusComment}
              viewerId={viewerId}
              onCountChange={(delta) =>
                setLivePost((p) => ({ ...p, comment_count: p.comment_count + delta }))
              }
            />}
          </div>
        </div>
      ) : null}
    </article>
  );
}
