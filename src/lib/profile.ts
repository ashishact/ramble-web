/**
 * Profile Management
 *
 * Profiles provide complete data isolation between users.
 * Each profile gets its own WatermelonDB database.
 *
 * URL format: /u/{profile-name}
 * Profile name rules:
 * - Lowercase letters only (a-z)
 * - Numbers allowed (0-9)
 * - Hyphens allowed (-)
 * - No spaces or other characters
 */

const DEFAULT_PROFILE = 'default';
const PROFILE_REGEX = /^[a-z0-9-]+$/;

/**
 * Validate a profile name
 */
export function isValidProfileName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.length > 50) return false; // Reasonable limit
  return PROFILE_REGEX.test(name);
}

/**
 * Extract profile name from URL path
 * Returns 'default' if no profile in URL or invalid profile
 */
export function getProfileFromPath(pathname: string): string {
  // Match /u/{profileName} or /u/{profileName}/...
  const match = pathname.match(/^\/u\/([^/]+)/);

  if (match && match[1]) {
    const profileName = match[1].toLowerCase();
    if (isValidProfileName(profileName)) {
      return profileName;
    }
  }

  return DEFAULT_PROFILE;
}

/**
 * Get the current profile from window.location
 */
export function getCurrentProfile(): string {
  return getProfileFromPath(window.location.pathname);
}

/**
 * Generate database name for a profile
 */
export function getDatabaseName(profile: string): string {
  if (profile === DEFAULT_PROFILE) {
    return 'ramble_v3'; // Keep existing name for default profile (backward compatibility)
  }
  return `ramble_v3_${profile}`;
}

/**
 * Build URL path for a profile
 */
export function getProfilePath(profile: string, subPath: string = ''): string {
  if (profile === DEFAULT_PROFILE) {
    return subPath || '/';
  }
  return `/u/${profile}${subPath}`;
}

/**
 * Check if current URL is for the default profile
 */
export function isDefaultProfile(): boolean {
  return getCurrentProfile() === DEFAULT_PROFILE;
}

/**
 * Redirect to a profile
 */
export function navigateToProfile(profile: string, subPath: string = ''): void {
  const path = getProfilePath(profile, subPath);
  window.location.href = path;
}

export { DEFAULT_PROFILE };
