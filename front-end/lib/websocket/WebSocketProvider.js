"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "../session";
import { getWsTicket } from "../chatApi";
import { WebSocketClient } from "./WebSocketClient";
import { attachLiveUpdates } from "../live-updates";
import { setLiveReady } from "../live-sync";
import { invalidateApiReads } from "../api";
import { WebSocketContext } from "./WebSocketContext";

export function WebSocketProvider({ children }) {
  const clientRef = useRef(null);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [status, setStatus] = useState("disconnected");
  const { user: currentUser, ready: sessionReady } = useSession();

  // Initialize client singleton once
  if (!clientRef.current && typeof window !== "undefined") {
    clientRef.current = new WebSocketClient({
      getTicket: async () => {
        const res = await getWsTicket();
        return res?.ticket || null;
      },
    });
  }

  // Subscribe to status changes
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return undefined;

    const unsubscribe = client.onStatusChange((newStatus) => {
      setStatus(newStatus);
      if (newStatus !== "connected") setLiveReady(false);
    });

    return unsubscribe;
  }, []);

  // One shared stream drives the badge and any open inbox. No polling timers.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return undefined;
    return attachLiveUpdates(client, {
      invalidate: invalidateApiReads,
      notify: (name) => window.dispatchEvent(new Event(name)),
      setReady: setLiveReady,
      setUnread: setChatUnreadCount,
    });
  }, []);

  // Profile/theme edits keep the connection; account changes replace it.
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !sessionReady) return undefined;
    setChatUnreadCount(0);
    if (currentUser?.id) client.connect();
    else client.disconnect();
    return () => { setLiveReady(false); client.disconnect(); };
  }, [sessionReady, currentUser?.id]);

  const value = {
    client: clientRef.current,
    status,
    isConnected: status === "connected",
    currentUser,
    chatUnreadCount,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
