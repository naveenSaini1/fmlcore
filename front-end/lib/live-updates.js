import { WS_EVENTS } from "./websocket/WebSocketEvents";

// Register invalidation before page listeners so their refreshes always join a
// current request. Presence, typing, and heartbeats do not invalidate reads.
export function attachLiveUpdates(client, { invalidate, notify, setReady, setUnread }) {
  const refreshInbox = () => { invalidate(["notifications"]); notify("fmlcore:notifications-change"); };
  const syncChat = () => { invalidate(["chat", "same-sky"]); notify("fmlcore:chat-sync"); };
  const unsubscribe = [
    client.on(WS_EVENTS.CONNECTION_READY, () => {
      invalidate(["notifications", "chat", "same-sky"]);
      setReady(true);
      notify("fmlcore:notifications-change");
      notify("fmlcore:chat-sync");
    }),
    client.on(WS_EVENTS.NOTIFICATION_CHANGED, refreshInbox),
    client.on(WS_EVENTS.CHAT_UNREAD_COUNT, (data) => {
      if (Number.isInteger(data?.count) && data.count >= 0) setUnread(data.count);
    }),
    ...[WS_EVENTS.CHAT_MESSAGE, WS_EVENTS.CHAT_MESSAGE_SENT, WS_EVENTS.CHAT_MESSAGE_READ,
      WS_EVENTS.CHAT_MESSAGE_DELIVERED].map((event) => client.on(event, () => invalidate(["chat"]))),
    client.on(WS_EVENTS.CHAT_IDENTITY_CHANGED, () => invalidate(["chat", "same-sky"])),
    client.on(WS_EVENTS.SAME_SKY_CONNECTION_CREATED, syncChat),
    client.on(WS_EVENTS.SAME_SKY_MATCH_ACCEPTED, () => invalidate(["same-sky"])),
  ];
  return () => unsubscribe.forEach((stop) => stop());
}
