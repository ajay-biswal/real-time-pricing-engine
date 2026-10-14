export interface MarketSnapshot {
  symbol: string;
  buy: string;
  sell: string;
  high24h: string;
  low24h: string;
  change24h: string;
  updatedAt: string;
  publishedAt?: string;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ServerMessage {
  event?: string;
  data?: MarketSnapshot;
  symbols?: string[];
  message?: string;
}