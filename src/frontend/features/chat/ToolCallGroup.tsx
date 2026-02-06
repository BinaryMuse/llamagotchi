import React, { useState } from 'react';
import type { Message } from '../../shared/types.ts';

interface ToolCallGroupProps {
  call: Message;
  result: Message | null;
}

const TRUNCATE_THRESHOLD = 500; // Show truncated by default if over this
const TRUNCATE_PREVIEW = 300; // How much to show when truncated

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function generateSummary(toolName: string | null, toolInput: string | null): string {
  if (!toolName) return 'Unknown tool';

  let input: Record<string, unknown> = {};
  if (toolInput) {
    try {
      input = JSON.parse(toolInput);
    } catch {
      // ignore parse errors
    }
  }

  switch (toolName) {
    case 'filesystem': {
      const op = input.operation as string;
      const path = input.path as string;
      if (op === 'read') return `read ${path}`;
      if (op === 'write') return `write ${path}`;
      if (op === 'list') return `list ${path}`;
      if (op === 'mkdir') return `mkdir ${path}`;
      if (op === 'delete') return `delete ${path}`;
      return `filesystem ${op || ''} ${path || ''}`;
    }

    case 'terminal': {
      const cmd = input.command as string;
      if (cmd) {
        const firstLine = cmd.split('\n')[0] ?? cmd;
        return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine;
      }
      return 'terminal';
    }

    case 'web_fetch': {
      const url = input.url as string;
      if (url) {
        try {
          const parsed = new URL(url);
          return `fetch ${parsed.hostname}${parsed.pathname.slice(0, 30)}`;
        } catch {
          return `fetch ${url.slice(0, 50)}`;
        }
      }
      return 'web_fetch';
    }

    case 'web_search': {
      const query = input.query as string;
      return query ? `search "${query}"` : 'web_search';
    }

    case 'notable': {
      const label = input.label as string;
      return label ? `notable: ${label}` : 'notable';
    }

    case 'sleep': {
      const duration = input.duration as number;
      const unit = input.unit as string;
      return `sleep ${duration} ${unit}`;
    }

    case 'task_status':
    case 'task_wait': {
      const taskId = input.task_id as string;
      return `${toolName} ${taskId?.slice(0, 8) || ''}`;
    }

    default:
      return toolName;
  }
}

function TruncatedContent({ content }: { content: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!content) return <span className="text-muted">(empty)</span>;

  const needsTruncation = content.length > TRUNCATE_THRESHOLD;

  if (!needsTruncation || expanded) {
    return (
      <>
        {content}
        {needsTruncation && (
          <button
            className="truncate-toggle"
            onClick={() => setExpanded(false)}
          >
            Show less
          </button>
        )}
      </>
    );
  }

  return (
    <>
      {content.slice(0, TRUNCATE_PREVIEW)}
      <span className="truncated-indicator">
        ... ({(content.length - TRUNCATE_PREVIEW).toLocaleString()} more chars)
      </span>
      <button className="truncate-toggle" onClick={() => setExpanded(true)}>
        Show more
      </button>
    </>
  );
}

export function ToolCallGroup({ call, result }: ToolCallGroupProps) {
  const summary = generateSummary(call.tool_name, call.tool_input);
  const isWaiting = !result;

  return (
    <div className="tool-group">
      <details className="tool-details">
        <summary className="tool-summary">
          <span className="tool-icon">{isWaiting ? '⏳' : '🔧'}</span>
          <span className="tool-summary-text">{summary}</span>
          <span className="tool-timestamp">{formatTimestamp(call.timestamp)}</span>
        </summary>
        <div className="tool-body">
          <div className="tool-section">
            <div className="tool-section-header">Input</div>
            <pre><code><TruncatedContent content={call.tool_input} /></code></pre>
          </div>
          {result && (
            <div className="tool-section">
              <div className="tool-section-header">Output</div>
              <pre><code><TruncatedContent content={result.content} /></code></pre>
            </div>
          )}
          {isWaiting && (
            <div className="tool-section tool-waiting">
              <span className="waiting-indicator">Running...</span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
