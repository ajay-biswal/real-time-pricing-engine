import { useEffect, useState } from "react";
import { numeric, SYMBOLS, type ChartPoint } from "./marketCatalog";
import type { ConnectionState, MarketSnapshot, ServerMessage } from "./types";

export interface MarketDataState {
  connection: ConnectionState;
  snapshots: Record<string, MarketSnapshot>;
  history: Record<string, ChartPoint[]>;
  lastMessageAt: string | null;
  socketError: string | null;
}

/**
 * Owns the live market-data connection and transforms provider messages into
 * the snapshot/history state consumed by dashboard UI components.
 */
export function useMarketData(): MarketDataState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [snapshots, setSnapshots] = useState<Record<string, MarketSnapshot>>({});
  const [history, setHistory] = useState<Record<string, ChartPoint[]>>({});
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      attempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempts - 1, 5), 15000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      setConnection(attempts === 0 ? "connecting" : "reconnecting");
      const url = import.meta.env.VITE_WS_URL ||
        ((window.location.protocol === "https:" ? "wss:" : "ws:") + "//" + window.location.host + "/ws");

      try {
        socket = new WebSocket(url);
      } catch {
        setConnection("disconnected");
        setSocketError("Could not create a WebSocket connection.");
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        attempts = 0;
        setConnection("connected");
        setSocketError(null);
        socket?.send(JSON.stringify({
          action: "subscribe",
          symbols: SYMBOLS.map((item) => item.symbol)
        }));
      });

      socket.addEventListener("message", (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          setSocketError("Received an unreadable message from the server.");
          return;
        }

        if (message.event === "error") {
          setSocketError(message.message || "The server rejected a request.");
          return;
        }

        if (
          (message.event === "marketPriceSnapshot" || message.event === "marketPriceUpdate") &&
          message.data &&
          typeof message.data.symbol === "string"
        ) {
          const snapshot = message.data;
          setSnapshots((current) => ({ ...current, [snapshot.symbol]: snapshot }));
          const price = numeric(snapshot.buy);
          const timestamp = new Date(snapshot.updatedAt).getTime();

          if (price !== null) {
            setHistory((current) => {
              const previous = current[snapshot.symbol] || [];
              return {
                ...current,
                [snapshot.symbol]: [
                  ...previous,
                  { time: Number.isFinite(timestamp) ? timestamp : Date.now(), price }
                ].slice(-90)
              };
            });
          }

          setLastMessageAt(new Date().toISOString());
        }
      });

      socket.addEventListener("error", () => {
        setSocketError("Connection issue. Retrying automatically.");
      });

      socket.addEventListener("close", () => {
        if (!disposed) {
          setConnection("reconnecting");
          scheduleReconnect();
        }
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { connection, snapshots, history, lastMessageAt, socketError };
}
