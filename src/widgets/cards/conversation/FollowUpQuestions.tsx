/**
 * FollowUpQuestions — Meeting companion cards + follow-up prompts
 *
 * Displays:
 * 1. Meeting companion cards (questions, insights, decisions, actions) streamed
 *    from ChatGPT via the Chrome extension — updates live as ChatGPT streams.
 * 2. Ramble-generated follow-up questions from DB / questions widget.
 */

import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { loadQuestionsFromStorage, type Question } from '../../on-demand/questions/process';
import { eventBus, type EventPayloads } from '../../../lib/eventBus';

type MeetingCard = EventPayloads['ext:meeting-cards']['cards'][number];

const CARD_CONFIG: Record<string, { icon: string; iconColor: string; iconBg: string; gradientFrom: string }> = {
  question:      { icon: 'mdi:information-outline',      iconColor: 'text-blue-600',   iconBg: 'bg-blue-50',   gradientFrom: 'from-blue-50/60' },
  insight:       { icon: 'mdi:lightbulb-outline',        iconColor: 'text-amber-600',  iconBg: 'bg-amber-50',  gradientFrom: 'from-amber-50/60' },
  decision:      { icon: 'mdi:check-circle-outline',     iconColor: 'text-green-600',  iconBg: 'bg-green-50',  gradientFrom: 'from-green-50/60' },
  action_item:   { icon: 'mdi:alert-outline',            iconColor: 'text-orange-600', iconBg: 'bg-orange-50', gradientFrom: 'from-orange-50/60' },
  summary_point: { icon: 'mdi:text-box-outline',         iconColor: 'text-teal-600',   iconBg: 'bg-teal-50/50', gradientFrom: 'from-teal-50/30' },
};

export function FollowUpQuestions() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [meetingCards, setMeetingCards] = useState<MeetingCard[]>([]);
  const [meetingStatus, setMeetingStatus] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  // Load follow-up questions from DB on mount
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadQuestionsFromStorage().then(stored => {
      if (stored?.questions) setQuestions(stored.questions);
    }).catch(() => {});
  }, []);

  // Listen for follow-up question updates
  useEffect(() => {
    return eventBus.on('questions:updated', ({ questions: updated }) => {
      setQuestions(updated as Question[]);
    });
  }, []);

  // Listen for meeting companion cards from Chrome extension
  useEffect(() => {
    const applyCards = (detail: any) => {
      if (!detail) return;
      setMeetingStatus(detail.status);
      setMeetingCards(detail.cards || []);
    };

    // Read stored value in case events fired before mount
    const stored = (window as any).__rambleMeetingCards;
    if (stored) applyCards(stored);

    const handler = (e: Event) => applyCards((e as CustomEvent).detail);
    window.addEventListener('ramble:ext:meeting-cards', handler);
    return () => window.removeEventListener('ramble:ext:meeting-cards', handler);
  }, []);

  const hasMeetingCards = meetingCards.length > 0 || meetingStatus === 'waiting';
  const hasQuestions = questions.length > 0;

  if (!hasMeetingCards && !hasQuestions) return null;

  return (
    <div className="mt-4 mb-2 px-1 space-y-3">
      {/* Meeting companion cards */}
      {hasMeetingCards && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-base-content/30">
            <Icon icon="mdi:brain" className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">
              {meetingStatus === 'summary' ? 'Meeting Summary' : 'Meeting Companion'}
            </span>
          </div>

          {meetingStatus === 'waiting' && meetingCards.length === 0 ? (
            <div className="text-xs text-base-content/30 italic">Listening...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {meetingCards.map((card, i) => {
                const cfg = CARD_CONFIG[card.type] || CARD_CONFIG.insight;
                const label = card.type === 'action_item' ? 'Action'
                  : card.type === 'summary_point' ? 'Summary'
                  : card.type.charAt(0).toUpperCase() + card.type.slice(1);
                return (
                  <div
                    key={`${card.type}-${i}`}
                    className={`relative overflow-hidden rounded-xl bg-gradient-to-r ${cfg.gradientFrom} to-white
                               border border-base-300/20 px-3 py-2.5 shadow-sm`}
                  >
                    {/* Top row: number + type label + category */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[10px] font-medium ${cfg.iconColor} opacity-40`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`text-[10px] font-medium uppercase tracking-wider ${cfg.iconColor}`}>
                        {label}
                      </span>
                      {card.category && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-base-content/[0.06] text-base-content/50 ml-auto">
                          {card.category.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    {/* Content text — the main focus */}
                    <div className="text-[13px] leading-snug text-base-content/80">
                      {card.text}
                    </div>
                    {card.reasoning && (
                      <div className="text-[11px] text-base-content/35 mt-1">
                        {card.reasoning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Follow-up questions (from Ramble's own question generation) */}
      {hasQuestions && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-base-content/30">
            <Icon icon="mdi:comment-question-outline" className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">Follow-up</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((q) => (
              <div
                key={q.id}
                className="px-3 py-1.5 text-xs text-base-content/60 bg-base-200/50 rounded-full
                           border border-base-300/30 leading-snug"
              >
                {q.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
