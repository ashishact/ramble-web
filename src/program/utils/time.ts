/**
 * Time Utilities
 *
 * Common time-related functions for the program system.
 */

/**
 * Get current Unix timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Get Unix timestamp for a date N days ago
 */
export function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Get Unix timestamp for a date N hours ago
 */
export function hoursAgo(hours: number): number {
  return Date.now() - hours * 60 * 60 * 1000;
}

/**
 * Get Unix timestamp for a date N minutes ago
 */
export function minutesAgo(minutes: number): number {
  return Date.now() - minutes * 60 * 1000;
}

/**
 * Calculate days since a timestamp
 */
export function daysSince(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

/**
 * Calculate hours since a timestamp
 */
export function hoursSince(timestamp: number): number {
  return Math.floor((Date.now() - timestamp) / (60 * 60 * 1000));
}

/**
 * Calculate exponential decay factor
 * Returns a value between 0 and 1, where 1 is no decay
 */
export function exponentialDecay(timestamp: number, halfLifeMs: number): number {
  const elapsed = Date.now() - timestamp;
  return Math.exp((-elapsed * Math.LN2) / halfLifeMs);
}

/**
 * Common half-life constants
 */
export const HALF_LIFE = {
  ONE_HOUR: 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Format a timestamp as ISO date string (YYYY-MM-DD)
 */
export function toDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0];
}

/**
 * Format a timestamp as relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  const weeks = Math.floor(days / 7);
  if (weeks < 4) {
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }

  return toDateString(timestamp);
}
