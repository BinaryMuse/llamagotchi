import React from 'react';
import type { Message } from '../../shared/types.ts';

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getSourceClass(source: string): string {
  if (source.startsWith('external:')) return 'external';
  return source;
}

function getSourceLabel(source: string): string {
  if (source.startsWith('external:')) {
    return source.replace('external:', '');
  }
  return source;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const sourceClass = getSourceClass(message.source);
  const sourceLabel = getSourceLabel(message.source);
  const isReasoning = message.source === 'reasoning';
  const isSystem = message.source === 'system';

  return (
    <div className={`message ${isReasoning ? 'reasoning' : ''} ${isSystem ? 'system' : ''}`}>
      <div className="message-header">
        <span className={`message-source ${sourceClass}`}>{sourceLabel}</span>
        <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
        {isStreaming && <span className="streaming-indicator">●</span>}
      </div>
      <div className="message-content">{message.content}</div>
    </div>
  );
}
