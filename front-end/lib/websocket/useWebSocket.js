"use client";

import { useContext } from "react";
import { WebSocketContext } from "./WebSocketContext";

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  return context;
}
