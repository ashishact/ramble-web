/**
 * Goal Manager - Full CRUD for goals with progress tracking
 *
 * Reads from DuckDB via useGraphData, writes via graphMutations.
 */

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useGraphData, graphMutations } from '../../graph/data';
import type { GoalItem } from '../../graph/data';
import { SortIcon } from './SortIcon';
import { formatRelativeTime } from '../../program/utils/time';

type SortField = 'statement' | 'type' | 'status' | 'progress' | 'lastReferenced' | 'firstExpressed';
type SortDir = 'asc' | 'desc';

interface GoalManagerProps {
  onClose: () => void;
  editGoalId?: string;
}

type GoalStatus = 'active' | 'achieved' | 'abandoned' | 'blocked';
const STATUS_OPTIONS: GoalStatus[] = ['active', 'achieved', 'abandoned', 'blocked'];
const TYPE_OPTIONS = ['short-term', 'long-term', 'recurring', 'milestone'];

export function GoalManager({ onClose, editGoalId }: GoalManagerProps) {
  // Data — reactive via useGraphData
  const { data: goals, loading } = useGraphData<GoalItem>('goal', {
    limit: 500,
    orderBy: { field: 'lastReferenced', dir: 'desc' },
  });

  // Filters & Sort
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('lastReferenced');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modals
  const [editingGoal, setEditingGoal] = useState<GoalItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state
  const [formStatement, setFormStatement] = useState('');
  const [formType, setFormType] = useState('short-term');
  const [formStatus, setFormStatus] = useState<GoalStatus>('active');
  const [formProgress, setFormProgress] = useState(0);

  // Auto-open edit modal when editGoalId is provided
  useEffect(() => {
    if (editGoalId && !loading && goals.length > 0) {
      const goal = goals.find(g => g.id === editGoalId);
      if (goal) openEdit(goal);
    }
  }, [editGoalId, loading, goals]);

  // Stats
  const stats = {
    total: goals.length,
    active: goals.filter(g => g.status === 'active').length,
    achieved: goals.filter(g => g.status === 'achieved').length,
    blocked: goals.filter(g => g.status === 'blocked').length,
  };

  // Filter and sort goals
  const filteredGoals = goals
    .filter(g => {
      if (statusFilter && g.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return g.statement.toLowerCase().includes(q) || g.type.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'statement':
          cmp = (a.statement ?? '').localeCompare(b.statement ?? '');
          break;
        case 'type':
          cmp = (a.type ?? '').localeCompare(b.type ?? '');
          break;
        case 'status':
          cmp = (a.status ?? '').localeCompare(b.status ?? '');
          break;
        case 'progress':
          cmp = (a.progress ?? 0) - (b.progress ?? 0);
          break;
        case 'lastReferenced':
          cmp = (a.lastReferenced ?? 0) - (b.lastReferenced ?? 0);
          break;
        case 'firstExpressed':
          cmp = (a.firstExpressed ?? 0) - (b.firstExpressed ?? 0);
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
    if (selectedIds.size === filteredGoals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredGoals.map(g => g.id)));
    }
  };

  // CRUD handlers
  const handleCreate = async () => {
    if (!formStatement.trim()) return;
    const now = Date.now();
    await graphMutations.createNode(['goal'], {
      statement: formStatement.trim(),
      type: formType,
      status: 'active',
      progress: 0,
      firstExpressed: now,
      lastReferenced: now,
    });
    setShowCreateModal(false);
    resetForm();
  };

  const handleUpdate = async () => {
    if (!editingGoal || !formStatement.trim()) return;
    const updates: Record<string, unknown> = {
      statement: formStatement.trim(),
      type: formType,
      status: formStatus,
      progress: formProgress,
      lastReferenced: Date.now(),
    };
    if (formStatus === 'achieved' && editingGoal.status !== 'achieved') {
      updates.achievedAt = Date.now();
      updates.progress = 100;
    }
    await graphMutations.updateNodeProperties(editingGoal.id, updates);
    setEditingGoal(null);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this goal? This cannot be undone.')) return;
    await graphMutations.deleteNode(id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} goals? This cannot be undone.`)) return;
    await graphMutations.batch(async () => {
      for (const id of selectedIds) {
        await graphMutations.deleteNode(id);
      }
    });
    setSelectedIds(new Set());
  };

  const handleMarkComplete = async (id: string) => {
    await graphMutations.updateNodeProperties(id, {
      status: 'achieved',
      progress: 100,
      achievedAt: Date.now(),
      lastReferenced: Date.now(),
    });
  };

  const handleBulkMarkComplete = async () => {
    if (selectedIds.size === 0) return;
    const now = Date.now();
    await graphMutations.batch(async () => {
      for (const id of selectedIds) {
        await graphMutations.updateNodeProperties(id, {
          status: 'achieved',
          progress: 100,
          achievedAt: now,
          lastReferenced: now,
        });
      }
    });
    setSelectedIds(new Set());
  };

  // Form helpers
  const resetForm = () => {
    setFormStatement('');
    setFormType('short-term');
    setFormStatus('active');
    setFormProgress(0);
  };

  const openEdit = (goal: GoalItem) => {
    setEditingGoal(goal);
    setFormStatement(goal.statement);
    setFormType(goal.type);
    setFormStatus(goal.status as GoalStatus);
    setFormProgress(goal.progress ?? 0);
  };

  // Status badge color
  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'badge-info';
      case 'achieved': return 'badge-success';
      case 'abandoned': return 'badge-ghost';
      case 'blocked': return 'badge-error';
      default: return 'badge-ghost';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-base-100 rounded-lg shadow-xl w-[95vw] max-w-5xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-base-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Icon icon="mdi:target" className="w-6 h-6 text-success" />
            <h2 className="text-xl font-bold">Goal Manager</h2>
            <span className="badge badge-ghost">{stats.total} total</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Bar */}
        <div className="px-4 py-2 bg-base-200 border-b border-base-300 flex gap-4 text-sm shrink-0 overflow-x-auto">
          <button
            className={`badge ${statusFilter === '' ? 'badge-primary' : 'badge-ghost'} cursor-pointer`}
            onClick={() => setStatusFilter('')}
          >
            All: {stats.total}
          </button>
          <button
            className={`badge ${statusFilter === 'active' ? 'badge-info' : 'badge-ghost'} cursor-pointer`}
            onClick={() => setStatusFilter(statusFilter === 'active' ? '' : 'active')}
          >
            Active: {stats.active}
          </button>
          <button
            className={`badge ${statusFilter === 'achieved' ? 'badge-success' : 'badge-ghost'} cursor-pointer`}
            onClick={() => setStatusFilter(statusFilter === 'achieved' ? '' : 'achieved')}
          >
            Achieved: {stats.achieved}
          </button>
          <button
            className={`badge ${statusFilter === 'blocked' ? 'badge-error' : 'badge-ghost'} cursor-pointer`}
            onClick={() => setStatusFilter(statusFilter === 'blocked' ? '' : 'blocked')}
          >
            Blocked: {stats.blocked}
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-base-300 flex flex-wrap gap-2 items-center shrink-0">
          {/* Search */}
          <div className="join flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search goals..."
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
              New Goal
            </button>
            {selectedIds.size > 0 && (
              <>
                <button
                  className="btn btn-sm btn-success gap-1"
                  onClick={handleBulkMarkComplete}
                >
                  <Icon icon="mdi:check" className="w-4 h-4" />
                  Complete ({selectedIds.size})
                </button>
                <button
                  className="btn btn-sm btn-error gap-1"
                  onClick={handleBulkDelete}
                >
                  <Icon icon="mdi:delete" className="w-4 h-4" />
                  Delete ({selectedIds.size})
                </button>
              </>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : filteredGoals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-base-content/60">
              <Icon icon="mdi:target" className="w-16 h-16 mb-4" />
              <p>No goals found</p>
            </div>
          ) : (
            <table className="table table-sm table-pin-rows">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={selectedIds.size === filteredGoals.length && filteredGoals.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('statement')}>
                    <div className="flex items-center gap-1">
                      Statement <SortIcon field="statement" sortField={sortField} sortDir={sortDir} />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('type')}>
                    <div className="flex items-center gap-1">
                      Type <SortIcon field="type" sortField={sortField} sortDir={sortDir} />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('status')}>
                    <div className="flex items-center gap-1">
                      Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('progress')}>
                    <div className="flex items-center gap-1">
                      Progress <SortIcon field="progress" sortField={sortField} sortDir={sortDir} />
                    </div>
                  </th>
                  <th className="cursor-pointer hover:bg-base-200" onClick={() => toggleSort('lastReferenced')}>
                    <div className="flex items-center gap-1">
                      Last Ref <SortIcon field="lastReferenced" sortField={sortField} sortDir={sortDir} />
                    </div>
                  </th>
                  <th className="w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredGoals.map(goal => (
                  <tr key={goal.id} className="hover">
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={selectedIds.has(goal.id)}
                        onChange={() => toggleSelect(goal.id)}
                      />
                    </td>
                    <td className="max-w-[300px]">
                      <div className="truncate">{goal.statement}</div>
                    </td>
                    <td>
                      <span className="badge badge-ghost badge-sm">{goal.type}</span>
                    </td>
                    <td>
                      <span className={`badge badge-sm ${statusColor(goal.status)}`}>{goal.status}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <progress className="progress progress-success w-16" value={goal.progress ?? 0} max="100"></progress>
                        <span className="text-xs font-mono">{goal.progress ?? 0}%</span>
                      </div>
                    </td>
                    <td className="text-xs opacity-60">{formatRelativeTime(goal.lastReferenced)}</td>
                    <td>
                      <div className="flex gap-1">
                        {goal.status === 'active' && (
                          <button
                            className="btn btn-ghost btn-xs text-success"
                            onClick={() => handleMarkComplete(goal.id)}
                            title="Mark Complete"
                          >
                            <Icon icon="mdi:check" className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => openEdit(goal)}
                          title="Edit"
                        >
                          <Icon icon="mdi:pencil" className="w-4 h-4" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDelete(goal.id)}
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
        {(showCreateModal || editingGoal) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-60">
            <div className="bg-base-100 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                {editingGoal ? 'Edit Goal' : 'Create Goal'}
              </h3>

              <div className="space-y-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Statement *</span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered"
                    value={formStatement}
                    onChange={e => setFormStatement(e.target.value)}
                    placeholder="What do you want to achieve?"
                    rows={2}
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

                {editingGoal && (
                  <>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Status</span>
                      </label>
                      <select
                        className="select select-bordered"
                        value={formStatus}
                        onChange={e => setFormStatus(e.target.value as GoalStatus)}
                      >
                        {STATUS_OPTIONS.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-control">
                      <label className="label">
                        <span className="label-text">Progress: {formProgress}%</span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={formProgress}
                        onChange={e => setFormProgress(parseInt(e.target.value))}
                        className="range range-success"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingGoal(null);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={editingGoal ? handleUpdate : handleCreate}
                  disabled={!formStatement.trim()}
                >
                  {editingGoal ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
