import React from 'react';
import { ModeToggle } from './ModeToggle.tsx';
import { DelayControl } from './DelayControl.tsx';
import type { FsmState } from '../../shared/types.ts';

interface ControlBarProps {
  mode: 'conversational' | 'autonomous';
  delay: number | 'infinite';
  onSetMode: (mode: 'conversational' | 'autonomous') => void;
  onSetDelay: (delay: number | 'infinite') => void;
  onStep: () => void;
  fsmState: FsmState;
}

export function ControlBar({
  mode,
  delay,
  onSetMode,
  onSetDelay,
  onStep,
  fsmState,
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
      <div className="fsm-debug">
        <span className="fsm-state">{fsmState.state}</span>
        <span className="fsm-turn">turn {fsmState.turnNumber}</span>
      </div>
    </div>
  );
}
