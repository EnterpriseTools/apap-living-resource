'use client';

import React from 'react';

type TooltipHeaderProps = {
  label: string;
  tooltip: string;
};

/**
 * Renders label text with a dotted underline. On hover/focus, browser shows tooltip (title).
 * Accessible and works inside overflow/scroll containers.
 */
export function TooltipHeader({ label, tooltip }: TooltipHeaderProps) {
  return (
    <span
      title={tooltip}
      style={{
        borderBottom: '1px dotted var(--fg-secondary)',
        cursor: 'help',
      }}
    >
      {label}
    </span>
  );
}
