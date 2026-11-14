import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.activity import schedule_activity
from app.config import UPLOAD_DIR, settings
from app.leaderboard_live import router as leaderboard_live_router
from app.browser_push import router as browser_push_router
from app.notification_realtime import start_notification_listener, stop_notification_listener
from app.db import get_db
from app.limiter import limit
from app.models import (
    CommentHistory,
    Comment,
    CommentAnonymousIdentity,
    Notification,
    NotificationHistory,
    Post,
    StoryShare,
    PostHistory,
    Reaction,
    ReactionHistory,
    Report,
    ReportHistory,
    SameSkyAnalysis,
    SameSkyMatch,
    SameSkyProfile,
    SameSkyJob,
    User,
    UserBlock,
    UserMute,
)
from app.posts import (
    comment_counts_for,
    comment_is_anonymous,
    comment_to_public,
    my_reactions_for,
    post_to_public,
    reaction_counts_for,
)
from app.schemas import (
    AuthorOut,
    PublicProfileOut,
    CommentIn,
    CommentOut,
    CommentsOut,
    FeedOut,
    LeaderboardEntryOut,
    LeaderboardOut,
    NotificationOut,
    NotificationsOut,
    PostOut,
    ProfileIn,
    ReactionIn,
    StoryEditIn,
    ReportIn,
    SkinIn,
    SafetyUserOut,
    SafetyUsersOut,
    ThemeIn,
    UserOut,
)
from app.safety import hidden_author_ids, queue_notification, relationship_blocked
from app.security import (
    read_user_id,
)
from app.taxonomy import CATEGORIES, CATEGORY_SET, MOOD_KEYS, MOOD_SET, REACTION_SET
from app.users import find_by_email, find_by_username, remove_file, sniff_image, to_public
from app.same_sky_api import include_post_for_matching, router as same_sky_router
from app.admin_api import router as admin_router
from app.websocket import ws_endpoint_router
from app.chat import chat_router
from app.auth_api import router as auth_router
from app.same_sky_common import invalidate_matches, update_eligibility
from app.system_settings import default_theme

AVATAR_DIR = UPLOAD_DIR / "avatars"
POSTS_DIR = UPLOAD_DIR / "posts"
MAX_AVATAR_BYTES = 8_000_000
MAX_POST_IMAGE_BYTES = 2_000_000
MAX_POST_IMAGES = 4
MAX_POST_BODY = 1000
BALLOON_COLORS = {"pink", "purple", "lime", "coral", "blue", "yellow", "orange", "mint", "lavender"}
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
POSTS_DIR.mkdir(parents=True, exist_ok=True)


def archive_records(db: Session, history_model, rows: list, deleted_by: uuid.UUID) -> None:
    for row in rows:
        snapshot = {}
        for column in row.__table__.columns:
            value = getattr(row, column.name)
            if isinstance(value, (uuid.UUID, datetime, date)):
                value = value.isoformat() if isinstance(value, (datetime, date)) else str(value)
            snapshot[column.name] = value
        db.add(history_model(original_id=row.id, snapshot=snapshot, deleted_by=deleted_by))

app = FastAPI(title="FMLCore", version="0.9.0")
app.include_router(same_sky_router)
app.include_router(admin_router)
app.include_router(leaderboard_live_router)
app.include_router(browser_push_router)
app.include_router(chat_router)
app.include_router(auth_router)
app.include_router(ws_endpoint_router)

DAILY_PROMPTS = [
    "What's the plot twist today?",
    "What happened this time?",
    "What's living rent-free in your head?",
    "Tell us about a tiny thing that ruined your day.",
    "What's your most harmless, oddly specific ick?",
    "What did you think was normal until someone told you otherwise?",
    "What is a moment from this week you keep replaying?",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    if settings.is_production and settings.jwt_secret in {
        "dev-only-change-before-any-real-deploy",
        "replace-with-a-long-random-secret",
    }:
        raise RuntimeError("JWT_SECRET must be set to a unique value in production.")
    if settings.same_sky_embedding_dimensions != 768:
        raise RuntimeError("SAME_SKY_EMBEDDING_DIMENSIONS must be 768 until a matching vector-column migration is deployed.")
    if settings.is_production and settings.same_sky_ai_ready and not settings.same_sky_hash_secret:
        raise RuntimeError("SAME_SKY_HASH_SECRET must be set before processing private Same Sky entries.")


@app.on_event("startup")
async def start_live_notifications() -> None:
    await start_notification_listener(app)


@app.on_event("shutdown")
async def stop_live_notifications() -> None:
    await stop_notification_listener(app)


def current_user(request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)) -> User:
    user = db.get(User, read_user_id(request))
    if user is None:
        raise HTTPException(status_code=401, detail="Log in again.")
    schedule_activity(request, tasks, user.id)
    return user


def optional_user(request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)) -> User | None:
    try:
        user_id = read_user_id(request)
    except HTTPException:
        return None
    user = db.get(User, user_id)
    if user is not None:
        schedule_activity(request, tasks, user.id)
    return user


def single_post_out(db: Session, post: Post, user: User | None) -> PostOut:
    ids = [post.id]
    reactions = reaction_counts_for(db, ids).get(post.id, {})
    my_reaction = my_reactions_for(db, user.id if user else None, ids).get(post.id)
    comment_count = comment_counts_for(db, ids).get(post.id, 0)
    return post_to_public(post, reactions, my_reaction, comment_count)


def analyze_new_post_for_matching(db: Session, post: Post, user: User) -> None:
    """Queue analysis for every newly created feed post or confession."""
    include_post_for_matching(db, user, post)


