import { useEffect, useRef, useState } from 'react';
import { wsUrl } from '../api';

type WsMessage = { type: string; data: unknown };

/**
 * 예약 현황 실시간 소켓.
 * - 끊기면 1초부터 시작해 최대 15초까지 간격을 늘려 다시 연결한다.
 * - 탭이 다시 보이거나 네트워크가 돌아오면 기다리지 않고 바로 연결한다.
 * - 끊겼다가 다시 연결되면 그 사이 놓친 변경이 있을 수 있으니 onResync로 화면을 새로 불러오게 한다.
 * @returns connected — 지금 실시간 연결이 살아 있는지
 */
export function useReservationSocket(onMessage: (message: WsMessage) => void, onResync?: () => void) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const resyncRef = useRef(onResync);
  resyncRef.current = onResync;
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;
    let everConnected = false;
    let lostSinceOpen = false;
    let denied = false;

    const connect = () => {
      if (stopped || denied) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      const ws = new WebSocket(wsUrl());
      socket = ws;
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        if (everConnected && lostSinceOpen) resyncRef.current?.();
        everConnected = true;
        lostSinceOpen = false;
      };
      ws.onmessage = (event) => {
        try {
          handlerRef.current(JSON.parse(event.data) as WsMessage);
        } catch {
          /* ignore malformed payloads */
        }
      };
      ws.onclose = (event) => {
        if (stopped || socket !== ws) return;
        // 1008: 로그인이 필요하거나 만료됨. 다시 연결해도 같은 결과라 멈춘다
        if (event.code === 1008) {
          denied = true;
          setConnected(false);
          return;
        }
        lostSinceOpen = true;
        // 처음 접속이 아니거나 한 번이라도 연결된 뒤에 끊긴 경우만 "끊김"으로 표시한다
        if (everConnected || attempt > 0) setConnected(false);
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        attempt += 1;
        timer = setTimeout(connect, delay);
      };
    };

    const wake = () => {
      if (document.visibilityState === 'visible') connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', connect);

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', connect);
      socket?.close();
    };
  }, []);

  return { connected };
}
