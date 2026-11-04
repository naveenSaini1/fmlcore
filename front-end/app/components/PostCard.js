"use client";

import { useState } from "react";
import { mediaUrl } from "../../lib/api";
import { categoryAccent, moodByKey } from "../../lib/taxonomy";
import { timeAgo } from "../../lib/format";
import { profileColor, profileSticker } from "../../lib/profile-style";
import ReactionBar from "./ReactionBar";
import Comments from "./Comments";
import { ReportAction, UserSafetyActions } from "./SafetyActions";

export default function PostCard({ post: initial, index = 0, preview = false, viewerId = null }) {
  const [livePost, setLivePost] = useState(initial);
  const [showComments, setShowComments] = useState(false);
  const [hiddenBySafety, setHiddenBySafety] = useState(false);
  // In preview mode the parent re-renders with fresh props each keystroke,
  // so read straight from the prop; otherwise use the card's own state.
  const post = preview ? initial : livePost;

  if (hiddenBySafety) {
    return <p className="border-2 border-dashed border-ink bg-paper p-3 text-sm font-bold">You muted or blocked this account. Its stories are hidden.</p>;
  }

  const mood = moodByKey(post.mood);
  const accent = categoryAccent(post.category);
  const avatar = post.author ? mediaUrl(post.author.avatar_url) : null;
  const image = mediaUrl(post.image_url);
  const tilt = preview ? "" : index % 3 === 0 ? "-rotate-1" : index % 3 === 1 ? "rotate-1" : "";
  const shadow = preview ? "shadow-[6px_6px_0_var(--color-shadow)]" : "shadow-[8px_8px_0_var(--color-shadow)]";

  return (
    <article className={`border-4 border-ink bg-white p-5 ${shadow} ${tilt}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
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
            <span className="inline-flex items-center gap-1 border border-ink px-1.5 py-0.5 font-display text-sm font-extrabold text-on-brand" style={{ backgroundColor: profileColor(post.author?.profile_color) }}>
              @{post.author?.username ?? "someone"} <span aria-hidden>{profileSticker(post.author?.profile_sticker)}</span>
            </span>
          )}
        </div>
        <span className="font-note text-xl leading-none text-ink/70">{timeAgo(post.created_at)}</span>
      </div>

      <span
        className="mt-4 inline-block -rotate-1 border-2 border-ink px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-on-brand"
        style={{ backgroundColor: accent }}
      >
        {post.category}
      </span>

      <p className="mt-3 whitespace-pre-wrap break-words text-lg font-semibold leading-snug">
        {post.body}
      </p>

      {image ? (
        <img
          src={image}
          alt=""
          className="mt-4 max-h-96 w-full border-4 border-ink object-cover"
        />
      ) : null}

      <div className="mt-4 inline-flex items-center gap-2 border-2 border-ink bg-paper px-2 py-1">
        <span className="text-lg leading-none" aria-hidden>
          {mood.emoji}
        </span>
        <span className="text-xs font-extrabold lowercase">{mood.label}</span>
      </div>

      {!preview ? (
        <div className="mt-4 border-t-2 border-dashed border-ink/40 pt-4">
          <ReactionBar post={post} onChange={setLivePost} />
          <button
            type="button"
            onClick={() => setShowComments((v) => !v)}
            className="mt-3 text-sm font-extrabold underline"
          >
            {showComments ? "hide comments" : `comments (${post.comment_count})`}
          </button>
          {showComments ? (
            <Comments
              post={post}
              viewerId={viewerId}
              onCountChange={(delta) =>
                setLivePost((p) => ({ ...p, comment_count: p.comment_count + delta }))
              }
            />
          ) : null}
          {viewerId && (!post.author || post.author.id !== viewerId) ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-extrabold underline">Safety options</summary>
              <ReportAction targetType="post" targetId={post.id} />
              {post.author && post.author.id !== viewerId ? (
                <UserSafetyActions target={post.author} onHide={() => setHiddenBySafety(true)} />
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
