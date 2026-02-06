import React from 'react';
import type { Notable } from '../../shared/types.ts';
import { NotableCard } from './NotableCard.tsx';

interface NotablesViewProps {
  notables: Notable[];
}

export function NotablesView({ notables }: NotablesViewProps) {
  if (notables.length === 0) {
    return (
      <div className="notables-view">
        <div className="empty-state">
          <h2>No notables yet</h2>
          <p>The agent will surface interesting discoveries here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="notables-view">
      {notables.map((notable) => (
        <NotableCard key={notable.id} notable={notable} />
      ))}
    </div>
  );
}
