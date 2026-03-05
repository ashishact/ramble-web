import type { TreeTemplate } from './types'

export const TEMPLATES: Record<string, TreeTemplate> = {

  person: {
    type: 'person',
    nodes: [
      { key: 'identity', label: 'Identity', nodeType: 'group', children: [
        { key: 'identity.role', label: 'Role', nodeType: 'text' },
        { key: 'identity.organization', label: 'Organization', nodeType: 'text' },
        { key: 'identity.location', label: 'Location', nodeType: 'text' },
      ]},
      { key: 'relationships', label: 'Relationships', nodeType: 'group' },
      { key: 'beliefs', label: 'Beliefs & Opinions', nodeType: 'group' },
      { key: 'goals', label: 'Goals', nodeType: 'group' },
      { key: 'concerns', label: 'Concerns', nodeType: 'group' },
      { key: 'key_facts', label: 'Key Facts', nodeType: 'group' },
    ]
  },

  application: {
    type: 'application',
    nodes: [
      { key: 'purpose', label: 'Purpose', nodeType: 'text' },
      { key: 'tech_stack', label: 'Tech Stack', nodeType: 'group' },
      { key: 'architecture', label: 'Architecture', nodeType: 'group' },
      { key: 'features', label: 'Features', nodeType: 'group' },
      { key: 'users', label: 'Users', nodeType: 'group' },
      { key: 'issues', label: 'Known Issues', nodeType: 'group' },
    ]
  },

  organization: {
    type: 'organization',
    nodes: [
      { key: 'about', label: 'What They Do', nodeType: 'text' },
      { key: 'people', label: 'People', nodeType: 'group' },
      { key: 'products', label: 'Products & Services', nodeType: 'group' },
      { key: 'relationship', label: 'Relationship To User', nodeType: 'text' },
    ]
  },

  device: {
    type: 'device',
    nodes: [
      { key: 'overview', label: 'Overview', nodeType: 'text' },
      { key: 'specs', label: 'Specifications', nodeType: 'keyvalue' },
      { key: 'sensors', label: 'Sensors', nodeType: 'group' },
      { key: 'connectivity', label: 'Connectivity', nodeType: 'text' },
      { key: 'compliance', label: 'Compliance', nodeType: 'group' },
      { key: 'deployment', label: 'Deployment', nodeType: 'group' },
    ]
  },

  project: {
    type: 'project',
    nodes: [
      { key: 'description', label: 'Description', nodeType: 'text' },
      { key: 'role', label: 'Role & Contribution', nodeType: 'text' },
      { key: 'technologies', label: 'Technologies', nodeType: 'group' },
      { key: 'outcome', label: 'Outcome & Impact', nodeType: 'text' },
      { key: 'duration', label: 'Duration', nodeType: 'text' },
    ]
  },

  concept: {
    type: 'concept',
    nodes: [
      { key: 'definition', label: 'Definition', nodeType: 'text' },
      { key: 'context', label: 'Context & Usage', nodeType: 'text' },
      { key: 'related', label: 'Related Concepts', nodeType: 'group' },
    ]
  },

  // Fallback for unknown/unmatched entity types
  _default: {
    type: '_default',
    nodes: [
      { key: 'about', label: 'About', nodeType: 'text' },
      { key: 'details', label: 'Details', nodeType: 'group' },
      { key: 'notes', label: 'Notes', nodeType: 'group' },
    ]
  },
}

export function getTemplateForEntityType(entityType: string): TreeTemplate {
  return TEMPLATES[entityType] ?? TEMPLATES._default
}
