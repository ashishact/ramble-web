/**
 * Topic Manager - Full CRUD and merge for topics
 */

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { topicStore } from '../../db/stores';
import type Topic from '../../db/models/Topic';

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

type SortField = 'name' | 'category' | 'mentionCount' | 'lastMentioned' | 'firstMentioned';
type SortDir = 'asc' | 'desc';

interface TopicManagerProps {
  onClose: () => void;
}

export function TopicManager({ onClose }: TopicManagerProps) {
  // Data
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('lastMentioned');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Selection for merge
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    const allTopics = await topicStore.getAll();
    setTopics(allTopics);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get unique categories for filter
  const allCategories = [...new Set(topics.map(t => t.category).filter(Boolean))].sort() as string[];

  // Stats
  const stats = {
    total: topics.length,
    byCategory: allCategories.reduce((acc, cat) => {
      acc[cat] = topics.filter(t => t.category === cat).length;
      return acc;
    }, {} as Record<string, number>),
  };

  // Filter and sort topics
  const filteredTopics = topics
    .filter(t => {
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.name.toLowerCase().includes(q) ||
          (t.category?.toLowerCase().includes(q) ?? false) ||
          (t.description?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'category':
          cmp = (a.category ?? '').localeCompare(b.category ?? '');
          break;
        case 'mentionCount':
          cmp = a.mentionCount - b.mentionCount;
          break;
        case 'lastMentioned':
          cmp = a.lastMentioned - b.lastMentioned;
          break;
        case 'firstMentioned':
          cmp = a.firstMentioned - b.firstMentioned;
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
    if (selectedIds.size === filteredTopics.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTopics.map(t => t.id)));
    }
  };

  // CRUD handlers
  const handleCreate = async () => {
    if (!formName.trim()) return;

    await topicStore.create({
      name: formName.trim(),
      category: formCategory.trim() || undefined,
      description: formDescription.trim() || undefined,
    });

    setShowCreateModal(false);
    resetForm();
    loadData();
  };

  const handleUpdate = async () => {
    if (!editingTopic || !formName.trim()) return;

    await topicStore.update(editingTopic.id, {
      name: formName.trim(),
      category: formCategory.trim() || undefined,
      description: formDescription.trim() || undefined,
    });

    setEditingTopic(null);
    resetForm();
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this topic? This cannot be undone.')) return;
    await topicStore.delete(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    loadData();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} topics? This cannot be undone.`)) return;

    for (const id of selectedIds) {
      await topicStore.delete(id);
    }
    setSelectedIds(new Set());
    loadData();
  };

  // Merge handler
  const handleMerge = async (targetId: string) => {
    const sourceIds = [...selectedIds].filter(id => id !== targetId);
    for (const sourceId of sourceIds) {
      await topicStore.merge(targetId, sourceId);
    }
    setSelectedIds(new Set());
    setShowMergeModal(false);
    loadData();
  };

  // Form helpers
  const resetForm = () => {
    setFormName('');
    setFormCategory('');
    setFormDescription('');
  };

  const openEdit = (topic: Topic) => {
    setEditingTopic(topic);
    setFormName(topic.name);
    setFormCategory(topic.category ?? '');
    setFormDescription(topic.description ?? '');
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl w-[95vw] max-w-5xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Icon icon="mdi:tag-multiple" className="w-6 h-6 text-secondary" />
            <h2 className="text-xl font-bold">Topic Manager</h2>
            <span className="badge badge-ghost">{stats.total} total</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        {allCategories.length > 0 && (
          <div className="px-4 py-2 bg-base-200 border-b border-base-300 flex gap-4 text-sm shrink-0 overflow-x-auto">
            <button
              className={`badge ${categoryFilter === '' ? 'badge-primary' : 'badge-ghost'} cursor-pointer`}
              onClick={() => setCategoryFilter('')}
            >
              All: {stats.total}
            </button>
            {allCategories.map(cat => (
              <button
                key={cat}
                className={`badge ${categoryFilter === cat ? 'badge-secondary' : 'badge-ghost'} cursor-pointer`}
                onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
              >
                {cat}: {stats.byCategory[cat]}
              </button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="p-3 border-b border-base-300 flex flex-wrap gap-2 items-center shrink-0">
          {/* Search */}
          <div className="join flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search topics..."
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
              New Topic
            </button>
            {selectedIds.size >= 2 && (
              <button
                className="btn btn-sm btn-secondary gap-1"
                onClick={() => setShowMergeModal(true)}
              >
                <Icon icon="mdi:merge" className="w-4 h-4" />
                Merge ({selectedIds.size})
              </button>
            )}
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
          ) : filteredTopics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60">
              <Icon icon="mdi:tag-off" className="w-16 h-16 mb-4" />
              <p>No topics found</p>
            </div>
          ) : (
            <table className="table table-sm table-pin-rows">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={selectedIds.size === filteredTopics.length && filteredTopics.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('name')}>
                    <div className="flex items-center gap-1">
                      Name <SortIcon field="name" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('category')}>
                    <div className="flex items-center gap-1">
                      Category <SortIcon field="category" />
                    </div>
                  </th>
                  <th>Description</th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('mentionCount')}>
                    <div className="flex items-center gap-1">
                      Mentions <SortIcon field="mentionCount" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('firstMentioned')}>
                    <div className="flex items-center gap-1">
                      First <SortIcon field="firstMentioned" />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('lastMentioned')}>
                    <div className="flex items-center gap-1">
                      Last <SortIcon field="lastMentioned" />
                    </div>
                  </th>
                  <th className="w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTopics.map(topic => (
                  <tr key={topic.id} className="hover">
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selectedIds.has(topic.id)}
                        onChange={() => toggleSelect(topic.id)}
                      />
                    </td>
                    <td className="font-medium">{topic.name}</td>
                    <td>
                      {topic.category ? (
                        <span className="badge badge-secondary badge-sm">{topic.category}</span>
                      ) : (
                        <span className="opacity-30">-</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate text-xs opacity-70">
                      {topic.description || '-'}
                    </td>
                    <td className="font-mono">{topic.mentionCount}</td>
                    <td className="text-xs opacity-60">{timeAgo(topic.firstMentioned)}</td>
                    <td className="text-xs opacity-60">{timeAgo(topic.lastMentioned)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => openEdit(topic)}
                          title="Edit"
                        >
                          <Icon icon="mdi:pencil" className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDelete(topic.id)}
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
        {(showCreateModal || editingTopic) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                {editingTopic ? 'Edit Topic' : 'Create Topic'}
              </h3>

              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Name *</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="Topic name"
                  />
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Category</span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered"
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    placeholder="work, personal, hobby, etc."
                    list="topic-categories"
                  />
                  <datalist id="topic-categories">
                    {allCategories.map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Description</span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered"
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={2}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingTopic(null);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={editingTopic ? handleUpdate : handleCreate}
                  disabled={!formName.trim()}
                >
                  {editingTopic ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Merge Modal */}
        {showMergeModal && selectedIds.size >= 2 && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Merge Topics</h3>
              <p className="text-sm opacity-70 mb-4">
                Select the target topic. All other selected topics will be merged into it.
              </p>

              <div className="space-y-2 max-h-60 overflow-y-auto">
                {[...selectedIds].map(id => {
                  const topic = topics.find(t => t.id === id);
                  if (!topic) return null;
                  return (
                    <button
                      key={id}
                      className="w-full p-3 text-left rounded-lg border border-base-300 hover:bg-base-200"
                      onClick={() => handleMerge(id)}
                    >
                      <div className="font-medium">{topic.name}</div>
                      <div className="text-xs opacity-60">
                        {topic.category ?? 'No category'} · {topic.mentionCount} mentions
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowMergeModal(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
