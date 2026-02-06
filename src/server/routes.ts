import {
  getAllMessages,
  getAllNotables,
  getState,
  addMessage,
} from '../db/messages.ts';
import { broadcastMessage } from './websocket.ts';

export interface InjectRequest {
  source: string;
  content: string;
}

export function handleGetMessages(): Response {
  const messages = getAllMessages();
  return Response.json(messages);
}

export function handleGetState(): Response {
  const mode = getState<'conversational' | 'autonomous'>('mode', 'conversational');
  const delay = getState<number | 'infinite'>('delay', 5);
  return Response.json({ mode, delay });
}

export function handleGetNotables(): Response {
  const notables = getAllNotables();
  return Response.json(notables);
}

export async function handleInject(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as InjectRequest;

    if (!body.source || !body.content) {
      return Response.json({ error: 'Missing source or content' }, { status: 400 });
    }

    if (!body.source.startsWith('external:')) {
      return Response.json(
        { error: 'Source must start with "external:"' },
        { status: 400 }
      );
    }

    const message = addMessage(body.source, body.content);
    broadcastMessage(message);

    return Response.json({ success: true, message });
  } catch (e) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
