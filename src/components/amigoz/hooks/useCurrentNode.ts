/**
 * Custom hook for managing current node state
 * Handles fetching, selecting, and syncing with custom events
 */
import { useState, useEffect, useCallback } from 'react';
import { selectNode, fetchCurrentNode } from '../../../backend/api';
import type { KnowledgeNode } from '../../../backend/types';

interface UseCurrentNodeOptions {
  customEvents: { event: string; data: any } | null;
}

export function useCurrentNode({ customEvents }: UseCurrentNodeOptions) {
  const [currentNode, setCurrentNode] = useState<KnowledgeNode | null>(null);
  const [relationshipVersion, setRelationshipVersion] = useState(0);

  // Fetch current node on mount
  useEffect(() => {
    const loadCurrentNode = async () => {
      try {
        const node = await fetchCurrentNode();
        if (node) {
          console.log('Loaded current node:', node);
          setCurrentNode(node);
        } else {
          console.log('No current node set yet');
        }
      } catch (err) {
        console.error('Error fetching current node:', err);
      }
    };

    loadCurrentNode();
  }, []);

  // Listen for node and relationship updates
  useEffect(() => {
    if (!customEvents) return;

    console.log('Received customEvent:', customEvents.event, customEvents.data);

    if (customEvents.event === 'current-node-update') {
      setCurrentNode(customEvents.data);
    } else if (
      customEvents.event === 'relationship-created' ||
      customEvents.event === 'relationship-deleted'
    ) {
      // Trigger a refresh by incrementing version
      setRelationshipVersion(v => v + 1);
    }
  }, [customEvents]);

  // Load a node by ID when selected
  const loadNodeById = useCallback(async (nodeId: number) => {
    try {
      const node = await selectNode(nodeId);
      if (node) {
        setCurrentNode(node);
      }
    } catch (err) {
      console.error('Error loading node:', err);
    }
  }, []);

  return {
    currentNode,
    relationshipVersion,
    loadNodeById,
  };
}
