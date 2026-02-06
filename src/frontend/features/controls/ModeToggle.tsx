import React from 'react';

interface ModeToggleProps {
  mode: 'conversational' | 'autonomous';
  onSetMode: (mode: 'conversational' | 'autonomous') => void;
}

export function ModeToggle({ mode, onSetMode }: ModeToggleProps) {
  return (
    <div className="mode-toggle">
      <label>Mode</label>
      <select
        value={mode}
        onChange={(e) =>
          onSetMode(e.target.value as 'conversational' | 'autonomous')
        }
      >
        <option value="conversational">Conversational</option>
        <option value="autonomous">Autonomous</option>
      </select>
    </div>
  );
}
