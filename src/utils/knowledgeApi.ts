const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Select a node as the current node
 * This will update both the frontend state and backend state
 * Returns the selected node data
 */
export async function selectNode(nodeId: number) {
  console.log('selectNode called with nodeId:', nodeId);
  const response = await fetch(`${API_URL}/knowledge/current-node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  });
  const result = await response.json();
  console.log('selectNode response:', result);
  return result.data; // Return the node data
}

/**
 * Fetch a node by ID
 */
export async function fetchNodeById(nodeId: number) {
  const response = await fetch(`${API_URL}/knowledge/nodes/${nodeId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch node');
  }
  return response.json();
}

/**
 * Fetch the current node
 */
export async function fetchCurrentNode() {
  const response = await fetch(`${API_URL}/knowledge/current-node`);
  if (response.ok) {
    const text = await response.text();
    if (text) {
      return JSON.parse(text);
    }
  }
  return null;
}

/**
 * Semantic search for nodes
 */
export async function semanticSearch(query: string, limit: number = 20) {
  const response = await fetch(
    `${API_URL}/knowledge/nodes/semantic-search?q=${encodeURIComponent(query)}&limit=${limit}`
  );
  if (!response.ok) {
    throw new Error('Semantic search failed');
  }
  return response.json();
}
