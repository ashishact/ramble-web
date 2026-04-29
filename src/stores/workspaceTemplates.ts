/**
 * Workspace Templates — Built-in layout factories for the workspace system.
 */

import type { BentoTree, SplitNode, LeafNode } from '../components/bento/types';
import { generateId } from '../components/bento/utils';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  createTree: () => BentoTree;
}

const leaf = (
  id: string,
  parent: string,
  widgetType: LeafNode['widgetType'],
  content: string,
  color = 'bg-white',
): LeafNode => ({ id, type: 'leaf', parent, content, color, widgetType });

// ---------------------------------------------------------------------------
// Default — Voice (left) | Conversation (right)
// ---------------------------------------------------------------------------
const createDefaultTree = (): BentoTree => {
  const rootId = generateId();
  const voiceId = generateId();
  const conversationId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.25,
        first: voiceId, second: conversationId,
      } as SplitNode,
      [voiceId]: leaf(voiceId, rootId, 'voice-recorder', 'Voice Recorder', 'bg-slate-50'),
      [conversationId]: leaf(conversationId, rootId, 'conversation', 'Conversation', 'bg-pink-50'),
    },
  };
};

// ---------------------------------------------------------------------------
// Focus — Conversation (75%) | Goals (25%)
// ---------------------------------------------------------------------------
const createFocusTree = (): BentoTree => {
  const rootId = generateId();
  const convId = generateId();
  const goalsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.74,
        first: convId, second: goalsId,
      } as SplitNode,
      [convId]: leaf(convId, rootId, 'conversation', 'Conversation'),
      [goalsId]: leaf(goalsId, rootId, 'goals', 'Goals', 'bg-zinc-50'),
    },
  };
};

// ---------------------------------------------------------------------------
// Meeting — Transcription (66%) | Entities / Goals (stacked)
// ---------------------------------------------------------------------------
const createMeetingTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const transcriptionId = generateId();
  const entitiesId = generateId();
  const goalsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.66,
        first: transcriptionId, second: rightSplitId,
      } as SplitNode,
      [rightSplitId]: {
        id: rightSplitId, type: 'split', parent: rootId,
        direction: 'vertical', ratio: 0.50,
        first: entitiesId, second: goalsId,
      } as SplitNode,
      [transcriptionId]: leaf(transcriptionId, rootId, 'meeting-transcription', 'Meeting Transcription'),
      [entitiesId]: leaf(entitiesId, rightSplitId, 'entities', 'Entities', 'bg-emerald-50'),
      [goalsId]: leaf(goalsId, rightSplitId, 'goals', 'Goals', 'bg-purple-50'),
    },
  };
};

// ---------------------------------------------------------------------------
// Speak Better — Conversation | Speak Better / TTS
// ---------------------------------------------------------------------------
const createSpeakBetterTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const conversationId = generateId();
  const speakBetterId = generateId();
  const ttsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.55,
        first: conversationId, second: rightSplitId,
      } as SplitNode,
      [rightSplitId]: {
        id: rightSplitId, type: 'split', parent: rootId,
        direction: 'vertical', ratio: 0.60,
        first: speakBetterId, second: ttsId,
      } as SplitNode,
      [conversationId]: leaf(conversationId, rootId, 'conversation', 'Conversation', 'bg-pink-50'),
      [speakBetterId]: leaf(speakBetterId, rightSplitId, 'speak-better', 'Speak Better', 'bg-rose-50'),
      [ttsId]: leaf(ttsId, rightSplitId, 'tts', 'TTS', 'bg-orange-50'),
    },
  };
};

export const BUILT_IN_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Voice input with conversation',
    icon: 'streamline-ultimate-color:dropbox-logo',
    createTree: createDefaultTree,
  },
  {
    id: 'focus',
    name: 'Focus',
    description: 'Minimal — conversation with goals',
    icon: 'solar:music-notes-broken',
    createTree: createFocusTree,
  },
  {
    id: 'meeting',
    name: 'Meeting',
    description: 'Live meeting transcription',
    icon: 'streamline-ultimate-color:team-meeting',
    createTree: createMeetingTree,
  },
  {
    id: 'speak-better',
    name: 'Speak Better',
    description: 'Speech improvement with TTS',
    icon: 'emojione:speak-no-evil-monkey',
    createTree: createSpeakBetterTree,
  },
];

export const getTemplate = (id: string): WorkspaceTemplate | undefined =>
  BUILT_IN_TEMPLATES.find(t => t.id === id);
