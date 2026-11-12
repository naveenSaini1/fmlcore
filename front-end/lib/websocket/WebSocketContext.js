"use client";

import { createContext } from "react";

export const WebSocketContext = createContext({
  client: null,
  chatUnreadCount: 0,
  status: "disconnected",
  isConnected: false,
});
