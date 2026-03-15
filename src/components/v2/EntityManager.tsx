/**
 * Entity Manager - Full CRUD, merge, search/replace for entities
 *
 * Reads from DuckDB via useGraphData, writes via graphMutations.
 */

import { useState, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { useGraphData, graphMutations } from '../../graph/data';
import type { EntityItem } from '../../graph/data';
import { SortIcon } from './SortIcon';
import { formatRelativeTime } from '../../program/utils/time';

type SortField = 'name' | 'type' | 'mentionCount' | 'lastMentioned' | 'firstMentioned';
type SortDir = 'asc' | 'desc';

interface EntityManagerProps {
  onClose: () => void;
}

export function EntityManager({ onClose }: EntityManagerProps) {
  // Data — reactive via useGraphData
  const { data: entities, loading } = useGraphData<EntityItem>('entity', {
    limit: 500,
    orderBy: { field: 'lastMentioned', dir: 'desc' },
  });

  // Filters & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('lastMentioned');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Selection for merge
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [editingEntity, setEditingEntity] = useState<EntityItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showSearchReplaceModal, setShowSearchReplaceModal] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('');
  const [formAliases, setFormAliases] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Search/Replace state
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replacePreview, setReplacePreview] = useState<Array<{ id: string; field: string; old: string; new: string }>>([]);

  // Computed stats
  const stats = {
    total: entities.length,
    byType: entities.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  // Get unique types for filter
  const allTypes = [...new Set(entities.map(e => e.type))].sort();

  // Filter and sort entities
  const filteredEntities = entities
    .filter(e => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          (e.aliases ?? []).some(a => a.toLowerCase().includes(q)) ||
          (e.description?.toLowerCase().includes(q) ?? false)
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
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'mentionCount':
          cmp = (a.mentionCount ?? 0) - (b.mentionCount ?? 0);
          break;
        case 'lastMentioned':
          cmp = (a.lastMentioned ?? 0) - (b.lastMentioned ?? 0);
          break;
        case 'firstMentioned':
          cmp = (a.firstMentioned ?? 0) - (b.firstMentioned ?? 0);
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredEntities.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEntities.map(e => e.id)));
    }
  };

  // CRUD handlers
  const handleCreate = async () => {
    if (!formName.trim() || !formType.trim()) return;
    const now = Date.now();
    await graphMutations.createNode(['entity', formType.trim()], {
      name: formName.trim(),
      type: formType.trim(),
      aliases: formAliases.split(',').map(a => a.trim()).filter(Boolean),
      description: formDescription.trim() || undefined,
      mentionCount: 0,
      firstMentioned: now,
      lastMentioned: now,
    });
    setShowCreateModal(false);
    resetForm();
  };

  const handleUpdate = async () => {
    if (!editingEntity || !formName.trim() || !formType.trim()) return;
    await graphMutations.updateNodeProperties(editingEntity.id, {
      name: formName.trim(),
      type: formType.trim(),
      aliases: formAliases.split(',').map(a => a.trim()).filter(Boolean),
      description: formDescription.trim() || undefined,
    });
    // Update labels if type changed
    if (editingEntity.type !== formType.trim()) {
      const newLabels = editingEntity.labels
        .filter(l => l !== editingEntity.type)
        .concat(formType.trim());
      await graphMutations.updateNodeLabels(editingEntity.id, newLabels);
    }
    setEditingEntity(null);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entity? This cannot be undone.')) return;
    await graphMutations.deleteNode(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} entities? This cannot be undone.`)) return;
    await graphMutations.batch(async () => {
      for (const id of selectedIds) {
        await graphMutations.deleteNode(id);
      }
    });
    setSelectedIds(new Set());
  };

  // Merge handler — merge source entities into target
  const handleMerge = async (targetId: string) => {
    const sourceIds = [...selectedIds].filter(id => id !== targetId);
    const target = entities.find(e => e.id === targetId);
    if (!target) return;

    await graphMutations.batch(async () => {
      for (const sourceId of sourceIds) {
        const source = entities.find(e => e.id === sourceId);
        if (!source) continue;
        // Merge aliases
        const mergedAliases = [...new Set([
          ...(target.aliases ?? []),
          source.name,
          ...(source.aliases ?? []),
        ])].filter(a => a !== target.name);
        await graphMutations.updateNodeProperties(targetId, {
          aliases: mergedAliases,
          mentionCount: (target.mentionCount ?? 0) + (source.mentionCount ?? 0),
        });
        await graphMutations.deleteNode(sourceId);
      }
    });

    setSelectedIds(new Set());
    setShowMergeModal(false);
  };

  // Search/Replace
  const previewSearchReplace = useCallback(() => {
    if (!searchText.trim()) {
      setReplacePreview([]);
      return;
    }
    const preview: Array<{ id: string; field: string; old: string; new: string }> = [];
    const q = searchText.toLowerCase();
    for (const entity of entities) {
      if (entity.name.toLowerCase().includes(q)) {
        preview.push({
          id: entity.id, field: 'name', old: entity.name,
          new: entity.name.replace(new RegExp(searchText, 'gi'), replaceText),
        });
      }
      for (const alias of (entity.aliases ?? [])) {
        if (alias.toLowerCase().includes(q)) {
          preview.push({
            id: entity.id, field: 'alias', old: alias,
            new: alias.replace(new RegExp(searchText, 'gi'), replaceText),
          });
        }
      }
      if (entity.description?.toLowerCase().includes(q)) {
        preview.push({
          id: entity.id, field: 'description', old: entity.description,
          new: entity.description.replace(new RegExp(searchText, 'gi'), replaceText),
        });
      }
    }
    setReplacePreview(preview);
  }, [entities, searchText, replaceText]);

  const executeSearchReplace = async () => {
    if (replacePreview.length === 0) return;
    if (!confirm(`Replace ${replacePreview.length} occurrences?`)) return;
    const byEntity = new Map<string, typeof replacePreview>();
    for (const item of replacePreview) {
      if (!byEntity.has(item.id)) byEntity.set(item.id, []);
      byEntity.get(item.id)!.push(item);
    }
    await graphMutations.batch(async () => {
      for (const [entityId, items] of byEntity) {
        const entity = entities.find(e => e.id === entityId);
        if (!entity) continue;
        const updates: Record<string, unknown> = {};
        for (const item of items) {
          if (item.field === 'name') updates.name = item.new;
          else if (item.field === 'alias') {
            const aliases = (entity.aliases ?? []).map(a =>
              a.toLowerCase() === item.old.toLowerCase() ? item.new : a
            );
            updates.aliases = aliases;
          } else if (item.field === 'description') updates.description = item.new;
        }
        await graphMutations.updateNodeProperties(entityId, updates);
      }
    });
    setShowSearchReplaceModal(false);
    setSearchText('');
    setReplaceText('');
    setReplacePreview([]);
  };

  // Form helpers
  const resetForm = () => {
    setFormName('');
    setFormType('');
    setFormAliases('');
    setFormDescription('');
  };

  const openEdit = (entity: EntityItem) => {
    setEditingEntity(entity);
    setFormName(entity.name);
    setFormType(entity.type);
    setFormAliases((entity.aliases ?? []).join(', '));
    setFormDescription(entity.description ?? '');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl w-[95vw] max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Icon icon="mdi:account-group" className="w-6 h-6 text-primary" />
            <h2 className="text-xl font-bold">Entity Manager</h2>
            <span className="badge badge-ghost">{stats.total} total</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-2 bg-base-200 border-b border-base-300 flex gap-4 text-sm shrink-0 overflow-x-auto">
          {Object.entries(stats.byType).map(([type, count]) => (
            <button
              key={type}
              className={`badge ${typeFilter === type ? 'badge-primary' : 'badge-ghost'} cursor-pointer`}
              onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
            >
              {type}: {count}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-base-300 flex flex-wrap gap-2 items-center shrink-0">
          <div className="join flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search entities..."
              className="input input-bordered input-sm join-item flex-1"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="btn btn-sm btn-ghost join-item" onClick={() => setSearchQuery('')}>
                <Icon icon="mdi:close" className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary gap-1" onClick={() => setShowCreateModal(true)}>
              <Icon icon="mdi:plus" className="w-4 h-4" /> New
            </button>
            <button className="btn btn-sm btn-ghost gap-1" onClick={() => setShowSearchReplaceModal(true)}>
              <Icon icon="mdi:find-replace" className="w-4 h-4" /> Replace
            </button>
            {selectedIds.size >= 2 && (
              <button className="btn btn-sm btn-secondary gap-1" onClick={() => setShowMergeModal(true)}>
                <Icon icon="mdi:merge" className="w-4 h-4" /> Merge ({selectedIds.size})
              </button>
            )}
            {selectedIds.size > 0 && (
              <button className="btn btn-sm btn-error gap-1" onClick={handleBulkDelete}>
                <Icon icon="mdi:delete" className="w-4 h-4" /> Delete ({selectedIds.size})
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
          ) : filteredEntities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60">
              <Icon icon="mdi:account-search" className="w-16 h-16 mb-4" />
              <p>No entities found</p>
            </div>
          ) : (
            <table className="table table-sm table-pin-rows">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" className="checkbox checkbox-sm"
                      checked={selectedIds.size === filteredEntities.length && filteredEntities.length > 0}
                      onChange={selectAll} />
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('name')}>
                    <div className="flex items-center gap-1">Name <SortIcon field="name" sortField={sortField} sortDir={sortDir} /></div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('type')}>
                    <div className="flex items-center gap-1">Type <SortIcon field="type" sortField={sortField} sortDir={sortDir} /></div>
                  </th>
                  <th>Aliases</th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('mentionCount')}>
                    <div className="flex items-center gap-1">Mentions <SortIcon field="mentionCount" sortField={sortField} sortDir={sortDir} /></div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('firstMentioned')}>
                    <div className="flex items-center gap-1">First <SortIcon field="firstMentioned" sortField={sortField} sortDir={sortDir} /></div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('lastMentioned')}>
                    <div className="flex items-center gap-1">Last <SortIcon field="lastMentioned" sortField={sortField} sortDir={sortDir} /></div>
                  </th>
                  <th className="w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntities.map(entity => (
                  <tr key={entity.id} className="hover">
                    <td>
                      <input type="checkbox" className="checkbox checkbox-sm"
                        checked={selectedIds.has(entity.id)} onChange={() => toggleSelect(entity.id)} />
                    </td>
                    <td className="font-medium">{entity.name}</td>
                    <td><span className="badge badge-ghost badge-sm">{entity.type}</span></td>
                    <td className="max-w-[200px] truncate text-xs opacity-70">
                      {(entity.aliases ?? []).join(', ') || '-'}
                    </td>
                    <td className="font-mono">{entity.mentionCount ?? 0}</td>
                    <td className="text-xs opacity-60">{formatRelativeTime(entity.firstMentioned)}</td>
                    <td className="text-xs opacity-60">{formatRelativeTime(entity.lastMentioned)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn btn-ghost btn-xs" onClick={() => openEdit(entity)} title="Edit">
                          <Icon icon="mdi:pencil" className="w-4 h-4" />
                        </button>
                        <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(entity.id)} title="Delete">
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
        {(showCreateModal || editingEntity) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                {editingEntity ? 'Edit Entity' : 'Create Entity'}
              </h3>
              <div className="space-y-4">
                <div className="form-control">
                  <label className="label"><span className="label-text">Name *</span></label>
                  <input type="text" className="input input-bordered" value={formName}
                    onChange={e => setFormName(e.target.value)} placeholder="Entity name" />
                </div>
                <div className="form-control">
                  <label className="label"><span className="label-text">Type *</span></label>
                  <input type="text" className="input input-bordered" value={formType}
                    onChange={e => setFormType(e.target.value)} placeholder="person, organization, place, etc."
                    list="entity-types" />
                  <datalist id="entity-types">
                    {allTypes.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div className="form-control">
                  <label className="label"><span className="label-text">Aliases (comma separated)</span></label>
                  <input type="text" className="input input-bordered" value={formAliases}
                    onChange={e => setFormAliases(e.target.value)} placeholder="Nick, Nicholas, etc." />
                </div>
                <div className="form-control">
                  <label className="label"><span className="label-text">Description</span></label>
                  <textarea className="textarea textarea-bordered" value={formDescription}
                    onChange={e => setFormDescription(e.target.value)} placeholder="Optional description" rows={2} />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button className="btn btn-ghost" onClick={() => { setShowCreateModal(false); setEditingEntity(null); resetForm(); }}>Cancel</button>
                <button className="btn btn-primary" onClick={editingEntity ? handleUpdate : handleCreate}
                  disabled={!formName.trim() || !formType.trim()}>
                  {editingEntity ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Merge Modal */}
        {showMergeModal && selectedIds.size >= 2 && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">Merge Entities</h3>
              <p className="text-sm opacity-70 mb-4">Select the target entity. Others will be merged into it.</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {[...selectedIds].map(id => {
                  const entity = entities.find(e => e.id === id);
                  if (!entity) return null;
                  return (
                    <button key={id} className="w-full p-3 text-left rounded-lg border border-base-300 hover:bg-base-200"
                      onClick={() => handleMerge(id)}>
                      <div className="font-medium">{entity.name}</div>
                      <div className="text-xs opacity-60">{entity.type} · {entity.mentionCount ?? 0} mentions</div>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end mt-4">
                <button className="btn btn-ghost" onClick={() => setShowMergeModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Search/Replace Modal */}
        {showSearchReplaceModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-lg">
              <h3 className="text-lg font-bold mb-4">Search & Replace</h3>
              <div className="space-y-4">
                <div className="form-control">
                  <label className="label"><span className="label-text">Search for</span></label>
                  <input type="text" className="input input-bordered" value={searchText}
                    onChange={e => setSearchText(e.target.value)} placeholder="Text to find" />
                </div>
                <div className="form-control">
                  <label className="label"><span className="label-text">Replace with</span></label>
                  <input type="text" className="input input-bordered" value={replaceText}
                    onChange={e => setReplaceText(e.target.value)} placeholder="Replacement text" />
                </div>
                <button className="btn btn-sm btn-ghost" onClick={previewSearchReplace} disabled={!searchText.trim()}>Preview Changes</button>
                {replacePreview.length > 0 && (
                  <div className="bg-base-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                    <div className="text-sm font-medium mb-2">{replacePreview.length} changes:</div>
                    {replacePreview.slice(0, 20).map((item, i) => (
                      <div key={i} className="text-xs py-1 border-b border-base-300 last:border-0">
                        <span className="opacity-60">{item.field}:</span>{' '}
                        <span className="line-through text-error">{item.old}</span>{' '}
                        <span className="text-success">{item.new}</span>
                      </div>
                    ))}
                    {replacePreview.length > 20 && (
                      <div className="text-xs opacity-60 pt-2">...and {replacePreview.length - 20} more</div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button className="btn btn-ghost" onClick={() => { setShowSearchReplaceModal(false); setSearchText(''); setReplaceText(''); setReplacePreview([]); }}>Cancel</button>
                <button className="btn btn-primary" onClick={executeSearchReplace} disabled={replacePreview.length === 0}>Replace All ({replacePreview.length})</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
