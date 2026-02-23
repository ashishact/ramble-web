import { useState } from 'react';
import { X } from 'lucide-react';
import { type MeetingSettings, saveMeetingSettings } from './process';

interface Props {
  initialSettings: MeetingSettings;
  onClose: (saved: MeetingSettings) => void;
}

export function SettingsPanel({ initialSettings, onClose }: Props) {
  const [userName, setUserName] = useState(initialSettings.userName);
  const [meetingContext, setMeetingContext] = useState(initialSettings.meetingContext);

  function handleSave() {
    const updated: MeetingSettings = { userName: userName.trim(), meetingContext: meetingContext.trim() };
    saveMeetingSettings(updated);
    onClose(updated);
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-base-content">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-base-200 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-base-content/70">Meeting Settings</span>
        <button
          onClick={handleSave}
          className="p-1 hover:bg-base-200 rounded transition-colors"
          title="Save and close"
        >
          <X size={13} className="text-base-content/50" />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto px-3 py-3 space-y-4">
        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-widest text-base-content/40">
            Your Name
          </label>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="e.g. Alex"
            className="w-full bg-base-200/50 border border-base-300 rounded-lg px-2.5 py-1.5 text-[11px] text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <p className="text-[9px] text-base-content/30 leading-relaxed">
            Used to label your microphone in summaries and action items.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-widest text-base-content/40">
            Meeting Context
          </label>
          <textarea
            value={meetingContext}
            onChange={(e) => setMeetingContext(e.target.value)}
            placeholder="e.g. Weekly 1:1 with manager, quarterly planning call, client onboarding..."
            rows={3}
            className="w-full bg-base-200/50 border border-base-300 rounded-lg px-2.5 py-1.5 text-[11px] text-base-content placeholder:text-base-content/30 focus:outline-none focus:border-primary/50 resize-none"
          />
          <p className="text-[9px] text-base-content/30 leading-relaxed">
            Brief description of this meeting type. Helps the AI give better summaries and next steps.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="w-full py-1.5 bg-primary/10 hover:bg-primary/20 border border-primary/25 rounded-lg text-[11px] font-medium text-primary transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
