import { api } from "./api";

export function getConversations() {
  return api("/chat/conversations");
}

export function getConversation(conversationId) {
  return api(`/chat/conversations/${conversationId}`);
}

export function getMessages(conversationId, { cursor, limit = 40 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return api(`/chat/conversations/${conversationId}/messages?${params.toString()}`);
}

export function sendMessageRest(conversationId, content) {
  return api(`/chat/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export function markConversationRead(conversationId) {
  return api(`/chat/conversations/${conversationId}/read`, {
    method: "POST",
  });
}

export function getChatUnreadCount() {
  return api("/chat/unread-count");
}

export function getWsTicket() {
  return api("/chat/ws-ticket");
}
