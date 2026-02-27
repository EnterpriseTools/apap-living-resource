'use client';

import React from 'react';

const thBase: React.CSSProperties = {
  padding: '0.75rem',
  fontWeight: 'var(--text-subtitle-weight)',
  borderBottom: '1px solid var(--border-color)',
  color: 'var(--fg-primary)',
};

const tdBase: React.CSSProperties = {
  padding: '0.75rem',
  color: 'var(--fg-primary)',
  fontSize: 'var(--text-body2-size)',
};

export type DataTableColumn<T> = {
  id: string;
  label: React.ReactNode;
  align?: 'left' | 'right';
  headerTooltip?: string;
  render: (row: T) => React.ReactNode;
  sortKey?: string;
  width?: string | number;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  sortField?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  onSort?: (field: string) => void;
  getSortIcon?: (field: string) => React.ReactNode;
  /** Must return React.CSSProperties (object), not a string. */
  rowStyle?: (row: T) => React.CSSProperties;
  expandableRow?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  showIndex?: boolean;
  /** When showIndex is true, first row displays startIndex + 1 (for multi-table running index). */
  startIndex?: number;
  /** Controlled expansion: when both provided, expansion is controlled by parent. */
  expandedRowId?: string | null;
  onExpandedRowChange?: (id: string | null) => void;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  sortField,
  sortDirection,
  onSort,
  getSortIcon,
  rowStyle,
  expandableRow,
  emptyMessage = 'No rows match the current filters.',
  showIndex = false,
  startIndex = 0,
  expandedRowId,
  onExpandedRowChange,
}: DataTableProps<T>) {
  const [internalExpanded, setInternalExpanded] = React.useState<string | null>(null);
  const isControlled = expandedRowId !== undefined && onExpandedRowChange != null;
  const expandedKey = isControlled ? (expandedRowId ?? null) : internalExpanded;
  const setExpandedKey = isControlled ? onExpandedRowChange : setInternalExpanded;

  const handleHeaderClick = (col: DataTableColumn<T>) => {
    if (col.sortKey && onSort) onSort(col.sortKey);
  };

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-body2-size)' }}>
        <thead>
          <tr style={{ background: 'var(--surface-2)' }}>
            {showIndex && (
              <th style={{ ...thBase, textAlign: 'right', width: '2.5rem' }}>#</th>
            )}
            {columns.map((col) => {
              const isSortable = col.sortKey && onSort;
              const header = col.headerTooltip != null ? (
                <span title={col.headerTooltip} style={{ borderBottom: '1px dotted var(--fg-secondary)', cursor: 'help' }}>
                  {col.label}
                </span>
              ) : (
                col.label
              );
              return (
                <th
                  key={col.id}
                  onClick={isSortable ? () => handleHeaderClick(col) : undefined}
                  style={{
                    ...thBase,
                    textAlign: col.align ?? 'left',
                    cursor: isSortable ? 'pointer' : undefined,
                    userSelect: isSortable ? 'none' : undefined,
                    width: col.width,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {header}
                    {isSortable && getSortIcon && getSortIcon(col.sortKey!)}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = getRowKey(row);
            const isExpanded = expandableRow && expandedKey === key;
            return (
              <React.Fragment key={key}>
                <tr
                  onClick={expandableRow ? () => setExpandedKey(isExpanded ? null : key) : undefined}
                  style={{
                    cursor: expandableRow ? 'pointer' : undefined,
                    borderBottom: '1px solid var(--border-color)',
                    ...rowStyle?.(row),
                    ...(isExpanded ? { background: 'var(--surface-2)' } : {}),
                  }}
                >
                  {showIndex && (
                    <td style={{ ...tdBase, textAlign: 'right', color: 'var(--fg-secondary)', fontSize: 'var(--text-caption-size)' }}>
                      {startIndex + index + 1}
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      style={{ ...tdBase, textAlign: col.align ?? 'left', fontSize: col.width ? 'var(--text-caption-size)' : undefined }}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {isExpanded && expandableRow && (
                  <tr>
                    <td colSpan={(showIndex ? 1 : 0) + columns.length} style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', background: 'var(--surface-2)' }}>
                      {expandableRow(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-secondary)' }}>
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
