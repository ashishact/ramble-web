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
  icon: string;           // Iconify icon name
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
  color = 'bg-white',
): LeafNode => ({
  id,
  type: 'leaf',
  parent,
  content,
  color,
  widgetType,
});

// ---------------------------------------------------------------------------
// Default — Questions (narrow) | Conversation (wide) | Suggestions (narrow)
// ---------------------------------------------------------------------------
const createDefaultTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const questionsId = generateId();
  const conversationId = generateId();
  const suggestionsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.19,
        first: questionsId, second: rightSplitId,
      } as SplitNode,
      [rightSplitId]: {
        id: rightSplitId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.70,
        first: conversationId, second: suggestionsId,
      } as SplitNode,
      [questionsId]: leaf(questionsId, rootId, 'questions', 'Questions', 'bg-slate-50'),
      [conversationId]: leaf(conversationId, rightSplitId, 'conversation', 'Conversation', 'bg-pink-50'),
      [suggestionsId]: leaf(suggestionsId, rightSplitId, 'suggestions', 'Suggestions', 'bg-blue-50'),
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
// Conversation — Questions | Conversation | Suggestions | Goals (narrow)
// ---------------------------------------------------------------------------
const createConversationTree = (): BentoTree => {
  const rootId = generateId();
  const leftSplitId = generateId();
  const middleSplitId = generateId();
  const questionsId = generateId();
  const conversationId = generateId();
  const suggestionsId = generateId();
  const goalsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.82,
        first: leftSplitId, second: goalsId,
      } as SplitNode,
      [leftSplitId]: {
        id: leftSplitId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.28,
        first: questionsId, second: middleSplitId,
      } as SplitNode,
      [middleSplitId]: {
        id: middleSplitId, type: 'split', parent: leftSplitId,
        direction: 'horizontal', ratio: 0.69,
        first: conversationId, second: suggestionsId,
      } as SplitNode,
      [questionsId]: leaf(questionsId, leftSplitId, 'questions', 'Questions', 'bg-purple-50'),
      [conversationId]: leaf(conversationId, middleSplitId, 'conversation', 'Conversation'),
      [suggestionsId]: leaf(suggestionsId, middleSplitId, 'suggestions', 'Suggestions'),
      [goalsId]: leaf(goalsId, rootId, 'goals', 'Goals'),
    },
  };
};

// ---------------------------------------------------------------------------
// Meeting — Meeting Transcription (66%) | Questions / Suggestions (stacked)
// ---------------------------------------------------------------------------
const createMeetingTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const transcriptionId = generateId();
  const questionsId = generateId();
  const suggestionsId = generateId();

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
        first: questionsId, second: suggestionsId,
      } as SplitNode,
      [transcriptionId]: leaf(transcriptionId, rootId, 'meeting-transcription', 'Meeting Transcription'),
      [questionsId]: leaf(questionsId, rightSplitId, 'questions', 'Questions', 'bg-emerald-50'),
      [suggestionsId]: leaf(suggestionsId, rightSplitId, 'suggestions', 'Suggestions', 'bg-purple-50'),
    },
  };
};

// ---------------------------------------------------------------------------
// Debug — Conversation | Context/Stats | Memories/Meta Query
// ---------------------------------------------------------------------------
const createDebugTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const midColId = generateId();
  const farColId = generateId();
  const conversationId = generateId();
  const contextId = generateId();
  const statsId = generateId();
  const memoriesId = generateId();
  const metaQueryId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.33,
        first: conversationId, second: rightSplitId,
      } as SplitNode,
      [rightSplitId]: {
        id: rightSplitId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.30,
        first: midColId, second: farColId,
      } as SplitNode,
      [midColId]: {
        id: midColId, type: 'split', parent: rightSplitId,
        direction: 'vertical', ratio: 0.60,
        first: contextId, second: statsId,
      } as SplitNode,
      [farColId]: {
        id: farColId, type: 'split', parent: rightSplitId,
        direction: 'horizontal', ratio: 0.47,
        first: memoriesId, second: metaQueryId,
      } as SplitNode,
      [conversationId]: leaf(conversationId, rootId, 'conversation', 'Conversation'),
      [contextId]: leaf(contextId, midColId, 'working-memory', 'Context'),
      [statsId]: leaf(statsId, midColId, 'stats', 'Stats', 'bg-zinc-50'),
      [memoriesId]: leaf(memoriesId, farColId, 'memories', 'Memories'),
      [metaQueryId]: leaf(metaQueryId, farColId, 'meta-query', 'Meta Query', 'bg-zinc-50'),
    },
  };
};

// ---------------------------------------------------------------------------
// Speak Better — Questions (narrow) | Conversation | Speak Better / TTS
// ---------------------------------------------------------------------------
const createSpeakBetterTree = (): BentoTree => {
  const rootId = generateId();
  const rightSplitId = generateId();
  const farSplitId = generateId();
  const questionsId = generateId();
  const conversationId = generateId();
  const speakBetterId = generateId();
  const ttsId = generateId();

  return {
    rootId,
    nodes: {
      [rootId]: {
        id: rootId, type: 'split', parent: null,
        direction: 'horizontal', ratio: 0.17,
        first: questionsId, second: rightSplitId,
      } as SplitNode,
      [rightSplitId]: {
        id: rightSplitId, type: 'split', parent: rootId,
        direction: 'horizontal', ratio: 0.60,
        first: conversationId, second: farSplitId,
      } as SplitNode,
      [farSplitId]: {
        id: farSplitId, type: 'split', parent: rightSplitId,
        direction: 'horizontal', ratio: 0.50,
        first: speakBetterId, second: ttsId,
      } as SplitNode,
      [questionsId]: leaf(questionsId, rootId, 'questions', 'Questions', 'bg-slate-50'),
      [conversationId]: leaf(conversationId, rightSplitId, 'conversation', 'Conversation', 'bg-pink-50'),
      [speakBetterId]: leaf(speakBetterId, farSplitId, 'speak-better', 'Speak Better', 'bg-rose-50'),
      [ttsId]: leaf(ttsId, farSplitId, 'tts', 'TTS', 'bg-orange-50'),
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
    description: 'Questions, conversation, and suggestions side by side',
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
    id: 'conversation',
    name: 'Conversation',
    description: 'Have long conversations with full context',
    icon: 'streamline-ultimate-color:audio-file-mp3',
    createTree: createConversationTree,
  },
  {
    id: 'meeting',
    name: 'Meeting',
    description: 'Live meeting transcription with questions and suggestions',
    icon: 'streamline-ultimate-color:team-meeting',
    createTree: createMeetingTree,
  },
  {
    id: 'debug',
    name: 'Debug',
    description: 'Debug how the system is working — only for developers',
    icon: 'codicon:debug',
    createTree: createDebugTree,
  },
  {
    id: 'speak-better',
    name: 'Speak Better',
    description: 'Speak with narration and speech improvement',
    icon: 'emojione:speak-no-evil-monkey',
    createTree: createSpeakBetterTree,
  },
];

export const getTemplate = (id: string): WorkspaceTemplate | undefined =>
  BUILT_IN_TEMPLATES.find(t => t.id === id);
