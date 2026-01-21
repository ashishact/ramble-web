/**
 * Memory Manager - Full CRUD for memories with importance tracking
 */

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { memoryStore } from '../../db/stores';
import type Memory from '../../db/models/Memory';

// Helper to format relative time
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

type SortField = 'content' | 'type' | 'importance' | 'confidence' | 'lastReinforced' | 'firstExpressed';
type SortDir = 'asc' | 'desc';

interface MemoryManagerProps {
  onClose: () => void;
}

const TYPE_OPTIONS = ['fact', 'preference', 'event', 'relationship', 'insight', 'belief', 'habit'];

export function MemoryManager({ onClose }: MemoryManagerProps) {
  // Data
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('lastReinforced');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showSuperseded, setShowSuperseded] = useState(false);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state
  const [formContent, setFormContent] = useState('');
  const [formType, setFormType] = useState('fact');
  const [formImportance, setFormImportance] = useState(50);
  const [formConfidence, setFormConfidence] = useState(80);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    const allMemories = await memoryStore.getAll();
    setMemories(allMemories);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get unique types for filter
  const allTypes = [...new Set(memories.map(m => m.type))].sort();

  // Stats
  const activeMemories = memories.filter(m => !m.supersededBy);
  const stats = {
    total: memories.length,
    active: activeMemories.length,
    superseded: memories.length - activeMemories.length,
    byType: allTypes.reduce((acc, type) => {
      acc[type] = activeMemories.filter(m => m.type === type).length;
      return acc;
    }, {} as Record<string, number>),
  };

  // Filter and sort memories
  const filteredMemories = memories
    .filter(m => {
      if (!showSuperseded && m.supersededBy) return false;
      if (typeFilter && m.type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          m.content.toLowerCase().includes(q) ||
          m.type.toLowerCase().includes(q) ||
          (m.subject?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'content':
          cmp = a.content.localeCompare(b.content);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'importance':
          cmp = a.importance - b.importance;
          break;
        case 'confidence':
          cmp = a.confidence - b.confidence;
          break;
        case 'lastReinforced':
          cmp = a.lastReinforced - b.lastReinforced;
          break;
        case 'firstExpressed':
          cmp = a.firstExpressed - b.firstExpressed;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // Toggle sort
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // Selection handlers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredMemories.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMemories.map(m => m.id)));
    }
  };

  // CRUD handlers
  const handleCreate = async () => {
    if (!formContent.trim()) return;

    await memoryStore.create({
      content: formContent.trim(),
      type: formType,
      importance: formImportance / 100,
      confidence: formConfidence / 100,
    });

    setShowCreateModal(false);
    resetForm();
    loadData();
  };

  const handleUpdate = async () => {
    if (!editingMemory || !formContent.trim()) return;

    await memoryStore.update(editingMemory.id, {
      content: formContent.trim(),
      type: formType,
      importance: formImportance / 100,
      confidence: formConfidence / 100,
    });

    setEditingMemory(null);
    resetForm();
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory? This cannot be undone.')) return;
    await memoryStore.delete(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    loadData();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} memories? This cannot be undone.`)) return;

    for (const id of selectedIds) {
      await memoryStore.delete(id);
    }
    setSelectedIds(new Set());
    loadData();
  };

  const handleReinforce = async (id: string) => {
    await memoryStore.reinforce(id);
    loadData();
  };

  // Form helpers
  const resetForm = () => {
    setFormContent('');
    setFormType('fact');
    setFormImportance(50);
    setFormConfidence(80);
  };

  const openEdit = (memory: Memory) => {
    setEditingMemory(memory);
    setFormContent(memory.content);
    setFormType(memory.type);
    setFormImportance(Math.round(memory.importance * 100));
    setFormConfidence(Math.round(memory.confidence * 100));
  };

  // Render sort icon
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <Icon icon="mdi:unfold-more-horizontal" className="w-4 h-4 opacity-30" />;
    return sortDir === 'asc' ? (
      <Icon icon="mdi:arrow-up" className="w-4 h-4" />
    ) : (
      <Icon icon="mdi:arrow-down" className="w-4 h-4" />
    );
  };

  // Type color
  const typeColor = (type: string) => {
    switch (type) {
      case 'fact': return 'badge-info';
      case 'preference': return 'badge-secondary';
      case 'event': return 'badge-warning';
      case 'relationship': return 'badge-success';
      case 'insight': return 'badge-primary';
      default: return 'badge-ghost';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl w-[95vw] max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Icon icon="mdi:brain" className="w-6 h-6 text-accent" />
            <h2 className="text-xl font-bold">Memory Manager</h2>
            <span className="badge badge-ghost">{stats.active} active</span>
            {stats.superseded > 0 && (
              <span className="badge badge-ghost opacity-50">{stats.superseded} superseded</span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-2 bg-base-200 border-b border-base-300 flex gap-4 text-sm shrink-0 overflow-x-auto">
          <button
            className={`badge ${typeFilter === '' ? 'badge-primary' : 'badge-ghost'} cursor-pointer`}
            onClick={() => setTypeFilter('')}
          >
            All: {stats.active}
          </button>
          {Object.entries(stats.byType).map(([type, count]) => (
            <button
              key={type}
              className={`badge ${typeFilter === type ? typeColor(type) : 'badge-ghost'} cursor-pointer`}
              onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
            >
              {type}: {count}
            </button>
          ))}
          <label className="flex items-center gap-2 ml-auto cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={showSuperseded}
              onChange={e => setShowSuperseded(e.target.checked)}
            />
            <span className="text-xs opacity-60">Show superseded</span>
          </label>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-base-300 flex flex-wrap gap-2 items-center shrink-0">
          {/* Search */}
          <div className="join flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search memories..."
              className="input input-bordered input-sm join-item flex-1"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="btn btn-sm btn-ghost join-item"
                onClick={() => setSearchQuery('')}
              >
                <Icon icon="mdi:close" className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              className="btn btn-sm btn-primary gap-1"
              onClick={() => setShowCreateModal(true)}
            >
              <Icon icon="mdi:plus" className="w-4 h-4" />
              New Memory
            </button>
            {selectedIds.size > 0 && (
              <button
                className="btn btn-sm btn-error gap-1"
                onClick={handleBulkDelete}
              >
                <Icon icon="mdi:delete" className="w-4 h-4" />
                Delete ({selectedIds.size})
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : filteredMemories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60">
              <Icon icon="mdi:brain" className="w-16 h-16 mb-4" />
              <p>No memories found</p>
            </div>
          ) : (
            <table className="table table-sm table-pin-rows">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={selectedIds.size === filteredMemories.length && filteredMemories.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('content')}>
                    <div className="flex items-center gap-1">
                      Content <SortIcon field="content" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('type')}>
                    <div className="flex items-center gap-1">
                      Type <SortIcon field="type" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('importance')}>
                    <div className="flex items-center gap-1">
                      Importance <SortIcon field="importance" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('confidence')}>
                    <div className="flex items-center gap-1">
                      Confidence <SortIcon field="confidence" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('lastReinforced')}>
                    <div className="flex items-center gap-1">
                      Reinforced <SortIcon field="lastReinforced" />
                    </div>
                  </th>
                  <th className="w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMemories.map(memory => (
                  <tr key={memory.id} className={`hover ${memory.supersededBy ? 'opacity-50' : ''}`}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selectedIds.has(memory.id)}
                        onChange={() => toggleSelect(memory.id)}
                      />
                    </td>
                    <td className="max-w-[350px]">
                      <div className="truncate">{memory.content}</div>
                      {memory.supersededBy && (
                        <span className="text-xs text-error opacity-60">Superseded</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-sm ${typeColor(memory.type)}`}>{memory.type}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <progress className="progress progress-accent w-12" value={memory.importance * 100} max="100"></progress>
                        <span className="text-xs font-mono">{Math.round(memory.importance * 100)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <progress className="progress progress-info w-12" value={memory.confidence * 100} max="100"></progress>
                        <span className="text-xs font-mono">{Math.round(memory.confidence * 100)}%</span>
                      </div>
                    </td>
                    <td className="text-xs opacity-60">
                      {timeAgo(memory.lastReinforced)}
                      {memory.reinforcementCount > 1 && (
                        <span className="ml-1 opacity-60">({memory.reinforcementCount}x)</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {!memory.supersededBy && (
                          <button
                            className="btn btn-ghost btn-xs text-accent"
                            onClick={() => handleReinforce(memory.id)}
                            title="Reinforce"
                          >
                            <Icon icon="mdi:refresh" className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => openEdit(memory)}
                          title="Edit"
                        >
                          <Icon icon="mdi:pencil" className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDelete(memory.id)}
                          title="Delete"
                        >
                          <Icon icon="mdi:delete" className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Create/Edit Modal */}
        {(showCreateModal || editingMemory) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                {editingMemory ? 'Edit Memory' : 'Create Memory'}
              </h3>

              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Content *</span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered"
                    value={formContent}
                    onChange={e => setFormContent(e.target.value)}
                    placeholder="What should be remembered?"
                    rows={3}
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Type</span>
                  </label>
                  <select
                    className="select select-bordered"
                    value={formType}
                    onChange={e => setFormType(e.target.value)}
                  >
                    {TYPE_OPTIONS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Importance: {formImportance}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formImportance}
                    onChange={e => setFormImportance(parseInt(e.target.value))}
                    className="range range-accent"
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Confidence: {formConfidence}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formConfidence}
                    onChange={e => setFormConfidence(parseInt(e.target.value))}
                    className="range range-info"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingMemory(null);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={editingMemory ? handleUpdate : handleCreate}
                  disabled={!formContent.trim()}
                >
                  {editingMemory ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
