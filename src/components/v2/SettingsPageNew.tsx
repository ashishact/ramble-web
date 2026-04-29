import { useState, useCallback, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { settingsHelpers, type AppSettings } from '../../stores/settingsStore';
import { getActiveProfile } from '../../db';
import { getDatabaseName } from '../../lib/profile';

type SettingsCategory = 'database' | 'advanced';

const CATEGORIES = [
  { id: 'database' as const, name: 'Database', icon: 'mdi:database', description: 'Database information' },
  { id: 'advanced' as const, name: 'Advanced', icon: 'mdi:cog', description: 'Advanced settings and danger zone' },
];

export function SettingsPageNew({ onBack }: { onBack: () => void }) {
  const [selectedCategory, setSelectedCategory] = useState<SettingsCategory>('database');
  const [settings, setSettings] = useState<AppSettings>(settingsHelpers.getSettings);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    return settingsHelpers.subscribe(setSettings);
  }, []);

  const showSavedMessage = useCallback(() => {
    setSavedMessage('Settings saved');
    setTimeout(() => setSavedMessage(null), 2000);
  }, []);

  const handleReset = useCallback(() => {
    if (window.confirm('Are you sure you want to reset all settings?')) {
      settingsHelpers.reset();
      showSavedMessage();
    }
  }, [showSavedMessage]);

  return (
    <div className="h-screen flex flex-col bg-base-100">
      <div className="navbar bg-base-200 border-b border-base-300 flex-shrink-0">
        <div className="flex-none">
          <button onClick={onBack} className="btn btn-ghost btn-circle">
            <Icon icon="mdi:arrow-left" className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Settings</h1>
        </div>
        {savedMessage && (
          <div className="badge badge-success gap-2">
            <Icon icon="mdi:check" className="w-4 h-4" />
            {savedMessage}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 bg-base-200 border-r border-base-300 overflow-y-auto">
          <div className="menu p-2">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`flex items-start gap-3 px-4 py-3 rounded-lg transition-colors ${
                  selectedCategory === category.id ? 'bg-primary text-primary-content' : 'hover:bg-base-300'
                }`}
              >
                <Icon icon={category.icon} className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-left flex-1">
                  <div className="font-medium">{category.name}</div>
                  <div className={`text-xs mt-0.5 ${selectedCategory === category.id ? 'opacity-90' : 'opacity-60'}`}>
                    {category.description}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {selectedCategory === 'database' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Database Management</h2>
                <p className="text-sm text-base-content/60 mt-1">View database information</p>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Database Info</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Profile:</span>
                      <span className="font-mono">{getActiveProfile()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Database Name:</span>
                      <span className="font-mono">{getDatabaseName(getActiveProfile())}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-base-content/60">Storage:</span>
                      <span className="font-mono">IndexedDB (WatermelonDB)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card bg-base-200">
                <div className="card-body">
                  <h3 className="card-title">Tables</h3>
                  <div className="text-sm text-base-content/60 space-y-1">
                    <p><strong>Core:</strong> sessions, conversations, tasks</p>
                    <p><strong>Knowledge:</strong> entities, topics, memories, insights, goals</p>
                    <p><strong>System:</strong> plugins, corrections, extraction_logs</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedCategory === 'advanced' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Advanced Settings</h2>
                <p className="text-sm text-base-content/60 mt-1">System controls</p>
              </div>

              <div className="card bg-base-100 shadow-md">
                <div className="card-body">
                  <h2 className="card-title text-lg flex items-center gap-2">
                    <Icon icon="mdi:text-box-check" className="w-5 h-5" />
                    Input Review
                  </h2>
                  <p className="text-sm text-base-content/60 mb-4">
                    When disabled, Ramble Native transcriptions are submitted directly without a review step.
                  </p>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary"
                      checked={settings.reviewEnabled}
                      onChange={(e) => settingsHelpers.setReviewEnabled(e.target.checked)}
                    />
                    <span className="text-sm">Review Ramble Native transcriptions before submitting</span>
                  </label>
                </div>
              </div>

              <div className="card bg-base-100 shadow-md border border-error/20">
                <div className="card-body">
                  <h2 className="card-title text-lg flex items-center gap-2 text-error">
                    <Icon icon="mdi:alert-octagon" className="w-5 h-5" />
                    Danger Zone
                  </h2>
                  <p className="text-sm text-base-content/60 mb-4">These actions cannot be undone.</p>
                  <button onClick={handleReset} className="btn btn-error gap-2">
                    <Icon icon="mdi:restore" className="w-5 h-5" />
                    Reset All Settings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
