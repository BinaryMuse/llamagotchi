import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ChatStream } from './features/chat/ChatStream.tsx';
import { ChatInput } from './features/chat/ChatInput.tsx';
import { NotablesView } from './features/notables/NotablesView.tsx';
import { ControlBar } from './features/controls/ControlBar.tsx';
import { useWebSocket } from './shared/hooks/useWebSocket.ts';
import type { Message, Notable, AgentState, ContextPressure } from './shared/types.ts';

type Tab = 'chat' | 'notables';

function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [notables, setNotables] = useState<Notable[]>([]);
  const [agentState, setAgentState] = useState<AgentState>({
    mode: 'conversational',
    delay: 5,
  });
  const [streamingMessage, setStreamingMessage] = useState<{
    id: number;
    content: string;
  } | null>(null);
  const [streamingReasoning, setStreamingReasoning] = useState<{
    id: number;
    content: string;
  } | null>(null);
  const [contextPressure, setContextPressure] = useState<ContextPressure | null>(null);

  const { status, send } = useWebSocket({
    onMessage: (msg) => {
      if (msg.type === 'message') {
        const message = msg.data as Message;
        // Clear streaming states when a final message arrives
        if (message.source === 'assistant') {
          setStreamingMessage(null);
        }
        if (message.source === 'reasoning') {
          setStreamingReasoning(null);
        }
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === message.id);
          if (existing) {
            return prev.map((m) => (m.id === message.id ? message : m));
          }
          return [...prev, message];
        });
      } else if (msg.type === 'token') {
        const { id, token } = msg.data as { id: number; token: string };
        setStreamingMessage((prev) => {
          if (prev && prev.id === id) {
            return { id, content: prev.content + token };
          }
          return { id, content: token };
        });
      } else if (msg.type === 'reasoning') {
        const { id, reasoning } = msg.data as { id: number; reasoning: string };
        setStreamingReasoning((prev) => {
          if (prev && prev.id === id) {
            return { id, content: prev.content + reasoning };
          }
          return { id, content: reasoning };
        });
      } else if (msg.type === 'state') {
        setAgentState(msg.data as AgentState);
      } else if (msg.type === 'notable') {
        setNotables((prev) => [msg.data as Notable, ...prev]);
      } else if (msg.type === 'context_pressure') {
        setContextPressure(msg.data as ContextPressure);
      }
    },
  });

  useEffect(() => {
    fetch('/api/messages')
      .then((res) => res.json() as Promise<Message[]>)
      .then(setMessages)
      .catch(console.error);

    fetch('/api/notables')
      .then((res) => res.json() as Promise<Notable[]>)
      .then(setNotables)
      .catch(console.error);
  }, []);

  const handleSendMessage = (content: string) => {
    send({ type: 'user_message', content });
  };

  const handleSetMode = (mode: 'conversational' | 'autonomous') => {
    send({ type: 'set_mode', mode });
  };

  const handleSetDelay = (delay: number | 'infinite') => {
    send({ type: 'set_delay', delay });
  };

  const handleStep = () => {
    send({ type: 'step' });
  };

  return (
    <div className="app">
      <header className="header">
        <h1>llamagotchi</h1>
        <div className="connection-status">
          <span
            className={`connection-dot ${status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected'}`}
          />
          {status}
        </div>
        {contextPressure && (
          <div className="context-pressure" title={`${contextPressure.tokens} / ${contextPressure.maxTokens} tokens`}>
            <span className="context-label">ctx</span>
            <div className="context-bar">
              <div
                className={`context-fill ${contextPressure.level}`}
                style={{ width: `${Math.min(contextPressure.ratio * 100, 100)}%` }}
              />
            </div>
            <span className="context-percent">{Math.round(contextPressure.ratio * 100)}%</span>
          </div>
        )}
        <nav className="tabs">
          <button
            className={`tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat
          </button>
          <button
            className={`tab ${tab === 'notables' ? 'active' : ''}`}
            onClick={() => setTab('notables')}
          >
            Notables
          </button>
        </nav>
      </header>

      <ControlBar
        mode={agentState.mode}
        delay={agentState.delay}
        onSetMode={handleSetMode}
        onSetDelay={handleSetDelay}
        onStep={handleStep}
      />

      <main className="main">
        {tab === 'chat' ? (
          <>
            <ChatStream
              messages={messages}
              streamingMessage={streamingMessage}
              streamingReasoning={streamingReasoning}
            />
            <ChatInput
              onSend={handleSendMessage}
              disabled={status !== 'connected'}
            />
          </>
        ) : (
          <NotablesView notables={notables} />
        )}
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
