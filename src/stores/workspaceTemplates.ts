/**
 * Workspace Templates — Built-in layout factories for the workspace system.
 *
 * Each template defines a named BentoTree layout suited for a particular workflow.
 * Templates are used when creating new workspaces and for "Reset to Default" on built-in workspaces.
 */

import type { BentoTree, SplitNode, LeafNode } from '../components/bento/types';
import { generateId } from '../components/bento/utils';

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;           // Iconify icon name, e.g. "mdi:view-grid"
  createTree: () => BentoTree;
}

// ---------------------------------------------------------------------------
// Helper: build a leaf node
// ---------------------------------------------------------------------------
const leaf = (
  id: string,
  parent: string,
  widgetType: LeafNode['widgetType'],
  content: string,
): LeafNode => ({
  id,
  type: 'leaf',
  parent,
  content,
  color: 'bg-white',
  widgetType,
});

// ---------------------------------------------------------------------------
// Default — 2×2: VoiceRecorder | Conversation / Goals | Memories
// ---------------------------------------------------------------------------
const createDefaultTree = (): BentoTree => {
  const rootId = generateId();
  const topRowId = generateId();
  const bottomRowId = generateId();
  const voiceRecorderId = generateId();
  const conversationId = generateId();
  const goalsId = generateId();
  const memoriesId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'vertical', ratio: 0.5,
        first: topRowId, second: bottomRowId,
      } as SplitNode,
      [topRowId]: {
        id: topRowId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.5,
        first: voiceRecorderId, second: conversationId,
      } as SplitNode,
      [bottomRowId]: {
        id: bottomRowId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.5,
        first: goalsId, second: memoriesId,
      } as SplitNode,
      [voiceRecorderId]: leaf(voiceRecorderId, topRowId, 'voice-recorder', 'Voice Recorder'),
      [conversationId]: leaf(conversationId, topRowId, 'conversation', 'Conversation'),
      [goalsId]: leaf(goalsId, bottomRowId, 'goals', 'Goals'),
      [memoriesId]: leaf(memoriesId, bottomRowId, 'memories', 'Memories'),
    },
  };
};

// ---------------------------------------------------------------------------
// Focus — VoiceRecorder (30%) | Conversation (70%)
// ---------------------------------------------------------------------------
const createFocusTree = (): BentoTree => {
  const rootId = generateId();
  const voiceId = generateId();
  const convId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.3,
        first: voiceId, second: convId,
      } as SplitNode,
      [voiceId]: leaf(voiceId, rootId, 'voice-recorder', 'Voice Recorder'),
      [convId]: leaf(convId, rootId, 'conversation', 'Conversation'),
    },
  };
};

// ---------------------------------------------------------------------------
// Meeting — 2×2: MeetingTranscription | Conversation / Suggestions | Questions
// ---------------------------------------------------------------------------
const createMeetingTree = (): BentoTree => {
  const rootId = generateId();
  const topRowId = generateId();
  const bottomRowId = generateId();
  const transcriptionId = generateId();
  const conversationId = generateId();
  const suggestionsId = generateId();
  const questionsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'vertical', ratio: 0.5,
        first: topRowId, second: bottomRowId,
      } as SplitNode,
      [topRowId]: {
        id: topRowId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.5,
        first: transcriptionId, second: conversationId,
      } as SplitNode,
      [bottomRowId]: {
        id: bottomRowId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.5,
        first: suggestionsId, second: questionsId,
      } as SplitNode,
      [transcriptionId]: leaf(transcriptionId, topRowId, 'meeting-transcription', 'Meeting Transcription'),
      [conversationId]: leaf(conversationId, topRowId, 'conversation', 'Conversation'),
      [suggestionsId]: leaf(suggestionsId, bottomRowId, 'suggestions', 'Suggestions'),
      [questionsId]: leaf(questionsId, bottomRowId, 'questions', 'Questions'),
    },
  };
};

// ---------------------------------------------------------------------------
// Coaching — (VoiceRecorder / SpeakBetter) | (Conversation / LearnedCorrections)
// ---------------------------------------------------------------------------
const createCoachingTree = (): BentoTree => {
  const rootId = generateId();
  const leftColId = generateId();
  const rightColId = generateId();
  const voiceId = generateId();
  const speakBetterId = generateId();
  const convId = generateId();
  const correctionsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.5,
        first: leftColId, second: rightColId,
      } as SplitNode,
      [leftColId]: {
        id: leftColId, type: 'split', parent: rootId,
        direction: 'vertical', ratio: 0.5,
        first: voiceId, second: speakBetterId,
      } as SplitNode,
      [rightColId]: {
        id: rightColId, type: 'split', parent: rootId,
        direction: 'vertical', ratio: 0.5,
        first: convId, second: correctionsId,
      } as SplitNode,
      [voiceId]: leaf(voiceId, leftColId, 'voice-recorder', 'Voice Recorder'),
      [speakBetterId]: leaf(speakBetterId, leftColId, 'speak-better', 'Speak Better'),
      [convId]: leaf(convId, rightColId, 'conversation', 'Conversation'),
      [correctionsId]: leaf(correctionsId, rightColId, 'learned-corrections', 'Learned Corrections'),
    },
  };
};

// ---------------------------------------------------------------------------
// Public array of all built-in templates
// ---------------------------------------------------------------------------
export const BUILT_IN_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'General purpose — voice, conversation, goals, memories',
    icon: 'mdi:view-grid',
    createTree: createDefaultTree,
  },
  {
    id: 'focus',
    name: 'Focus',
    description: 'Minimal — voice input and conversation side by side',
    icon: 'mdi:target',
    createTree: createFocusTree,
  },
  {
    id: 'meeting',
    name: 'Meeting',
    description: 'Live meeting — transcription, conversation, suggestions, questions',
    icon: 'mdi:account-group',
    createTree: createMeetingTree,
  },
  {
    id: 'coaching',
    name: 'Coaching',
    description: 'Speech improvement — speak better and learned corrections',
    icon: 'mdi:school',
    createTree: createCoachingTree,
  },
];

export const getTemplate = (id: string): WorkspaceTemplate | undefined =>
  BUILT_IN_TEMPLATES.find(t => t.id === id);
