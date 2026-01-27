/**
 * Profile-Aware LocalStorage Wrapper
 *
 * Namespaces all localStorage keys by the current profile.
 * This ensures complete data isolation between profiles.
 *
 * Usage:
 *   import { profileStorage } from '../lib/profileStorage';
 *
 *   // These are automatically namespaced by profile
 *   profileStorage.setItem('settings', JSON.stringify(data));
 *   const data = profileStorage.getItem('settings');
 *   profileStorage.removeItem('settings');
 *
 * For global settings (same across all profiles), use localStorage directly.
 */

import { getCurrentProfile } from './profile';

/**
 * Get the namespaced key for the current profile
 */
function getNamespacedKey(key: string): string {
  const profile = getCurrentProfile();
  return `ramble:${profile}:${key}`;
}

/**
 * Profile-scoped localStorage wrapper
 */
export const profileStorage = {
  /**
   * Get an item from profile-scoped storage
   */
  getItem(key: string): string | null {
    const namespacedKey = getNamespacedKey(key);
    return localStorage.getItem(namespacedKey);
  },

  /**
   * Set an item in profile-scoped storage
   */
  setItem(key: string, value: string): void {
    const namespacedKey = getNamespacedKey(key);
    localStorage.setItem(namespacedKey, value);
  },

  /**
   * Remove an item from profile-scoped storage
   */
  removeItem(key: string): void {
    const namespacedKey = getNamespacedKey(key);
    localStorage.removeItem(namespacedKey);
  },

  /**
   * Clear all items for the current profile
   */
  clear(): void {
    const profile = getCurrentProfile();
    const prefix = `ramble:${profile}:`;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  },

  /**
   * Get all keys for the current profile (without namespace prefix)
   */
  keys(): string[] {
    const profile = getCurrentProfile();
    const prefix = `ramble:${profile}:`;
    const keys: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key.slice(prefix.length));
      }
    }

    return keys;
  },

  /**
   * Check if a key exists in profile-scoped storage
   */
  hasItem(key: string): boolean {
    return this.getItem(key) !== null;
  },

  /**
   * Get and parse JSON from profile-scoped storage
   */
  getJSON<T>(key: string): T | null {
    const value = this.getItem(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },

  /**
   * Set JSON in profile-scoped storage
   */
  setJSON<T>(key: string, value: T): void {
    this.setItem(key, JSON.stringify(value));
  },
};

// Export for convenience
export default profileStorage;
