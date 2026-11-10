"use client";

import { useEffect, useRef } from "react";
import { useWebSocket } from "./useWebSocket";

export function useWebSocketEvent(eventName, callback) {
  const { client } = useWebSocket();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!client || !eventName) return undefined;

    const handler = (data, fullPayload) => {
      if (callbackRef.current) {
        callbackRef.current(data, fullPayload);
      }
    };

    const unsubscribe = client.on(eventName, handler);
    return () => {
      unsubscribe();
    };
  }, [client, eventName]);
}
