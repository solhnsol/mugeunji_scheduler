import { useEffect, useRef } from 'react';
import { wsUrl } from '../api';

type WsMessage = { type: string; data: unknown };

export function useReservationSocket(onMessage: (message: WsMessage) => void) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl());
      socket.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data) as WsMessage);
        } catch {
          /* ignore malformed payloads */
        }
      };
      socket.onclose = (event) => {
        // 1008: 로그인이 필요하거나 만료됨 — 계속 다시 연결하지 않는다
        if (event.code === 1008) return;
        if (!stopped) timer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);
}
