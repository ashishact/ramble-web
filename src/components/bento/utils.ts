import type { BentoTree, LeafNode, SplitNode, Direction, WidgetType } from './types';

// Generate a simple unique ID
export const generateId = (): string => Math.random().toString(36).substring(2, 9);

export const getRandomColor = () => {
  const colors = [
    'bg-white', 'bg-slate-50', 'bg-zinc-50', 'bg-stone-50', 'bg-neutral-50',
    'bg-red-50', 'bg-orange-50', 'bg-amber-50', 'bg-yellow-50', 'bg-lime-50',
    'bg-green-50', 'bg-emerald-50', 'bg-teal-50', 'bg-cyan-50', 'bg-sky-50',
    'bg-blue-50', 'bg-indigo-50', 'bg-violet-50', 'bg-purple-50', 'bg-fuchsia-50', 
    'bg-pink-50', 'bg-rose-50', 'bg-slate-100', 'bg-blue-100', 'bg-emerald-100'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
};

// Create the initial tree with 2x2 default layout
// ┌─────────────────┬─────────────────┐
// │  VoiceRecorder  │  Conversation   │
// ├─────────────────┼─────────────────┤
// │     Goals       │    Memories     │
// └─────────────────┴─────────────────┘
export const createInitialTree = (): BentoTree => {
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
        id: rootId,
        type: 'split',
        parent: null,
        direction: 'vertical',
        ratio: 0.5,
        first: topRowId,
        second: bottomRowId,
      } as SplitNode,
      [topRowId]: {
        id: topRowId,
        type: 'split',
        parent: rootId,
        direction: 'horizontal',
        ratio: 0.5,
        first: voiceRecorderId,
        second: conversationId,
      } as SplitNode,
      [bottomRowId]: {
        id: bottomRowId,
        type: 'split',
        parent: rootId,
        direction: 'horizontal',
        ratio: 0.5,
        first: goalsId,
        second: memoriesId,
      } as SplitNode,
      [voiceRecorderId]: {
        id: voiceRecorderId,
        type: 'leaf',
        parent: topRowId,
        content: 'Voice Recorder',
        color: 'bg-white',
        widgetType: 'voice-recorder',
      } as LeafNode,
      [conversationId]: {
        id: conversationId,
        type: 'leaf',
        parent: topRowId,
        content: 'Conversation',
        color: 'bg-white',
        widgetType: 'conversation',
      } as LeafNode,
      [goalsId]: {
        id: goalsId,
        type: 'leaf',
        parent: bottomRowId,
        content: 'Goals',
        color: 'bg-white',
        widgetType: 'goals',
      } as LeafNode,
      [memoriesId]: {
        id: memoriesId,
        type: 'leaf',
        parent: bottomRowId,
        content: 'Memories',
        color: 'bg-white',
        widgetType: 'memories',
      } as LeafNode,
    },
  };
};

// Split a node
export const splitNode = (
  tree: BentoTree,
  targetId: string,
  direction: Direction,
  ratio: number = 0.5
): BentoTree => {
  const targetNode = tree.nodes[targetId];
  if (!targetNode || targetNode.type !== 'leaf') return tree;

  const originalLeaf = targetNode as LeafNode;

  // New Child 1 (Left/Top) - inherits the content of the original
  const child1Id = generateId();
  const child1: LeafNode = {
    id: child1Id,
    type: 'leaf',
    parent: targetId,
    content: originalLeaf.content,
    color: originalLeaf.color,
    widgetType: originalLeaf.widgetType,
    widgetConfig: originalLeaf.widgetConfig,
  };

  // New Child 2 (Right/Bottom) - new empty leaf (widget picker)
  const child2Id = generateId();
  const child2: LeafNode = {
    id: child2Id,
    type: 'leaf',
    parent: targetId,
    content: 'New Section',
    color: getRandomColor(),
    widgetType: 'empty',
  };

  // The original node becomes a SplitNode
  const newSplitNode: SplitNode = {
    id: targetId,
    type: 'split',
    parent: targetNode.parent,
    direction,
    ratio: ratio, // Use the provided ratio
    first: child1Id,
    second: child2Id,
  };

  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [targetId]: newSplitNode,
      [child1Id]: child1,
      [child2Id]: child2,
    },
  };
};

