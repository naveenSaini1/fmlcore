import { sessionStore } from "./session-store";
import { createRequestCache } from "./request-cache";
import { waitForLiveReady } from "./live-sync";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const reads = createRequestCache({ getScope: () => sessionStore.getIdentityVersion() });

export function invalidateApiReads(tags) {
  if (typeof window !== "undefined") reads.invalidate(tags);
}

function readTags(path) {
  if (/^\/(posts|comments|confessions|leaderboard|explore)(\/|$)/.test(path) || path === "/me/posts") return ["content"];
  return [path.split("/")[1]];
}

function mutationTags(path) {
  const group = path.split("/")[1];
  if (["posts", "comments", "confessions"].includes(group)) return ["content", "users", "same-sky", "notifications"];
  if (group === "same-sky") return ["same-sky", "chat", "notifications"];
  if (group === "profile") return ["profile", "users", "content", "chat"];
  if (group === "chat") return ["chat", "same-sky"];
  if (group === "notifications") return [group];
  // Auth, blocking/muting, and admin actions may change visibility globally.
  return undefined;
}

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

async function fetchApi(path, options = {}) {
  const sessionGeneration = sessionStore.getGeneration();
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
    const error = new Error(errorMessage(data));
    error.status = response.status;
    if (typeof window !== "undefined" && response.status === 401 && !path.startsWith("/auth/") &&
        sessionGeneration === sessionStore.getGeneration() && sessionStore.getSnapshot().user) {
      sessionStore.setUser(null);
    }
    throw error;
  }

  return data;
}

export async function api(path, options = {}) {
  const { fresh = false, dedupe = true, ...fetchOptions } = options;
  const method = (fetchOptions.method || "GET").toUpperCase();
  if (typeof window === "undefined") return fetchApi(path, fetchOptions);
  if (method !== "GET") {
    const tags = mutationTags(path);
    const finishWrite = reads.beginWrite(tags);
    try {
      const data = await fetchApi(path, fetchOptions);
      invalidateApiReads(tags);
      return data;
    } finally {
      // Allow the same committed write's socket event and HTTP response to
      // settle before their consumers load a shared snapshot.
      await new Promise((resolve) => setTimeout(resolve, 20));
      finishWrite();
    }
  }
  // Session checks have their own shared store. Random actions and WS tickets
  // must issue a new request, and caller-owned abort signals stay independent.
  if (!dedupe || fetchOptions.signal || /^\/(auth\/me|chat\/ws-ticket)(?:\?|$)/.test(path) ||
      /^\/(explore|confessions)\/random(?:\?|$)/.test(path)) return fetchApi(path, fetchOptions);
  if (!path.startsWith("/auth/") && !sessionStore.getSnapshot().ready) {
    await getMe().catch(() => {});
  }
  if (/^\/(notifications(?:\/|\?|$)|chat\/conversations(?:\?|$))/.test(path)) await waitForLiveReady();
  const url = new URL(path, "http://api.local");
  url.searchParams.sort();
  const tags = readTags(url.pathname);
  await reads.waitForWrites(tags);
  const headers = [...new Headers(fetchOptions.headers).entries()].sort();
  const key = JSON.stringify([url.pathname + url.search, headers, fetchOptions.credentials || "include", fetchOptions.cache || "default"]);
  return reads.read(key, () => fetchApi(path, fetchOptions), { tags, fresh });
}

export function getMe() {
  // Server requests must never share session data between visitors.
  if (typeof window === "undefined") return api("/auth/me", { cache: "no-store" });
  return sessionStore.load(() => api("/auth/me", { cache: "no-store" }));
}

function publishSession(user) {
  if (typeof window !== "undefined") {
    sessionStore.setUser(user);
    try { window.localStorage.setItem("fmlcore-session-change", `${Date.now()}-${Math.random()}`); } catch {}
  }
  return user;
}

function acceptAuthResult(result) {
  if (result?.id && !result.requires_verification && !result.requires_username) publishSession(result);
  return result;
}

