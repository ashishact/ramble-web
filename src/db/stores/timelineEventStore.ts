import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import TimelineEvent from '../models/TimelineEvent'

const timelineEvents = database.get<TimelineEvent>('timeline_events')

export const timelineEventStore = {
  async create(data: {
    entityIds: string[]
    eventTime: number
    timeGranularity: string
    timeConfidence: number
    title: string
    description: string
    significance?: string
    memoryIds?: string[]
    source?: string
    metadata?: Record<string, unknown>
  }): Promise<TimelineEvent> {
    const now = Date.now()
    return await database.write(async () => {
      return await timelineEvents.create((e) => {
        e.entityIds = JSON.stringify(data.entityIds)
        e.eventTime = data.eventTime
        e.timeGranularity = data.timeGranularity
        e.timeConfidence = data.timeConfidence
        e.title = data.title
        e.description = data.description
        e.significance = data.significance ?? null
        e.memoryIds = JSON.stringify(data.memoryIds ?? [])
        e.source = data.source ?? 'inferred'
        e.metadata = JSON.stringify(data.metadata ?? {})
        e.createdAt = now
      })
    })
  },

  async getByEntity(entityId: string): Promise<TimelineEvent[]> {
    // WatermelonDB can't query inside JSON arrays, so fetch and filter
    const all = await timelineEvents
      .query(Q.sortBy('eventTime', Q.asc))
      .fetch()
    return all.filter(e => e.entityIdsParsed.includes(entityId))
  },

  async getByTimeRange(start: number, end: number): Promise<TimelineEvent[]> {
    return await timelineEvents
      .query(
        Q.where('eventTime', Q.gte(start)),
        Q.where('eventTime', Q.lte(end)),
        Q.sortBy('eventTime', Q.asc)
      )
      .fetch()
  },

  async getRecent(limit = 20): Promise<TimelineEvent[]> {
    return await timelineEvents
      .query(
        Q.sortBy('eventTime', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getAll(): Promise<TimelineEvent[]> {
    return await timelineEvents.query().fetch()
  },

  async update(id: string, data: {
    title?: string
    description?: string
    significance?: string | null
    memoryIds?: string[]
    entityIds?: string[]
    timeConfidence?: number
    eventTime?: number
    timeGranularity?: string
  }): Promise<boolean> {
    try {
      const event = await timelineEvents.find(id)
      await database.write(async () => {
        await event.update((e) => {
          if (data.title !== undefined) e.title = data.title
          if (data.description !== undefined) e.description = data.description
          if (data.significance !== undefined) e.significance = data.significance
          if (data.memoryIds !== undefined) {
            // Union existing + new memoryIds
            const existing = e.memoryIdsParsed
            const merged = [...new Set([...existing, ...data.memoryIds])]
            e.memoryIds = JSON.stringify(merged)
          }
          if (data.entityIds !== undefined) {
            const existing = e.entityIdsParsed
            const merged = [...new Set([...existing, ...data.entityIds])]
            e.entityIds = JSON.stringify(merged)
          }
          if (data.timeConfidence !== undefined) e.timeConfidence = data.timeConfidence
          if (data.eventTime !== undefined) e.eventTime = data.eventTime
          if (data.timeGranularity !== undefined) e.timeGranularity = data.timeGranularity
        })
      })
      return true
    } catch {
      return false
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const event = await timelineEvents.find(id)
      await database.write(async () => {
        await event.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },
}
