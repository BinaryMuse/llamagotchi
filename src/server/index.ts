import { config } from '../config.ts';
import {
  handleGetMessages,
  handleGetState,
  handleGetNotables,
  handleInject,
} from './routes.ts';
import {
  addClient,
  removeClient,
  broadcastState,
  type WSClient,
  type WSData,
} from './websocket.ts';
import { getState, setState } from '../db/messages.ts';
import index from '../frontend/index.html';

export interface WebSocketMessage {
  type: 'user_message' | 'set_mode' | 'set_delay' | 'step';
  content?: string;
  mode?: 'conversational' | 'autonomous';
  delay?: number | 'infinite';
}

type MessageHandler = (msg: WebSocketMessage, ws: WSClient) => void;

let messageHandler: MessageHandler | null = null;

export function setWebSocketMessageHandler(handler: MessageHandler) {
  messageHandler = handler;
}

export function startServer() {
  const server = Bun.serve<WSData>({
    port: config.port,
    routes: {
      '/': index,
      '/api/messages': {
        GET: handleGetMessages,
      },
      '/api/state': {
        GET: handleGetState,
      },
      '/api/notables': {
        GET: handleGetNotables,
      },
      '/api/inject': {
        POST: handleInject,
      },
    },
    // fetch is called for requests that don't match any route
    fetch(req, server) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for /ws path
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, {
          data: { id: crypto.randomUUID() },
        });
        if (upgraded) return undefined;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      return new Response('Not found', { status: 404 });
    },
    websocket: {
      open(ws) {
        addClient(ws);
        const mode = getState<'conversational' | 'autonomous'>('mode', 'conversational');
        const delay = getState<number | 'infinite'>('delay', 5);
        ws.send(JSON.stringify({ type: 'state', data: { mode, delay } }));
      },
      message(ws, message) {
        try {
          const data = JSON.parse(message.toString()) as WebSocketMessage;

          switch (data.type) {
            case 'set_mode':
              if (data.mode) {
                setState('mode', data.mode);
                const delay = getState<number | 'infinite'>('delay', 5);
                broadcastState(data.mode, delay);
              }
              break;
            case 'set_delay':
              if (data.delay !== undefined) {
                setState('delay', data.delay);
                const mode = getState<'conversational' | 'autonomous'>('mode', 'conversational');
                broadcastState(mode, data.delay);
              }
              break;
          }

          if (messageHandler) {
            messageHandler(data, ws);
          }
        } catch (e) {
          console.error('Invalid WebSocket message:', e);
        }
      },
      close(ws) {
        removeClient(ws);
      },
    },
  });

  console.log(`Server running at http://localhost:${config.port}`);
  return server;
}
