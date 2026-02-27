'use client';

import { useState, useMemo } from 'react';

export type UseTableStateOptions<T> = {
  rows: T[];
  getSearchableText: (row: T) => string;
  initialSortField?: string;
  initialSortDirection?: 'asc' | 'desc';
  getComparator: (field: string) => (a: T, b: T) => number;
};

export function useTableState<T>({
  rows,
  getSearchableText,
  initialSortField,
  initialSortDirection = 'asc',
  getComparator,
}: UseTableStateOptions<T>) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<string | undefined>(initialSortField);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSortDirection);

  const filteredSortedRows = useMemo(() => {
    let result = rows;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter((row) => getSearchableText(row).toLowerCase().includes(q));
    }
    if (sortField) {
      const comparator = getComparator(sortField);
      result = [...result].sort((a, b) => {
        const cmp = comparator(a, b);
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [rows, searchTerm, sortField, sortDirection, getSearchableText, getComparator]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return {
    filteredSortedRows,
    searchTerm,
    setSearchTerm,
    sortField: sortField ?? null,
    sortDirection,
    setSortField,
    setSortDirection,
    handleSort,
  };
}
