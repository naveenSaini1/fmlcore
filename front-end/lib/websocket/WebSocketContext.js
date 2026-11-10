"use client";

import { createContext } from "react";

export const WebSocketContext = createContext({
  client: null,
  status: "disconnected",
  isConnected: false,
});
