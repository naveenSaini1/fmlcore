export const WS_EVENTS = {
  CONNECTION_READY: "connection.ready",
  CONNECTION_ERROR: "connection.error",
  CONNECTION_PING: "connection.ping",
  CONNECTION_PONG: "connection.pong",

  AUTH_AUTHENTICATE: "auth.authenticate",
  AUTH_SUCCESS: "auth.success",
  AUTH_ERROR: "auth.error",

  CHAT_MESSAGE: "chat.message",
  CHAT_MESSAGE_SEND: "chat.message.send",
  CHAT_MESSAGE_SENT: "chat.message.sent",
  CHAT_MESSAGE_DELIVERED: "chat.message.delivered",
  CHAT_MESSAGE_READ: "chat.message.read",
  CHAT_TYPING_START: "chat.typing.start",
  CHAT_TYPING_STOP: "chat.typing.stop",

  PRESENCE_ONLINE: "presence.online",
  PRESENCE_OFFLINE: "presence.offline",
  PRESENCE_QUERY: "presence.query",
  PRESENCE_STATUS: "presence.status",

  NOTIFICATION_NEW: "notification.new",
  SAME_SKY_MATCH_ACCEPTED: "same_sky.match.accepted",
  SAME_SKY_CONNECTION_CREATED: "same_sky.connection.created",
};