// Remove a leaf node (Merge)
export const removeNode = (tree: BentoTree, targetId: string): BentoTree => {
  const targetNode = tree.nodes[targetId];
  if (!targetNode || !targetNode.parent) return tree; // Cannot remove root

  const parentId = targetNode.parent;
  const parent = tree.nodes[parentId] as SplitNode;

  // Identify the sibling
  const siblingId = parent.first === targetId ? parent.second : parent.first;
  const sibling = tree.nodes[siblingId];

  // We want to replace 'parent' with 'sibling'.
  // 1. Update sibling's parent pointer to parent's parent.
  const updatedSibling = { ...sibling, parent: parent.parent };

  // 2. If parent was root, sibling becomes root.
  if (!parent.parent) {
    const newNodes = { ...tree.nodes };
    delete newNodes[targetId];
    delete newNodes[parentId];
    newNodes[siblingId] = updatedSibling;
    
    return {
      rootId: siblingId,
      nodes: newNodes,
    };
  }

  // 3. If parent had a parent (grandparent), update grandparent to point to sibling instead of parent.
  const grandParentId = parent.parent;
  const grandParent = tree.nodes[grandParentId] as SplitNode;
  
  const updatedGrandParent = { ...grandParent };
  if (updatedGrandParent.first === parentId) {
    updatedGrandParent.first = siblingId;
  } else {
    updatedGrandParent.second = siblingId;
  }

  const newNodes = { ...tree.nodes };
  delete newNodes[targetId];
  delete newNodes[parentId];
  newNodes[siblingId] = updatedSibling;
  newNodes[grandParentId] = updatedGrandParent;

  return {
    ...tree,
    nodes: newNodes,
  };
};

export const updateNodeRatio = (tree: BentoTree, nodeId: string, newRatio: number): BentoTree => {
    const node = tree.nodes[nodeId];
    if (!node || node.type !== 'split') return tree;

    // Clamp ratio to avoid disappearance (e.g., 5% to 95%)
    const clampedRatio = Math.max(0.05, Math.min(0.95, newRatio));

    return {
        ...tree,
        nodes: {
            ...tree.nodes,
            [nodeId]: { ...node, ratio: clampedRatio }
        }
    };
}

export const updateNodeColor = (tree: BentoTree, nodeId: string, color: string): BentoTree => {
    const node = tree.nodes[nodeId];
    if (!node || node.type !== 'leaf') return tree;

    return {
        ...tree,
        nodes: {
            ...tree.nodes,
            [nodeId]: { ...node, color }
        }
    };
};

export const updateNodeContent = (tree: BentoTree, nodeId: string, content: string): BentoTree => {
    const node = tree.nodes[nodeId];
    if (!node || node.type !== 'leaf') return tree;

    return {
        ...tree,
        nodes: {
            ...tree.nodes,
            [nodeId]: { ...node, content }
        }
    };
};

export const updateNodeWidgetType = (tree: BentoTree, nodeId: string, widgetType: WidgetType, widgetConfig?: Record<string, unknown>): BentoTree => {
    const node = tree.nodes[nodeId];
    if (!node || node.type !== 'leaf') return tree;

    return {
        ...tree,
        nodes: {
            ...tree.nodes,
            [nodeId]: { ...node, widgetType, widgetConfig }
        }
    };
};

// Swap any two leaf nodes in the tree
export const swapNodes = (tree: BentoTree, id1: string, id2: string): BentoTree => {
  if (id1 === id2) return tree;

  const node1 = tree.nodes[id1];
  const node2 = tree.nodes[id2];

  // We only swap leaves
  if (!node1 || !node2 || node1.type !== 'leaf' || node2.type !== 'leaf') return tree;

  const parent1Id = node1.parent;
  const parent2Id = node2.parent;

  // Ensure both have parents (swapping root leaf impossible as there's no other node)
  if (!parent1Id || !parent2Id) return tree;

  const parent1 = tree.nodes[parent1Id] as SplitNode;
  const parent2 = tree.nodes[parent2Id] as SplitNode;

  // Identify positions in parents
  const isParent1First = parent1.first === id1;
  const isParent2First = parent2.first === id2;

  // Clone parents (handle same parent case by using same object ref initially)
  const newParent1 = { ...parent1 };
  const newParent2 = parent1Id === parent2Id ? newParent1 : { ...parent2 };

  // Swap child pointers in parents
  // Point parent1's slot to node2
  if (isParent1First) {
      newParent1.first = id2;
  } else {
      newParent1.second = id2;
  }

  // Point parent2's slot to node1
  if (isParent2First) {
      newParent2.first = id1;
  } else {
      newParent2.second = id1;
  }

  // Update parent references on the children
  const newNode1 = { ...node1, parent: parent2Id };
  const newNode2 = { ...node2, parent: parent1Id };

  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [parent1Id]: newParent1,
      [parent2Id]: newParent2,
      [id1]: newNode1,
      [id2]: newNode2,
    },
  };
};

export const STORAGE_KEY = 'bento-grid-layout';

export const saveTreeToStorage = (tree: BentoTree): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
    return true;
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
    return false;
  }
};

export const loadTreeFromStorage = (): BentoTree | null => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    return JSON.parse(data) as BentoTree;
  } catch (error) {
    console.error('Failed to load from localStorage:', error);
    return null;
  }
};