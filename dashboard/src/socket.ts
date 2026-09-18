import { useEffect, useRef } from "react";
import { getAuthToken } from "./api";

function getWsBaseUrl(): string | null {
  // If an explicit WS URL is configured (e.g. Railway backend), always use it
  if (import.meta.env.VITE_WS_BASE_URL) return import.meta.env.VITE_WS_BASE_URL;
  if (typeof window !== "undefined") {
    // On Netlify without an explicit WS URL: Netlify doesn't host the WS server.
    // Fall back to 5s HTTP polling instead of hammering closed sockets.
    if (window.location.hostname.endsWith("netlify.app")) {
      return null;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}`;
  }
  return null; // No WS URL available; caller will use HTTP polling
}

export interface LocationUpdateEvent {
  type: "location:update";
  data: {
    workerId: string;
    sessionId: string;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    capturedAt: string;
    isDelayed: boolean;
  };
}

export interface SessionEvent {
  type: "session:started" | "session:ended";
  data: { workerId: string; sessionId: string };
}

type SocketEvent = LocationUpdateEvent | SessionEvent;

/** Connects once and reconnects with backoff on drop; calls onEvent for every message. */
export function useLiveSocket(onEvent: (event: SocketEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const wsUrl = getWsBaseUrl();
    if (!wsUrl) return; // Serverless host: rely on 5s REST polling

    let socket: WebSocket | null = null;
    let retryDelay = 2000;
    let closedByCleanup = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failedAttempts = 0;

    function connect() {
      const token = getAuthToken();
      if (!token || closedByCleanup) return;

      try {
        socket = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);

        socket.onopen = () => {
          failedAttempts = 0;
          retryDelay = 2000;
        };

        socket.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data) as SocketEvent;
            onEventRef.current(parsed);
          } catch {
            // ignore malformed frames
          }
        };

        socket.onerror = () => {
          // Handled in onclose
        };

        socket.onclose = () => {
          if (closedByCleanup) return;
          failedAttempts++;
          // If WS host is unreachable after 5 attempts, back off to 30s
          const maxBackoff = failedAttempts > 5 ? 30_000 : 15_000;
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, maxBackoff);
            connect();
          }, retryDelay);
        };
      } catch {
        // WebSocket constructor failed
      }
    }

    connect();

    return () => {
      closedByCleanup = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);
}
