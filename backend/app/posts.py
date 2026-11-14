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
    image_urls = [f"/media/posts/{filename}" for filename in post.image_files]
    author = None if post.is_anonymous else _author_out(post.author)
    return PostOut(
        id=post.id,
        body=post.body,
        category=post.category,
        mood=post.mood,
        image_url=image_urls[0] if image_urls else None,
        image_urls=image_urls,
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


def comment_is_anonymous(post: Post, author_id: UUID, is_anonymous: bool) -> bool:
    return is_anonymous or (post.is_anonymous and author_id == post.author_id)


def comment_display_name(comment: Comment, aliases: dict[UUID, int], post: Post) -> str:
    if comment.deleted_at:
        return "Deleted comment"
    if comment_is_anonymous(post, comment.author_id, comment.is_anonymous):
        number = aliases.get(comment.author_id)
        return f"Anonymous #{number}" if number is not None else "Anonymous"
    return f"@{comment.author.username}"


def comment_to_public(
    comment: Comment,
    viewer_id: UUID | None,
    aliases: dict[UUID, int],
    post: Post,
    parent: Comment | None = None,
) -> CommentOut:
    deleted = comment.deleted_at is not None
    anonymous = comment_is_anonymous(post, comment.author_id, comment.is_anonymous)
    return CommentOut(
        id=comment.id,
        body="" if deleted else comment.body,
        is_anonymous=anonymous and not deleted,
        is_mine=not deleted and comment.author_id == viewer_id,
        is_op=not deleted and comment.author_id == post.author_id,
        author=None if deleted or anonymous else _author_out(comment.author),
        anonymous_number=aliases.get(comment.author_id) if anonymous and not deleted else None,
        reply_to=comment_display_name(parent, aliases, post) if parent else None,
        is_deleted=deleted,
        parent_id=comment.parent_id,
        created_at=comment.created_at,
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
        .where(Comment.post_id.in_(post_ids), Comment.deleted_at.is_(None))
        .group_by(Comment.post_id)
    ).all()
    return {post_id: count for post_id, count in rows}
