import React from 'react';
import type { Notable } from '../../shared/types.ts';

interface NotableCardProps {
  notable: Notable;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotableCard({ notable }: NotableCardProps) {
  return (
    <div className="notable-card">
      <div className="notable-header">
        <span className="notable-label">{notable.label}</span>
        <span className="notable-timestamp">
          {formatTimestamp(notable.timestamp)}
        </span>
      </div>
      <div className="notable-content">{notable.content}</div>
      {notable.reason && (
        <div className="notable-reason">{notable.reason}</div>
      )}
    </div>
  );
}
