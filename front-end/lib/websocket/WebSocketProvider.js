"use client";

import { useEffect, useRef, useState } from "react";
import { getMe } from "../api";
import { getWsTicket } from "../chatApi";
import { WebSocketClient } from "./WebSocketClient";
import { WebSocketContext } from "./WebSocketContext";

export function WebSocketProvider({ children }) {
  const clientRef = useRef(null);
  const [status, setStatus] = useState("disconnected");
  const [currentUser, setCurrentUser] = useState(null);

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
    });

    return unsubscribe;
  }, []);

  // Handle auth checks and connection lifecycle
  useEffect(() => {
    let active = true;

    const syncAuthAndConnect = async () => {
      const client = clientRef.current;
      if (!client) return;

      try {
        const user = await getMe();
        if (!active) return;
        if (user) {
          setCurrentUser(user);
          client.connect();
        } else {
          setCurrentUser(null);
          client.disconnect();
        }
      } catch {
        if (!active) return;
        setCurrentUser(null);
        client.disconnect();
      }
    };

    syncAuthAndConnect();

    const handleAuthChange = () => {
      syncAuthAndConnect();
    };

    window.addEventListener("fmlcore:auth-change", handleAuthChange);
    return () => {
      active = false;
      window.removeEventListener("fmlcore:auth-change", handleAuthChange);
    };
  }, []);

  const value = {
    client: clientRef.current,
    status,
    isConnected: status === "connected",
    currentUser,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
