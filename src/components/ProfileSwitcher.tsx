/**
 * Profile Switcher
 *
 * Global component for switching between user profiles.
 * Triggered by Alt+U keyboard shortcut.
 * Lists all existing profiles by scanning IndexedDB databases.
 */

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { User, X, Check } from 'lucide-react';
import { getCurrentProfile, navigateToProfile } from '../lib/profile';

export interface ProfileSwitcherRef {
	open: () => void;
	close: () => void;
	toggle: () => void;
}

interface ProfileInfo {
	name: string;
	displayName: string;
	isCurrent: boolean;
}

/**
 * Get all profile names by scanning IndexedDB databases
 * Databases are named: ramble_v3 (default) or ramble_v3_{profile}
 */
async function getAllProfiles(): Promise<ProfileInfo[]> {
	const currentProfile = getCurrentProfile();
	const profiles: ProfileInfo[] = [];

	try {
		// indexedDB.databases() returns list of all databases
		if ('databases' in indexedDB) {
			const databases = await indexedDB.databases();

			for (const db of databases) {
				if (!db.name) continue;

				// Match ramble_v3 or ramble_v3_{profile}
				if (db.name === 'ramble_v3') {
					profiles.push({
						name: 'default',
						displayName: 'Default',
						isCurrent: currentProfile === 'default',
					});
				} else if (db.name.startsWith('ramble_v3_')) {
					const profileName = db.name.replace('ramble_v3_', '');
					profiles.push({
						name: profileName,
						displayName: profileName.charAt(0).toUpperCase() + profileName.slice(1),
						isCurrent: currentProfile === profileName,
					});
				}
			}
		}
	} catch (error) {
		console.warn('Failed to list IndexedDB databases:', error);
	}

	// Sort: current profile first, then alphabetically
	return profiles.sort((a, b) => {
		if (a.isCurrent) return -1;
		if (b.isCurrent) return 1;
		return a.displayName.localeCompare(b.displayName);
	});
}

export const ProfileSwitcher = forwardRef<ProfileSwitcherRef>(function ProfileSwitcher(_, ref) {
	const [isOpen, setIsOpen] = useState(false);
	const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
	const [loading, setLoading] = useState(false);

	// Load profiles when opened
	const loadProfiles = useCallback(async () => {
		setLoading(true);
		const profileList = await getAllProfiles();
		setProfiles(profileList);
		setLoading(false);
	}, []);

	// Open the switcher
	const open = useCallback(() => {
		setIsOpen(true);
		loadProfiles();
	}, [loadProfiles]);

	// Close the switcher
	const close = useCallback(() => {
		setIsOpen(false);
	}, []);

	// Toggle the switcher
	const toggle = useCallback(() => {
		if (isOpen) {
			close();
		} else {
			open();
		}
	}, [isOpen, open, close]);

	// Expose methods via ref
	useImperativeHandle(ref, () => ({
		open,
		close,
		toggle,
	}), [open, close, toggle]);

	// Handle profile selection
	const selectProfile = useCallback((profile: ProfileInfo) => {
		if (profile.isCurrent) {
			close();
			return;
		}
		navigateToProfile(profile.name);
	}, [close]);

	// Listen for Escape to close
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && isOpen) {
				close();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, close]);

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={close}
			/>

			{/* Modal */}
			<div className="relative bg-base-100 rounded-lg shadow-xl w-full max-w-sm mx-4 overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-base-200">
					<div className="flex items-center gap-2">
						<User size={18} className="text-primary" />
						<h2 className="text-sm font-semibold">Switch Profile</h2>
					</div>
					<button
						onClick={close}
						className="p-1 hover:bg-base-200 rounded transition-colors"
					>
						<X size={16} className="text-base-content/60" />
					</button>
				</div>

				{/* Profile List */}
				<div className="max-h-64 overflow-auto">
					{loading ? (
						<div className="flex items-center justify-center py-8">
							<span className="loading loading-spinner loading-sm text-primary" />
						</div>
					) : profiles.length === 0 ? (
						<div className="text-center py-8 text-base-content/50 text-sm">
							No profiles found
						</div>
					) : (
						<div className="py-1">
							{profiles.map((profile) => (
								<button
									key={profile.name}
									onClick={() => selectProfile(profile)}
									className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-base-200 transition-colors text-left ${
										profile.isCurrent ? 'bg-primary/10' : ''
									}`}
								>
									<div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
										<span className="text-sm font-medium text-primary">
											{profile.displayName.charAt(0).toUpperCase()}
										</span>
									</div>
									<div className="flex-1 min-w-0">
										<div className="text-sm font-medium truncate">
											{profile.displayName}
										</div>
										<div className="text-xs text-base-content/50">
											{profile.name === 'default' ? '/' : `/u/${profile.name}`}
										</div>
									</div>
									{profile.isCurrent && (
										<Check size={16} className="text-primary flex-shrink-0" />
									)}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Footer hint */}
				<div className="px-4 py-2 border-t border-base-200 bg-base-200/30">
					<p className="text-[10px] text-base-content/40 text-center">
						Press <kbd className="px-1 py-0.5 bg-base-300 rounded text-[9px]">{navigator.platform.includes('Mac') ? '⌥ Option' : 'Alt'}</kbd> + <kbd className="px-1 py-0.5 bg-base-300 rounded text-[9px]">U</kbd> to toggle
					</p>
				</div>
			</div>
		</div>
	);
});