export function getPlatformDefaultTheme() {
  return api("/platform/default-theme");
}

export function signup(body) {
  return api("/auth/signup", { method: "POST", body: JSON.stringify(body) }).then(acceptAuthResult);
}

export function login(body) {
  return api("/auth/login", { method: "POST", body: JSON.stringify(body) }).then(acceptAuthResult);
}

export function getAuthOptions() { return api("/auth/options"); }
export function verifyEmail(body) { return api("/auth/email/verify", { method: "POST", body: JSON.stringify(body) }).then(acceptAuthResult); }
export function resendEmailCode(challenge_id) { return api("/auth/email/resend", { method: "POST", body: JSON.stringify({ challenge_id }) }); }
export function startGoogleSignin() { return api("/auth/google/start", { method: "POST" }); }
export function googleSignin(body) { return api("/auth/google", { method: "POST", body: JSON.stringify(body) }).then(acceptAuthResult); }
export function completeGoogleSignup(body) { return api("/auth/google/complete", { method: "POST", body: JSON.stringify(body) }).then(acceptAuthResult); }
export function checkUsername(username) { return api(`/auth/username-availability?username=${encodeURIComponent(username)}`); }

export async function logout() {
  if (typeof window !== "undefined" && window.navigator?.serviceWorker) {
    const { removeBrowserPush } = await import("./browser-push");
    await removeBrowserPush(api).catch(() => {});
  }
  const result = await api("/auth/logout", { method: "POST" });
  publishSession(null);
  return result;
}

export function updateProfile(body) {
  return api("/profile", { method: "PATCH", body: JSON.stringify(body) }).then(publishSession);
}

export function updateTheme(theme) {
  return api("/profile/theme", { method: "PATCH", body: JSON.stringify({ theme }) }).then(publishSession);
}

export function updateSkin(skin) {
  return api("/profile/skin", { method: "PATCH", body: JSON.stringify({ skin }) }).then(publishSession);
}

export function uploadAvatar(file) {
  const body = new FormData();
  body.append("file", file);
  return api("/profile/avatar", { method: "POST", body }).then(publishSession);
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

export function getLeaderboard({ limit = 5, offset = 0, fresh = false } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return api(`/leaderboard?${params.toString()}`, { fresh });
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
export function editPost(id, body) {
  return api(`/posts/${id}`, { method: "PATCH", body: JSON.stringify({ body }) });
}

export function deletePost(id) { return api(`/posts/${id}`, { method: "DELETE" }); }
export function deleteComment(id) { return api(`/comments/${id}`, { method: "DELETE" }); }

export function getSameSky({ fresh = false } = {}) { return api("/same-sky", { fresh }); }
export function includePostInSameSky(id) { return api(`/same-sky/posts/${id}/include`, { method: "POST" }); }
export function excludePostFromSameSky(id) { return api(`/same-sky/posts/${id}/include`, { method: "DELETE" }); }
export function updateSameSkyProfile(body) { return api("/same-sky/profile", { method: "PATCH", body: JSON.stringify(body) }); }
export function retrySameSkyPost(id) { return api(`/same-sky/posts/${id}/retry`, { method: "POST" }); }
export function startSameSkyAttempt() { return api("/same-sky/attempts", { method: "POST" }); }
export function getSameSkyAttempt(id) {
  return api(`/same-sky/attempts/${id}`).then((result) => {
    if (["match_found", "no_match", "unavailable", "not_eligible"].includes(result.status)) invalidateApiReads(["same-sky"]);
    return result;
  });
}
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

export function getComments(postId, cursor, focus) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (focus) params.set("focus", focus);
  const query = params.size ? `?${params}` : "";
  return api(`/posts/${postId}/comments${query}`);
}

export function addComment(postId, { body, parentId, isAnonymous }) {
  return api(`/posts/${postId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, parent_id: parentId || null, is_anonymous: !!isAnonymous }),
  });
}
