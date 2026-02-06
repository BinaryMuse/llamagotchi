import React from 'react';

interface DelayControlProps {
  delay: number | 'infinite';
  onSetDelay: (delay: number | 'infinite') => void;
  onStep: () => void;
  disabled: boolean;
}

export function DelayControl({
  delay,
  onSetDelay,
  onStep,
  disabled,
}: DelayControlProps) {
  const isInfinite = delay === 'infinite';
  const numericDelay = isInfinite ? 30 : delay;

  return (
    <div className="delay-control">
      <label>Delay</label>
      <input
        type="range"
        min={0}
        max={60}
        value={numericDelay}
        onChange={(e) => onSetDelay(parseInt(e.target.value, 10))}
        disabled={disabled || isInfinite}
      />
      <span className="delay-value">
        {isInfinite ? '∞' : `${numericDelay}s`}
      </span>
      <label className="infinite-toggle">
        <input
          type="checkbox"
          checked={isInfinite}
          onChange={(e) =>
            onSetDelay(e.target.checked ? 'infinite' : numericDelay)
          }
          disabled={disabled}
        />{' '}
        Infinite
      </label>
      <button
        className="step-button"
        onClick={onStep}
        disabled={disabled || !isInfinite}
      >
        Step
      </button>
    </div>
  );
}
