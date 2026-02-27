'use client';

import React from 'react';
import { Search, Filter } from 'lucide-react';

const searchInputStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem 0.5rem 2.5rem',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-body1-size)',
  background: 'var(--surface-4)',
  color: 'var(--fg-primary)',
  width: '100%',
};

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.5rem 0.5rem 2.5rem',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-body1-size)',
  background: 'var(--surface-4)',
  color: 'var(--fg-primary)',
};

export type FilterBarFilter = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
};

export type FilterBarProps = {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterBarFilter[];
  children?: React.ReactNode;
};

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search agency name or ID...',
  filters = [],
  children,
}: FilterBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        padding: '1rem',
        background: 'var(--surface-2)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
      }}
    >
      <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
        <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-secondary)' }} />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          style={searchInputStyle}
        />
      </div>
      {filters.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Filter size={18} style={{ color: 'var(--fg-secondary)' }} />
          {filters.map((f) => (
            <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <label style={{ fontSize: 'var(--text-caption-size)', color: 'var(--fg-secondary)' }}>{f.label}</label>
              <select value={f.value} onChange={(e) => f.onChange(e.target.value)} style={selectStyle}>
                {f.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
