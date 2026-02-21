import type { ServerWebSocket } from 'bun';
import type { Message, Notable } from '../db/messages.ts';

export interface WSData {
  id: string;
}

export type WSClient = ServerWebSocket<WSData>;

const clients = new Set<WSClient>();

export function addClient(ws: WSClient) {
  clients.add(ws);
}

export function removeClient(ws: WSClient) {
  clients.delete(ws);
}

export function broadcastMessage(message: Message) {
  const payload = JSON.stringify({ type: 'message', data: message });
  for (const client of clients) {
    client.send(payload);
  }
}

export function broadcastToken(id: number, token: string) {
  const payload = JSON.stringify({ type: 'token', data: { id, token } });
  for (const client of clients) {
    client.send(payload);
  }
}

export function broadcastReasoning(id: number, reasoning: string) {
  const payload = JSON.stringify({ type: 'reasoning', data: { id, reasoning } });
  for (const client of clients) {
    client.send(payload);
  }
}

export function broadcastState(mode: 'conversational' | 'autonomous', delay: number | 'infinite') {
  const payload = JSON.stringify({ type: 'state', data: { mode, delay } });
  for (const client of clients) {
    client.send(payload);
  }
}

export function broadcastNotable(notable: Notable) {
  const payload = JSON.stringify({ type: 'notable', data: notable });
  for (const client of clients) {
    client.send(payload);
  }
}

export interface ContextPressure {
  tokens: number;
  maxTokens: number;
  ratio: number;
  level: 'normal' | 'soft' | 'hard' | 'overflow';
}

export function broadcastContextPressure(pressure: ContextPressure) {
  const payload = JSON.stringify({ type: 'context_pressure', data: pressure });
  for (const client of clients) {
    client.send(payload);
  }
}

export interface FsmState {
  state: string;
  turnNumber: number;
}

export function broadcastFsmState(fsmState: FsmState) {
  const payload = JSON.stringify({ type: 'fsm_state', data: fsmState });
  for (const client of clients) {
    client.send(payload);
  }
}

export function getClientCount(): number {
  return clients.size;
}
