import React, { useEffect, useRef } from 'react';
import type { Message } from '../../shared/types.ts';
import { MessageBubble } from './MessageBubble.tsx';
import { ToolCallGroup } from './ToolCallGroup.tsx';

interface ChatStreamProps {
  messages: Message[];
  streamingMessage: { id: number; content: string } | null;
  streamingReasoning: { id: number; content: string } | null;
}

// Group consecutive tool_call and tool_result messages together
type DisplayItem =
  | { type: 'message'; message: Message }
  | { type: 'tool_group'; call: Message; result: Message | null };

function groupMessages(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.source === 'tool_call') {
      // Look for matching tool_result (next message with same tool_name)
      const nextMsg = messages[i + 1];
      if (nextMsg?.source === 'tool_result' && nextMsg.tool_name === msg.tool_name) {
        items.push({ type: 'tool_group', call: msg, result: nextMsg });
        i += 2;
      } else {
        // Tool call without result yet
        items.push({ type: 'tool_group', call: msg, result: null });
        i += 1;
      }
    } else if (msg.source === 'tool_result') {
      // Orphan tool result (shouldn't happen normally, but handle it)
      items.push({ type: 'message', message: msg });
      i += 1;
    } else {
      items.push({ type: 'message', message: msg });
      i += 1;
    }
  }

  return items;
}

export function ChatStream({
  messages,
  streamingMessage,
  streamingReasoning,
}: ChatStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingMessage, streamingReasoning]);

  // Limit to last 1000 messages
  const MAX_DISPLAY_MESSAGES = 1000;
  const limitedMessages =
    messages.length > MAX_DISPLAY_MESSAGES
      ? messages.slice(-MAX_DISPLAY_MESSAGES)
      : messages;

  const displayItems = groupMessages(limitedMessages);

  if (displayItems.length === 0 && !streamingMessage && !streamingReasoning) {
    return (
      <div className="chat-stream">
        <div className="empty-state">
          <h2>No messages yet</h2>
          <p>Start a conversation or switch to autonomous mode</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-stream" ref={containerRef}>
      {displayItems.map((item) => {
        if (item.type === 'tool_group') {
          return (
            <ToolCallGroup
              key={item.call.id}
              call={item.call}
              result={item.result}
            />
          );
        }
        return <MessageBubble key={item.message.id} message={item.message} />;
      })}
      {streamingReasoning && (
        <MessageBubble
          message={{
            id: streamingReasoning.id,
            source: 'reasoning',
            content: streamingReasoning.content,
            tool_name: null,
            tool_input: null,
            timestamp: Date.now(),
            metadata: null,
          }}
          isStreaming
        />
      )}
      {streamingMessage && (
        <MessageBubble
          message={{
            id: streamingMessage.id,
            source: 'assistant',
            content: streamingMessage.content,
            tool_name: null,
            tool_input: null,
            timestamp: Date.now(),
            metadata: null,
          }}
          isStreaming
        />
      )}
    </div>
  );
}
