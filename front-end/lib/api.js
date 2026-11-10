const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export function mediaUrl(path) {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return `${API_URL}${path}`;
}

function errorMessage(data) {
  if (!data) return "Something broke. Try again.";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail) && data.detail[0]?.msg) {
    return data.detail[0].msg.replace(/^Value error,\s*/i, "");
  }
  return "Something broke. Try again.";
}

export async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
    credentials: "include",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(errorMessage(data));
  }
  return data;
}

export function getMe() {
  return api("/auth/me");
}

export function getPlatformDefaultTheme() {
  return api("/platform/default-theme");
}

export function signup(body) {
  return api("/auth/signup", { method: "POST", body: JSON.stringify(body) });
}

export function login(body) {
  return api("/auth/login", { method: "POST", body: JSON.stringify(body) });
}

export function logout() {
  return api("/auth/logout", { method: "POST" });
}

export function updateProfile(body) {
  return api("/profile", { method: "PATCH", body: JSON.stringify(body) });
}

export function updateTheme(theme) {
  return api("/profile/theme", { method: "PATCH", body: JSON.stringify({ theme }) });
}

export function updateSkin(skin) {
  return api("/profile/skin", { method: "PATCH", body: JSON.stringify({ skin }) });
}

export function uploadAvatar(file) {
  const body = new FormData();
  body.append("file", file);
  return api("/profile/avatar", { method: "POST", body });
}

export function getFeed(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api(`/posts${query}`);
}

export function getConfessions(cursor) {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  return api(`/confessions?${params.toString()}`);
}

export function getRandomConfession() { return api("/confessions/random"); }
export function viewConfession(id) { return api(`/confessions/${id}/view`, { method: "POST" }); }

export function createConfession({ body, category, mood, isAnonymous, visibility, balloonColor }) {
  const form = new FormData();
  form.append("body", body); form.append("category", category); form.append("mood", mood);
  form.append("is_anonymous", String(isAnonymous)); form.append("visibility", visibility); form.append("balloon_color", balloonColor);
  return api("/confessions", { method: "POST", body: form });
}

function exploreQuery({ category, mood, cursor } = {}) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (mood) params.set("mood", mood);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getExploreTaxonomy() {
  return api("/explore/taxonomy");
}

export function getDailyPrompt() {
  return api("/explore/daily-prompt");
}

export function getTrending({ category, mood } = {}) {
  return api(`/explore/trending${exploreQuery({ category, mood })}`);
}

export function getRandomPost({ category, mood } = {}) {
  return api(`/explore/random${exploreQuery({ category, mood })}`);
}

export function getExplorePosts({ category, mood, cursor } = {}) {
  return api(`/posts${exploreQuery({ category, mood, cursor })}`);
}

export function getUnreadCount() {
  return api("/notifications/unread-count");
}

export function getNotifications(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api(`/notifications${query}`);
}

export function markNotificationRead(id) {
  return api(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return api("/notifications/read-all", { method: "POST" });
}

export function getSafetyLists() {
  return Promise.all([api("/safety/blocks"), api("/safety/mutes")]).then(([blocks, mutes]) => ({
    blocks: blocks.users,
    mutes: mutes.users,
  }));
}

export function getLeaderboard({ limit = 5, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return api(`/leaderboard?${params.toString()}`);
}

export function setBlock(userId, blocked = true) {
  return api(`/safety/blocks/${userId}`, { method: blocked ? "POST" : "DELETE" });
}

export function setMute(userId, muted = true) {
  return api(`/safety/mutes/${userId}`, { method: muted ? "POST" : "DELETE" });
}

export function reportContent({ targetType, targetId, reason, details }) {
  return api("/safety/reports", {
    method: "POST",
    body: JSON.stringify({ target_type: targetType, target_id: targetId, reason, details }),
  });
}

export function getMyReportedPosts() { return api("/safety/reports/mine"); }
export function getMyPosts(surface = "feed", limit = 100) { return api(`/me/posts?surface=${encodeURIComponent(surface)}&limit=${limit}`); }
export function deletePost(id) { return api(`/posts/${id}`, { method: "DELETE" }); }
export function deleteComment(id) { return api(`/comments/${id}`, { method: "DELETE" }); }

export function getSameSky() { return api("/same-sky"); }
export function includePostInSameSky(id) { return api(`/same-sky/posts/${id}/include`, { method: "POST" }); }
export function excludePostFromSameSky(id) { return api(`/same-sky/posts/${id}/include`, { method: "DELETE" }); }
export function updateSameSkyProfile(body) { return api("/same-sky/profile", { method: "PATCH", body: JSON.stringify(body) }); }
export function retrySameSkyPost(id) { return api(`/same-sky/posts/${id}/retry`, { method: "POST" }); }
export function startSameSkyAttempt() { return api("/same-sky/attempts", { method: "POST" }); }
export function getSameSkyAttempt(id) { return api(`/same-sky/attempts/${id}`); }
export function respondToSameSkyMatch(id, accept) { return api(`/same-sky/matches/${id}/response`, { method: "POST", body: JSON.stringify({ accept }) }); }
export function reopenSameSkyMatch(id) { return api(`/same-sky/matches/${id}/reopen`, { method: "POST" }); }

export function getPost(id) {
  return api(`/posts/${id}`);
}

export function createPost({ body, category, mood, isAnonymous, file }) {
  const form = new FormData();
  form.append("body", body);
  form.append("category", category);
  form.append("mood", mood);
  form.append("is_anonymous", isAnonymous ? "true" : "false");
  if (file) form.append("file", file);
  return api("/posts", { method: "POST", body: form });
}

export function setReaction(postId, type) {
  return api(`/posts/${postId}/reaction`, { method: "PUT", body: JSON.stringify({ type }) });
}

export function removeReaction(postId) {
  return api(`/posts/${postId}/reaction`, { method: "DELETE" });
}

export function getComments(postId, cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return api(`/posts/${postId}/comments${query}`);
}

export function addComment(postId, { body, parentId, isAnonymous }) {
  return api(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, parent_id: parentId || null, is_anonymous: !!isAnonymous }),
  });
}