def notification_to_public(notification: Notification) -> NotificationOut:
    actor = None
    match_notification = notification.kind.startswith("same_sky_")
    anonymous = notification.actor_anonymous or match_notification or (
        notification.kind in {"comment", "reply"}
        and notification.post is not None
        and notification.post.is_anonymous
        and notification.actor_id == notification.post.author_id
    )
    if notification.actor is not None and not anonymous:
        avatar = (
            f"/media/avatars/{notification.actor.avatar_file}"
            if notification.actor.avatar_file
            else None
        )
        actor = AuthorOut(
            id=notification.actor.id,
            username=notification.actor.username,
            avatar_url=avatar,
            profile_color=notification.actor.profile_color,
            profile_sticker=notification.actor.profile_sticker,
        )
    return NotificationOut(
        id=notification.id,
        kind=notification.kind,
        actor=actor,
        is_anonymous=anonymous,
        post_id=notification.post_id,
        comment_id=notification.comment_id,
        same_sky_match_id=notification.same_sky_match_id,
        is_read=notification.is_read,
        created_at=notification.created_at,
    )


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/platform/default-theme")
def get_platform_default_theme(db: Session = Depends(get_db)) -> dict:
    return {"theme": default_theme(db)}


@app.post("/auth/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("fml_session", path="/")
    return {"ok": True}


@app.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return to_public(user)


@app.get("/notifications", response_model=NotificationsOut)
def list_notifications(
    cursor: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    size = max(1, min(limit, 50))
    hidden = hidden_author_ids(db, user.id)
    stmt = (
        select(Notification)
        .options(joinedload(Notification.actor), joinedload(Notification.post))
        .where(Notification.recipient_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(size + 1)
    )
    if hidden:
        stmt = stmt.where(
            (Notification.actor_id.is_(None))
            | (~Notification.actor_id.in_(hidden))
        )
    if cursor:
        try:
            before_value, separator, before_id = cursor.partition("|")
            before = datetime.fromisoformat(before_value)
            cursor_id = uuid.UUID(before_id) if separator else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad cursor.")
        if cursor_id:
            stmt = stmt.where(
                (Notification.created_at < before)
                | ((Notification.created_at == before) & (Notification.id < cursor_id))
            )
        else:
            stmt = stmt.where(Notification.created_at < before)

    rows = db.scalars(stmt).all()
    has_more = len(rows) > size
    rows = rows[:size]
    next_cursor = (
        f"{rows[-1].created_at.isoformat()}|{rows[-1].id}"
        if has_more and rows
        else None
    )
    return NotificationsOut(
        notifications=[notification_to_public(item) for item in rows],
        next_cursor=next_cursor,
    )


@app.get("/notifications/unread-count")
def unread_notification_count(
    db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    hidden = hidden_author_ids(db, user.id)
    stmt = select(func.count()).select_from(Notification).where(
        Notification.recipient_id == user.id, Notification.is_read.is_(False)
    )
    if hidden:
        stmt = stmt.where(
            (Notification.actor_id.is_(None))
            | (~Notification.actor_id.in_(hidden))
        )
    return {"count": db.scalar(stmt) or 0}


@app.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "notification_read", max_hits=120, window_seconds=60)
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_id == user.id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=404, detail="That notification is gone.")
    notification.is_read = True
    db.commit()
    return {"ok": True}


@app.post("/notifications/read-all")
def mark_all_notifications_read(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "notification_read_all", max_hits=10, window_seconds=60)
    hidden = hidden_author_ids(db, user.id)
    stmt = select(Notification).where(
        Notification.recipient_id == user.id,
        Notification.is_read.is_(False),
    )
    if hidden:
        stmt = stmt.where(
            (Notification.actor_id.is_(None))
            | (~Notification.actor_id.in_(hidden))
        )
    for notification in db.scalars(stmt):
        notification.is_read = True
    db.commit()
    return {"ok": True}


def validate_safety_target(db: Session, target_id: uuid.UUID, user: User) -> User:
    target = db.get(User, target_id)
    if target is None:
        raise HTTPException(status_code=404, detail="That account is gone.")
    if target.id == user.id:
        raise HTTPException(status_code=422, detail="You cannot apply this to yourself.")
    return target


@app.get("/safety/blocks", response_model=SafetyUsersOut)
def list_blocks(db: Session = Depends(get_db), user: User = Depends(current_user)):
    users = db.scalars(
        select(User)
        .join(UserBlock, UserBlock.blocked_id == User.id)
        .where(UserBlock.blocker_id == user.id)
        .order_by(User.username_lower)
    ).all()
    return SafetyUsersOut(users=[SafetyUserOut(id=item.id, username=item.username) for item in users])


@app.get("/safety/mutes", response_model=SafetyUsersOut)
def list_mutes(db: Session = Depends(get_db), user: User = Depends(current_user)):
    users = db.scalars(
        select(User)
        .join(UserMute, UserMute.muted_id == User.id)
        .where(UserMute.muter_id == user.id)
        .order_by(User.username_lower)
    ).all()
    return SafetyUsersOut(users=[SafetyUserOut(id=item.id, username=item.username) for item in users])


@app.post("/safety/blocks/{target_id}")
def block_user(
    target_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "block", max_hits=30, window_seconds=3600)
    target = validate_safety_target(db, target_id, user)
    existing = db.scalar(
        select(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == target.id)
    )
    if existing is None:
        db.add(UserBlock(blocker_id=user.id, blocked_id=target.id))
        db.execute(update(SameSkyMatch).where(
            SameSkyMatch.status.in_(("pending", "connected")),
            ((SameSkyMatch.user_a_id == user.id) & (SameSkyMatch.user_b_id == target.id))
            | ((SameSkyMatch.user_a_id == target.id) & (SameSkyMatch.user_b_id == user.id)),
        ).values(
            status="blocked",
            shared_themes=[],
            similarity_score=0.0,
            safe_explanation="This connection was removed.",
            updated_at=datetime.now(timezone.utc),
        ))
        db.commit()
    return {"ok": True}


@app.delete("/safety/blocks/{target_id}")
def unblock_user(
    target_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "unblock", max_hits=60, window_seconds=3600)
    existing = db.scalar(
        select(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == target_id)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return {"ok": True}


@app.post("/safety/mutes/{target_id}")
def mute_user(
    target_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "mute", max_hits=60, window_seconds=3600)
    target = validate_safety_target(db, target_id, user)
    existing = db.scalar(
        select(UserMute).where(UserMute.muter_id == user.id, UserMute.muted_id == target.id)
    )
    if existing is None:
        db.add(UserMute(muter_id=user.id, muted_id=target.id))
        db.commit()
    return {"ok": True}


@app.delete("/safety/mutes/{target_id}")
def unmute_user(
    target_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "unmute", max_hits=60, window_seconds=3600)
    existing = db.scalar(
        select(UserMute).where(UserMute.muter_id == user.id, UserMute.muted_id == target_id)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return {"ok": True}


@app.post("/safety/reports", status_code=201)
def submit_report(
    body: ReportIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    limit(request, "report", max_hits=8, window_seconds=3600)
    if body.target_type == "post":
        target = db.get(Post, body.target_id)
        target_author = target.author_id if target else None
    elif body.target_type == "comment":
        target = db.get(Comment, body.target_id)
        if target and target.deleted_at:
            target = None
        target_author = target.author_id if target else None
    else:
        target = db.get(User, body.target_id)
        target_author = target.id if target else None
    if target is None:
        raise HTTPException(status_code=404, detail="That content is gone.")
    if target_author == user.id:
        raise HTTPException(status_code=422, detail="You cannot report your own content.")
    report = Report(
        reporter_id=user.id,
        target_type=body.target_type,
        target_id=body.target_id,
        reason=body.reason,
        details=body.details,
        status="pending",
    )
    db.add(report)
    db.commit()
    return {"ok": True, "status": report.status}


@app.get("/safety/reports/mine")
def list_my_reported_posts(db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    rows = db.execute(
        select(Report, Post)
        .join(Post, Report.target_id == Post.id)
        .where(Report.reporter_id == user.id, Report.target_type == "post")
        .order_by(Report.created_at.desc())
        .limit(50)
    ).all()
    return {"reports": [{"id": str(report.id), "status": report.status, "reason": report.reason,
        "reported_at": report.created_at.isoformat(), "post": {"id": str(post.id), "body": post.body,
        "category": post.category, "mood": post.mood, "is_anonymous": post.is_anonymous,
        "created_at": post.created_at.isoformat()}} for report, post in rows]}


def public_profile_user(db: Session, username: str, viewer: User | None) -> User:
    target = find_by_username(db, username)
    if target is None or (viewer and relationship_blocked(db, viewer.id, target.id)):
        raise HTTPException(status_code=404, detail="Profile not found.")
    return target


@app.get("/users/{username}", response_model=PublicProfileOut)
def public_profile(username: str, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    target = public_profile_user(db, username, user)
    return PublicProfileOut(username=target.username, bio=target.bio or "",
        avatar_url=f"/media/avatars/{target.avatar_file}" if target.avatar_file else None,
        profile_color=target.profile_color, profile_sticker=target.profile_sticker, joined_at=target.created_at)


@app.get("/users/{username}/posts", response_model=FeedOut)
def public_profile_posts(username: str, surface: str = "feed", cursor: str | None = None,
    limit: int = 20, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    target = public_profile_user(db, username, user)
    if surface not in {"feed", "confession"}:
        raise HTTPException(422, "Choose posts or confessions.")
    size = max(1, min(limit, 50))
    stmt = select(Post).options(joinedload(Post.author)).where(
        Post.author_id == target.id, Post.visibility == "public",
        Post.is_anonymous.is_(False), Post.surface == surface,
    ).order_by(Post.created_at.desc(), Post.id.desc()).limit(size + 1)
    if user and target.id in hidden_author_ids(db, user.id):
        return FeedOut(posts=[], next_cursor=None)
    if cursor:
        try:
            stamp, _, key = cursor.partition("|")
            before = datetime.fromisoformat(stamp)
            if before.tzinfo is None:
                raise ValueError()
            cursor_id = uuid.UUID(key)
        except ValueError:
            raise HTTPException(400, "Bad cursor.")
        stmt = stmt.where((Post.created_at < before) | ((Post.created_at == before) & (Post.id < cursor_id)))
    rows = db.scalars(stmt).all()
    more = len(rows) > size
    rows = rows[:size]
    ids = [p.id for p in rows]
    reactions = reaction_counts_for(db, ids)
    mine = my_reactions_for(db, user.id if user else None, ids)
    comments = comment_counts_for(db, ids)
    return FeedOut(posts=[post_to_public(p, reactions.get(p.id, {}), mine.get(p.id), comments.get(p.id, 0)) for p in rows],
        next_cursor=f"{rows[-1].created_at.isoformat()}|{rows[-1].id}" if more and rows else None)


@app.patch("/profile", response_model=UserOut)
def update_profile(
    body: ProfileIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "profile_update", max_hits=10, window_seconds=3600)
    taken = find_by_username(db, body.username)
    if taken is not None and taken.id != user.id:
        raise HTTPException(status_code=409, detail="That username is taken.")
    user.username = body.username
    user.username_lower = body.username.lower()
    user.bio = body.bio
    if body.profile_color is not None:
        user.profile_color = body.profile_color
    if body.profile_sticker is not None:
        user.profile_sticker = body.profile_sticker
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username is taken.")
    db.refresh(user)
    return to_public(user)


@app.patch("/profile/theme", response_model=UserOut)
def update_theme(
    body: ThemeIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "theme_update", max_hits=60, window_seconds=3600)
    user.theme = body.theme
    db.commit()
    db.refresh(user)
    return to_public(user)


@app.patch("/profile/skin", response_model=UserOut)
def update_skin(
    body: SkinIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Persist a person's Skin Studio choice without changing their palette."""
    limit(request, "skin_update", max_hits=60, window_seconds=3600)
    user.skin = body.skin
    db.commit()
    db.refresh(user)
    return to_public(user)


@app.post("/profile/avatar", response_model=UserOut)
async def upload_avatar(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    file: UploadFile = File(...),
):
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="That image is over 8 MB.")
    ext = sniff_image(data)
    if ext is None:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG, or WebP.")

    limit(request, "avatar_upload", max_hits=10, window_seconds=3600, actor_id=str(user.id))
    user = lock_avatar_owner(db, user.id)

    filename = f"{user.id}.{uuid.uuid4().hex}.{ext}"
    target = AVATAR_DIR / filename
    previous = user.avatar_file
    try:
        target.write_bytes(data)
        user.avatar_file = filename
        profile = to_public(user)
        db.commit()
    except Exception:
        remove_file(target)
        raise

    remove_avatar_file(profile.id, previous)
    return profile


def lock_avatar_owner(db: Session, user_id: uuid.UUID) -> User:
    user = db.scalar(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to change your photo.")
    return user


def remove_avatar_file(user_id: uuid.UUID, filename: str | None) -> None:
    if filename and filename.startswith(f"{user_id}.") and "/" not in filename:
        try:
            remove_file(AVATAR_DIR / filename)
        except OSError:
            logging.getLogger(__name__).warning("Could not remove the previous avatar", exc_info=True)


@app.post("/posts", response_model=PostOut)
async def create_post(
    request: Request,
    body: str = Form(...),
    category: str = Form(...),
    mood: str = Form(...),
    is_anonymous: bool = Form(False),
    file: UploadFile | None = File(None),
    images: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "post", max_hits=20, window_seconds=600)
    text = body.strip()
    if not 1 <= len(text) <= MAX_POST_BODY:
        raise HTTPException(status_code=422, detail=f"A post is 1 to {MAX_POST_BODY} characters.")
    if category not in CATEGORY_SET:
        raise HTTPException(status_code=422, detail="Pick a real category.")
    if mood not in MOOD_SET:
        raise HTTPException(status_code=422, detail="Pick a mood.")

    post = Post(
        id=uuid.uuid4(),
        author_id=user.id,
        body=text,
        category=category,
        mood=mood,
        is_anonymous=is_anonymous,
    )

    uploads = ([file] if file is not None else []) + (images or [])
    if len(uploads) > MAX_POST_IMAGES:
        raise HTTPException(status_code=422, detail=f"Pick up to {MAX_POST_IMAGES} images.")
    photos = []
    for upload in uploads:
        data = await upload.read(MAX_POST_IMAGE_BYTES + 1)
        if len(data) > MAX_POST_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="That image is over 2MB.")
        if data:
            ext = sniff_image(data)
            if ext is None:
                raise HTTPException(status_code=400, detail="Use a JPG, PNG, or WebP.")
            photos.append((f"{post.id}-{len(photos) + 1}.{ext}", data))
    if photos:
        post.image_file = photos[0][0]
        post.extra_image_files = [filename for filename, _ in photos[1:]]

    written = []
    try:
        for filename, data in photos:
            target = POSTS_DIR / filename
            written.append(target)
            target.write_bytes(data)
        db.add(post)
        db.flush()
        analyze_new_post_for_matching(db, post, user)
        db.commit()
    except Exception:
        for target in written:
            remove_file(target)
        raise
    db.refresh(post)
    return single_post_out(db, post, user)


@app.get("/posts", response_model=FeedOut)
def list_posts(
    cursor: str | None = None,
    limit: int = 20,
    category: str | None = None,
    mood: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    size = max(1, min(limit, 50))
    stmt = (
        select(Post)
        .options(joinedload(Post.author))
        .where(Post.surface == "feed", Post.visibility == "public")
        .order_by(Post.created_at.desc(), Post.id.desc())
        .limit(size + 1)
    )
    if category is not None:
        if category not in CATEGORY_SET:
            raise HTTPException(status_code=422, detail="Pick a real category.")
        stmt = stmt.where(Post.category == category)
    if mood is not None:
        if mood not in MOOD_SET:
            raise HTTPException(status_code=422, detail="Pick a real mood.")
        stmt = stmt.where(Post.mood == mood)
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden:
        stmt = stmt.where(Post.author_id.not_in(hidden))
    if cursor:
        try:
            before_value, separator, before_id = cursor.partition("|")
            before = datetime.fromisoformat(before_value)
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad cursor.")
        if separator:
            try:
                cursor_id = uuid.UUID(before_id)
            except ValueError:
                raise HTTPException(status_code=400, detail="Bad cursor.")
            stmt = stmt.where(
                (Post.created_at < before)
                | ((Post.created_at == before) & (Post.id < cursor_id))
            )
        else:
            stmt = stmt.where(Post.created_at < before)

    rows = db.scalars(stmt).all()
    has_more = len(rows) > size
    rows = rows[:size]
    next_cursor = (
        f"{rows[-1].created_at.isoformat()}|{rows[-1].id}"
        if has_more and rows
        else None
    )

    ids = [p.id for p in rows]
    reactions = reaction_counts_for(db, ids)
    mine = my_reactions_for(db, user.id if user else None, ids)
    comments = comment_counts_for(db, ids)
    posts = [
        post_to_public(p, reactions.get(p.id, {}), mine.get(p.id), comments.get(p.id, 0))
        for p in rows
    ]
    return FeedOut(posts=posts, next_cursor=next_cursor)


@app.post("/confessions", response_model=PostOut)
def create_confession(
    request: Request, body: str = Form(...), category: str = Form(...), mood: str = Form(...),
    balloon_color: str = Form("pink"), is_anonymous: bool = Form(True), visibility: str = Form("public"),
    db: Session = Depends(get_db), user: User = Depends(current_user),
):
    limit(request, "confession", max_hits=12, window_seconds=600)
    content = body.strip()
    if not 1 <= len(content) <= MAX_POST_BODY: raise HTTPException(status_code=422, detail=f"A confession is 1 to {MAX_POST_BODY} characters.")
    if category not in CATEGORY_SET or mood not in MOOD_SET: raise HTTPException(status_code=422, detail="Choose a valid category and mood.")
    if balloon_color not in BALLOON_COLORS: raise HTTPException(status_code=422, detail="Choose an available balloon colour.")
    if visibility not in {"public", "private"}: raise HTTPException(status_code=422, detail="Choose public or private visibility.")
    post = Post(id=uuid.uuid4(), author_id=user.id, body=content, category=category, mood=mood, is_anonymous=is_anonymous, surface="confession", visibility=visibility, balloon_color=balloon_color)
    db.add(post)
    db.flush()
    analyze_new_post_for_matching(db, post, user)
    db.commit()
    db.refresh(post)
    return single_post_out(db, post, user)


@app.get("/confessions", response_model=FeedOut)
def list_confessions(cursor: str | None = None, limit: int = 24, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    size = max(1, min(limit, 48)); hidden = hidden_author_ids(db, user.id if user else None)
    stmt = select(Post).options(joinedload(Post.author)).where(Post.surface == "confession", Post.visibility == "public").order_by(Post.created_at.desc(), Post.id.desc()).limit(size + 1)
    if hidden: stmt = stmt.where(Post.author_id.not_in(hidden))
    if cursor:
        try: before_value, _, before_id = cursor.partition("|"); before = datetime.fromisoformat(before_value); stmt = stmt.where((Post.created_at < before) | ((Post.created_at == before) & (Post.id < uuid.UUID(before_id))))
        except ValueError: raise HTTPException(status_code=400, detail="Bad cursor.")
    rows = db.scalars(stmt).all(); has_more = len(rows) > size; rows = rows[:size]; ids = [p.id for p in rows]
    return FeedOut(posts=[post_to_public(p, reaction_counts_for(db, ids).get(p.id, {}), my_reactions_for(db, user.id if user else None, ids).get(p.id), comment_counts_for(db, ids).get(p.id, 0)) for p in rows], next_cursor=f"{rows[-1].created_at.isoformat()}|{rows[-1].id}" if has_more and rows else None)


@app.get("/me/posts", response_model=FeedOut)
def my_posts(surface: str = "feed", limit: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if surface not in {"feed", "confession"}:
        raise HTTPException(status_code=422, detail="Choose feed or confession posts.")
    size = max(1, min(limit, 100))
    rows = db.scalars(select(Post).options(joinedload(Post.author)).where(Post.author_id == user.id, Post.surface == surface).order_by(Post.created_at.desc(), Post.id.desc()).limit(size)).all()
    ids = [p.id for p in rows]
    return FeedOut(posts=[post_to_public(p, reaction_counts_for(db, ids).get(p.id, {}), my_reactions_for(db, user.id, ids).get(p.id), comment_counts_for(db, ids).get(p.id, 0)) for p in rows], next_cursor=None)


@app.get("/confessions/random", response_model=PostOut | None)
def random_confession(db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    stmt = select(Post).options(joinedload(Post.author)).where(Post.surface == "confession", Post.visibility == "public")
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden: stmt = stmt.where(Post.author_id.not_in(hidden))
    post = db.scalars(stmt.order_by(func.random()).limit(1)).first()
    return single_post_out(db, post, user) if post else None


@app.post("/confessions/{post_id}/view", response_model=PostOut)
def view_confession(post_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    limit(request, "confession_view", max_hits=120, window_seconds=60)
    post = db.get(Post, post_id)
    if post is None or post.surface != "confession" or post.visibility != "public" or post.author_id in hidden_author_ids(db, user.id if user else None):
        raise HTTPException(status_code=404, detail="That confession is gone.")
    post.view_count += 1
    db.commit()
    return single_post_out(db, post, user)


@app.get("/explore/taxonomy")
def explore_taxonomy() -> dict:
    return {"categories": CATEGORIES, "moods": MOOD_KEYS}


@app.get("/explore/daily-prompt")
def daily_prompt() -> dict:
    today = datetime.now(timezone.utc).date()
    prompt = DAILY_PROMPTS[date.toordinal(today) % len(DAILY_PROMPTS)]
    return {"date": today.isoformat(), "prompt": prompt}


@app.get("/explore/random", response_model=PostOut | None)
def random_post(
    category: str | None = None,
    mood: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    stmt = select(Post).options(joinedload(Post.author))
    if category is not None:
        if category not in CATEGORY_SET:
            raise HTTPException(status_code=422, detail="Pick a real category.")
        stmt = stmt.where(Post.category == category)
    if mood is not None:
        if mood not in MOOD_SET:
            raise HTTPException(status_code=422, detail="Pick a real mood.")
        stmt = stmt.where(Post.mood == mood)
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden:
        stmt = stmt.where(Post.author_id.not_in(hidden))
    post = db.scalars(stmt.order_by(func.random()).limit(1)).first()
    return single_post_out(db, post, user) if post else None


@app.get("/explore/trending", response_model=list[PostOut])
def trending_posts(
    limit: int = 20,
    category: str | None = None,
    mood: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    size = max(1, min(limit, 50))
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    reaction_activity = (
        select(Reaction.post_id.label("post_id"), func.count().label("count"))
        .where(Reaction.created_at >= cutoff)
        .group_by(Reaction.post_id)
        .subquery()
    )
    comment_activity = (
        select(Comment.post_id.label("post_id"), func.count().label("count"))
        .where(Comment.created_at >= cutoff)
        .group_by(Comment.post_id)
        .subquery()
    )
    reactions = func.coalesce(reaction_activity.c.count, 0)
    comments = func.coalesce(comment_activity.c.count, 0)
    age_hours = func.extract("epoch", func.now() - Post.created_at) / 3600
    score = (reactions + comments * 2) / (1 + age_hours / 24)
    stmt = (
        select(Post)
        .options(joinedload(Post.author))
        .outerjoin(reaction_activity, reaction_activity.c.post_id == Post.id)
        .outerjoin(comment_activity, comment_activity.c.post_id == Post.id)
        .where(Post.created_at >= cutoff)
        .order_by(score.desc(), Post.created_at.desc(), Post.id.desc())
        .limit(size)
    )
    if category is not None:
        if category not in CATEGORY_SET:
            raise HTTPException(status_code=422, detail="Pick a real category.")
        stmt = stmt.where(Post.category == category)
    if mood is not None:
        if mood not in MOOD_SET:
            raise HTTPException(status_code=422, detail="Pick a real mood.")
        stmt = stmt.where(Post.mood == mood)
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden:
        stmt = stmt.where(Post.author_id.not_in(hidden))
    posts = db.scalars(stmt).all()
    ids = [post.id for post in posts]
    reaction_counts = reaction_counts_for(db, ids)
    mine = my_reactions_for(db, user.id if user else None, ids)
    comment_counts = comment_counts_for(db, ids)
    return [
        post_to_public(post, reaction_counts.get(post.id, {}), mine.get(post.id), comment_counts.get(post.id, 0))
        for post in posts
    ]


@app.get("/leaderboard", response_model=LeaderboardOut)
def leaderboard(
    limit: int = 5,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    size = max(1, min(limit, 20))
    start = max(0, min(offset, 10_000))
    week_start = datetime.now(timezone.utc) - timedelta(days=7)
    weekly_votes = (
        select(Reaction.post_id.label("post_id"), func.count().label("votes"))
        .where(Reaction.created_at >= week_start)
        .group_by(Reaction.post_id)
        .subquery()
    )
    stmt = (
        select(Post, weekly_votes.c.votes)
        .options(joinedload(Post.author))
        .join(weekly_votes, weekly_votes.c.post_id == Post.id)
        .where(Post.visibility == "public")
        .order_by(weekly_votes.c.votes.desc(), Post.created_at.desc(), Post.id.desc())
        .offset(start)
        .limit(size + 1)
    )
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden:
        stmt = stmt.where(Post.author_id.not_in(hidden))

    rows = db.execute(stmt).all()
    has_more = len(rows) > size
    rows = rows[:size]
    post_ids = [post.id for post, _votes in rows]
    reaction_counts = reaction_counts_for(db, post_ids)
    mine = my_reactions_for(db, user.id if user else None, post_ids)
    comment_counts = comment_counts_for(db, post_ids)
    entries = [
        LeaderboardEntryOut(
            rank=start + index + 1,
            weekly_votes=votes,
            post=post_to_public(
                post,
                reaction_counts.get(post.id, {}),
                mine.get(post.id),
                comment_counts.get(post.id, 0),
            ),
        )
        for index, (post, votes) in enumerate(rows)
    ]
    return LeaderboardOut(entries=entries, next_offset=start + size if has_more else None)


def post_is_visible(post: Post | None, viewer: User | None) -> bool:
    return post is not None and (post.visibility == "public" or (viewer is not None and viewer.id == post.author_id))


@app.get("/posts/{post_id}", response_model=PostOut)
def get_post(
    post_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    post = db.get(Post, post_id)
    if not post_is_visible(post, user) or post.author_id in hidden_author_ids(db, user.id if user else None):
        raise HTTPException(status_code=404, detail="That post is gone.")
    return single_post_out(db, post, user)


@app.post("/posts/{post_id}/share")
def record_post_share(
    post_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> dict:
    limit(request, "story_share", max_hits=30, window_seconds=60)
    stmt = select(Post).where(Post.id == post_id, Post.visibility == "public")
    hidden = hidden_author_ids(db, user.id if user else None)
    if hidden:
        stmt = stmt.where(Post.author_id.not_in(hidden))
    post = db.scalar(stmt.with_for_update() if user else stmt)
    if post is None:
        raise HTTPException(404, "That post is gone.")
    if user:
        new_share = db.scalar(
            insert(StoryShare).values(post_id=post_id, user_id=user.id)
            .on_conflict_do_nothing(index_elements=["post_id", "user_id"])
            .returning(StoryShare.post_id)
        )
        if new_share is not None:
            post.share_count += 1
        count = post.share_count
        db.commit()
        return {"share_count": count}
    return {"share_count": post.share_count}


@app.patch("/posts/{post_id}", response_model=PostOut)
def edit_post(
    post_id: uuid.UUID,
    body: StoryEditIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "post_edit", max_hits=30, window_seconds=600)
    post = db.scalar(select(Post).where(Post.id == post_id, Post.author_id == user.id).with_for_update())
    if post is None:
        raise HTTPException(404, "That post is gone.")
    content = body.body.strip()
    if not 1 <= len(content) <= MAX_POST_BODY:
        raise HTTPException(422, "A story must be between 1 and 1,000 characters.")
    if post.body != content:
        post.body = content
        if db.get(SameSkyAnalysis, post.id) is not None:
            include_post_for_matching(db, user, post)
        db.commit()
    return single_post_out(db, post, user)


@app.delete("/posts/{post_id}")
def delete_post(post_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    limit(request, "post_delete", max_hits=20, window_seconds=600)
    post = db.scalar(select(Post).where(Post.id == post_id).with_for_update())
    if post is None or post.author_id != user.id:
        raise HTTPException(status_code=404, detail="That post is gone.")
    selected_for_matching = db.scalar(select(SameSkyAnalysis.post_id).where(
        SameSkyAnalysis.post_id == post.id,
        SameSkyAnalysis.user_id == user.id,
    )) is not None
    same_sky_profile = None
    if selected_for_matching:
        same_sky_profile = db.scalar(select(SameSkyProfile).where(SameSkyProfile.user_id == user.id).with_for_update())
    comments = list(db.scalars(select(Comment).where(Comment.post_id == post.id)))
    comment_ids = [comment.id for comment in comments]
    reactions = list(db.scalars(select(Reaction).where(Reaction.post_id == post.id)))
    notification_stmt = select(Notification).where(Notification.post_id == post.id)
    if comment_ids:
        notification_stmt = select(Notification).where((Notification.post_id == post.id) | Notification.comment_id.in_(comment_ids))
    notifications = list(db.scalars(notification_stmt))
    report_stmt = select(Report).where(Report.target_id == post.id, Report.target_type == "post")
    reports = list(db.scalars(report_stmt))
    if comment_ids:
        reports.extend(db.scalars(select(Report).where(Report.target_type == "comment", Report.target_id.in_(comment_ids))).all())
    archive_records(db, PostHistory, [post], user.id)
    archive_records(db, CommentHistory, [item for item in comments if not item.deleted_at], user.id)
    archive_records(db, ReactionHistory, reactions, user.id)
    archive_records(db, NotificationHistory, notifications, user.id)
    archive_records(db, ReportHistory, reports, user.id)
    db.execute(delete(SameSkyJob).where(
        SameSkyJob.job_type == "analyze_post",
        SameSkyJob.payload["post_id"].as_string() == str(post.id),
        SameSkyJob.status == "queued",
    ))
    db.execute(delete(Notification).where(Notification.id.in_([item.id for item in notifications])))
    db.execute(delete(Comment).where(Comment.id.in_([item.id for item in comments])))
    db.execute(delete(Reaction).where(Reaction.id.in_([item.id for item in reactions])))
    db.execute(delete(Report).where(Report.id.in_([item.id for item in reports])))
    image_files = post.image_files
    db.delete(post)
    db.flush()
    if same_sky_profile is not None:
        update_eligibility(db, same_sky_profile)
        invalidate_matches(db, user.id)
    db.commit()
    for image_file in image_files:
        remove_file(POSTS_DIR / image_file)
    return {"ok": True}


@app.put("/posts/{post_id}/reaction", response_model=PostOut)
def set_reaction(
    post_id: uuid.UUID,
    body: ReactionIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "reaction", max_hits=60, window_seconds=60)
    if body.type not in REACTION_SET:
        raise HTTPException(status_code=422, detail="That is not a reaction.")
    post = db.get(Post, post_id)
    if not post_is_visible(post, user) or post.author_id in hidden_author_ids(db, user.id):
        raise HTTPException(status_code=404, detail="That post is gone.")

    existing = db.scalar(
        select(Reaction).where(Reaction.post_id == post_id, Reaction.user_id == user.id)
    )
    if existing is not None:
        if existing.type != body.type:
            existing.type = body.type
            existing.created_at = datetime.now(timezone.utc)
    else:
        db.add(Reaction(id=uuid.uuid4(), post_id=post_id, user_id=user.id, type=body.type))
        queue_notification(
            db,
            recipient_id=post.author_id,
            actor_id=user.id,
            kind="reaction",
            post_id=post.id,
        )
    db.commit()
    return single_post_out(db, post, user)


@app.delete("/posts/{post_id}/reaction", response_model=PostOut)
def remove_reaction(
    post_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "reaction_remove", max_hits=60, window_seconds=60)
    post = db.get(Post, post_id)
    if not post_is_visible(post, user) or post.author_id in hidden_author_ids(db, user.id):
        raise HTTPException(status_code=404, detail="That post is gone.")
    existing = db.scalar(
        select(Reaction).where(Reaction.post_id == post_id, Reaction.user_id == user.id)
    )
    if existing is not None:
        db.delete(existing)
        db.commit()
    return single_post_out(db, post, user)


def comment_aliases(db: Session, post_id: uuid.UUID) -> dict[uuid.UUID, int]:
    return dict(db.execute(
        select(CommentAnonymousIdentity.user_id, CommentAnonymousIdentity.number)
        .where(CommentAnonymousIdentity.post_id == post_id)
    ).all())


@app.get("/posts/{post_id}/comments", response_model=CommentsOut)
def list_comments(
    post_id: uuid.UUID,
    cursor: str | None = None,
    limit: int = 20,
    focus: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
):
    post = db.get(Post, post_id)
    viewer_id = user.id if user else None
    hidden = hidden_author_ids(db, viewer_id)
    if not post_is_visible(post, user) or post.author_id in hidden:
        raise HTTPException(status_code=404, detail="That post is gone.")
    size = max(1, min(limit, 50))
    results = db.execute(
        select(Comment, CommentAnonymousIdentity.number)
        .options(joinedload(Comment.author))
        .outerjoin(CommentAnonymousIdentity, (
            (CommentAnonymousIdentity.post_id == Comment.post_id)
            & (CommentAnonymousIdentity.user_id == Comment.author_id)
        ))
        .where(Comment.post_id == post_id)
        .order_by(Comment.created_at, Comment.id)
    ).all()
    rows = [row for row, _ in results]
    aliases = {row.author_id: number for row, number in results if number is not None}
    by_id = {row.id: row for row in rows}
    children: dict[uuid.UUID | None, list[Comment]] = {}
    for row in rows:
        if row.author_id not in hidden or row.deleted_at:
            children.setdefault(row.parent_id, []).append(row)

    # Keep deleted nodes only where they connect readers to a visible reply.
    threads = {}
    for root in reversed(children.get(None, [])):
        stack = [(root, False)]
        visible = set()
        ordered = []
        while stack:
            row, visited = stack.pop()
            if not visited:
                ordered.append(row)
                stack.append((row, True))
                stack.extend((child, False) for child in reversed(children.get(row.id, [])))
            elif not row.deleted_at or any(child.id in visible for child in children.get(row.id, [])):
                visible.add(row.id)
        if root.id in visible:
            threads[root.id] = [row for row in ordered if row.id in visible]

    roots = [by_id[root_id] for root_id in threads]
    if cursor:
        try:
            stamp, separator, row_id = cursor.partition("|")
            before = datetime.fromisoformat(stamp)
            if before.tzinfo is None:
                before = before.replace(tzinfo=timezone.utc)
            if separator:
                boundary = (before, uuid.UUID(row_id))
                roots = [row for row in roots if (row.created_at, row.id) < boundary]
            else:
                roots = [row for row in roots if row.created_at < before]
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad cursor.")
    page = roots[:size]
    next_cursor = f"{page[-1].created_at.isoformat()}|{page[-1].id}" if len(roots) > size else None
    if focus and not cursor:
        focused = next((rows[0] for rows in threads.values() if any(row.id == focus for row in rows)), None)
        if focused and focused not in page:
            page.insert(0, focused)

    comments = []
    for root in page:
        public = comment_to_public(root, viewer_id, aliases, post)
        # Depth-first descendants with parent IDs avoid a nested JSON depth limit.
        public.replies = [
            comment_to_public(row, viewer_id, aliases, post, by_id[row.parent_id])
            for row in threads[root.id][1:]
        ]
        comments.append(public)
    return CommentsOut(
        comments=comments,
        next_cursor=next_cursor,
        comment_count=sum(row.deleted_at is None for row in rows),
    )


@app.delete("/comments/{comment_id}")
def delete_comment(comment_id: uuid.UUID, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    limit(request, "comment_delete", max_hits=30, window_seconds=600)
    comment = db.get(Comment, comment_id)
    if comment is None or comment.author_id != user.id:
        raise HTTPException(status_code=404, detail="That comment is gone.")
    post = db.scalar(select(Post).where(Post.id == comment.post_id).with_for_update())
    if post is None:
        raise HTTPException(status_code=404, detail="That comment is gone.")
    db.refresh(comment)
    if comment.deleted_at:
        return {"ok": True}

    notifications = list(db.scalars(select(Notification).where(Notification.comment_id == comment.id)))
    reports = list(db.scalars(select(Report).where(Report.target_type == "comment", Report.target_id == comment.id)))
    archive_records(db, CommentHistory, [comment], user.id)
    archive_records(db, NotificationHistory, notifications, user.id)
    archive_records(db, ReportHistory, reports, user.id)
    db.execute(delete(Notification).where(Notification.comment_id == comment.id))
    db.execute(delete(Report).where(Report.target_type == "comment", Report.target_id == comment.id))
    comment.deleted_at = datetime.now(timezone.utc)
    comment.body = ""
    db.commit()
    return {"ok": True}


@app.post("/posts/{post_id}/comments", response_model=CommentOut)
def add_comment(
    post_id: uuid.UUID,
    body: CommentIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    limit(request, "comment", max_hits=30, window_seconds=600)
    post = db.scalar(select(Post).where(Post.id == post_id).with_for_update())
    hidden = hidden_author_ids(db, user.id)
    if not post_is_visible(post, user) or post.author_id in hidden or relationship_blocked(db, post.author_id, user.id):
        raise HTTPException(status_code=404, detail="That post is gone.")
    text = body.body.strip()
    if not 1 <= len(text) <= MAX_POST_BODY:
        raise HTTPException(status_code=422, detail=f"A comment is 1 to {MAX_POST_BODY} characters.")

    parent = db.get(Comment, body.parent_id) if body.parent_id else None
    if body.parent_id and (parent is None or parent.deleted_at):
        raise HTTPException(status_code=404, detail="That comment is gone.")
    ancestor = parent
    while ancestor is not None:
        if ancestor.post_id != post_id or (not ancestor.deleted_at and ancestor.author_id in hidden):
            raise HTTPException(status_code=404, detail="That comment is gone.")
        ancestor = db.get(Comment, ancestor.parent_id) if ancestor.parent_id else None

    aliases = comment_aliases(db, post_id)
    anonymous = comment_is_anonymous(post, user.id, body.is_anonymous)
    if anonymous and user.id not in aliases:
        number = max(aliases.values(), default=0) + 1
        db.add(CommentAnonymousIdentity(post_id=post_id, user_id=user.id, number=number))
        aliases[user.id] = number

    comment = Comment(
        id=uuid.uuid4(),
        post_id=post_id,
        author_id=user.id,
        parent_id=body.parent_id,
        body=text,
        is_anonymous=anonymous,
    )
    db.add(comment)
    recipient_id = parent.author_id if parent is not None else post.author_id
    queue_notification(
        db,
        recipient_id=recipient_id,
        actor_id=user.id,
        kind="reply" if parent is not None else "comment",
        post_id=post.id,
        comment_id=comment.id,
        actor_anonymous=comment.is_anonymous,
    )
    db.commit()
    db.refresh(comment)
    return comment_to_public(comment, user.id, aliases, post, parent)


app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
