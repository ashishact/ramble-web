/**
 * Signup Modal — Email + password registration
 *
 * Fixed overlay modal (same pattern as ProfileSwitcher).
 * Calls register() from rambleApi on submit.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, Cloud, Share2, Zap } from 'lucide-react';
import { register, login } from '../../services/rambleApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const SignupModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signup' | 'login'>('signup');

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setPassword('');
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;

    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        await register(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [email, password, mode, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-base-100 rounded-lg shadow-xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-200">
          <h2 className="text-sm font-semibold">
            {mode === 'signup' ? 'Create Account' : 'Sign In'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-base-200 rounded transition-colors">
            <X size={16} className="text-base-content/60" />
          </button>
        </div>

        {/* Benefits */}
        <div className="px-4 py-3 space-y-1.5 bg-base-200/30">
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <Cloud size={12} className="text-primary flex-shrink-0" />
            <span>Cloud backup for your data</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <Share2 size={12} className="text-primary flex-shrink-0" />
            <span>Share meeting reports via link</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <Zap size={12} className="text-primary flex-shrink-0" />
            <span>Higher rate limits</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-base-content/60 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-1.5 text-sm bg-base-200 border border-base-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="you@example.com"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-base-content/60 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-1.5 text-sm bg-base-200 border border-base-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </div>

          {error && (
            <div className="text-xs text-error bg-error/10 px-3 py-1.5 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-sm font-medium bg-primary text-primary-content rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Please wait...' : mode === 'signup' ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        {/* Toggle mode */}
        <div className="px-4 py-2 border-t border-base-200 text-center">
          <button
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
            className="text-xs text-primary hover:underline"
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>
    </div>
  );
};
