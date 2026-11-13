from collections import defaultdict
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Comment, Post, Reaction, User
from app.schemas import AuthorOut, CommentOut, PostOut


def _author_out(user: User | None) -> AuthorOut | None:
    if user is None:
        return None
    avatar_url = f"/media/avatars/{user.avatar_file}" if user.avatar_file else None
    return AuthorOut(
        id=user.id,
        username=user.username,
        avatar_url=avatar_url,
        profile_color=user.profile_color,
        profile_sticker=user.profile_sticker,
    )


def post_to_public(
    post: Post,
    reactions: dict[str, int] | None = None,
    my_reaction: str | None = None,
    comment_count: int = 0,
) -> PostOut:
    reactions = reactions or {}
    image_url = f"/media/posts/{post.image_file}" if post.image_file else None
    author = None if post.is_anonymous else _author_out(post.author)
    return PostOut(
        id=post.id,
        body=post.body,
        category=post.category,
        mood=post.mood,
        image_url=image_url,
        is_anonymous=post.is_anonymous,
        surface=post.surface,
        visibility=post.visibility,
        balloon_color=post.balloon_color,
        share_count=post.share_count,
        view_count=post.view_count,
        author=author,
        reactions=reactions,
        reaction_count=sum(reactions.values()),
        my_reaction=my_reaction,
        comment_count=comment_count,
        created_at=post.created_at,
    )


def comment_to_public(comment: Comment, replies: list[Comment] | None = None, viewer_id: UUID | None = None) -> CommentOut:
    author = None if comment.is_anonymous else _author_out(comment.author)
    return CommentOut(
        id=comment.id,
        body=comment.body,
        is_anonymous=comment.is_anonymous,
        is_mine=viewer_id is not None and comment.author_id == viewer_id,
        author=author,
        parent_id=comment.parent_id,
        created_at=comment.created_at,
        replies=[comment_to_public(r, viewer_id=viewer_id) for r in (replies or [])],
    )


def reaction_counts_for(db: Session, post_ids: list[UUID]) -> dict[UUID, dict[str, int]]:
    result: dict[UUID, dict[str, int]] = defaultdict(dict)
    if not post_ids:
        return result
    rows = db.execute(
        select(Reaction.post_id, Reaction.type, func.count())
        .where(Reaction.post_id.in_(post_ids))
        .group_by(Reaction.post_id, Reaction.type)
    ).all()
    for post_id, rtype, count in rows:
        result[post_id][rtype] = count
    return result


def my_reactions_for(db: Session, user_id: UUID | None, post_ids: list[UUID]) -> dict[UUID, str]:
    if not user_id or not post_ids:
        return {}
    rows = db.execute(
        select(Reaction.post_id, Reaction.type).where(
            Reaction.user_id == user_id, Reaction.post_id.in_(post_ids)
        )
    ).all()
    return {post_id: rtype for post_id, rtype in rows}


def comment_counts_for(db: Session, post_ids: list[UUID]) -> dict[UUID, int]:
    if not post_ids:
        return {}
    rows = db.execute(
        select(Comment.post_id, func.count())
        .where(Comment.post_id.in_(post_ids))
        .group_by(Comment.post_id)
    ).all()
    return {post_id: count for post_id, count in rows}
