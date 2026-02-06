import React from 'react';
import { ModeToggle } from './ModeToggle.tsx';
import { DelayControl } from './DelayControl.tsx';

interface ControlBarProps {
  mode: 'conversational' | 'autonomous';
  delay: number | 'infinite';
  onSetMode: (mode: 'conversational' | 'autonomous') => void;
  onSetDelay: (delay: number | 'infinite') => void;
  onStep: () => void;
}

export function ControlBar({
  mode,
  delay,
  onSetMode,
  onSetDelay,
  onStep,
}: ControlBarProps) {
  return (
    <div className="control-bar">
      <ModeToggle mode={mode} onSetMode={onSetMode} />
      <DelayControl
        delay={delay}
        onSetDelay={onSetDelay}
        onStep={onStep}
        disabled={mode === 'conversational'}
      />
    </div>
  );
}
