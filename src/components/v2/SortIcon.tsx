/**
 * SortIcon - Reusable sort direction indicator
 *
 * Shows arrow up/down based on current sort state, or neutral icon if not sorted by this field.
 */

import { Icon } from '@iconify/react';

interface SortIconProps<T extends string> {
  field: T;
  sortField: T;
  sortDir: 'asc' | 'desc';
}

export function SortIcon<T extends string>({ field, sortField, sortDir }: SortIconProps<T>) {
  if (sortField !== field) {
    return <Icon icon="mdi:unfold-more-horizontal" className="w-4 h-4 opacity-30" />;
  }
  return sortDir === 'asc' ? (
    <Icon icon="mdi:arrow-up" className="w-4 h-4" />
  ) : (
    <Icon icon="mdi:arrow-down" className="w-4 h-4" />
  );
}
