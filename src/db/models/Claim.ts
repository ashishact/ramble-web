/**
 * Claim Model
 */

import { Model, Query, Relation } from '@nozbe/watermelondb'
import { field, text, relation, children } from '@nozbe/watermelondb/decorators'
import type ExtractionProgram from './ExtractionProgram'
import type SourceTracking from './SourceTracking'

export default class Claim extends Model {
  static table = 'claims'

  static associations = {
    extraction_programs: { type: 'belongs_to', key: 'extractionProgramId' },
    source_tracking: { type: 'has_many', foreignKey: 'claimId' },
  } as const

  // Core fields
  @text('statement') statement!: string
  @text('subject') subject!: string
  @text('claimType') claimType!: string
  @text('temporality') temporality!: string
  @text('abstraction') abstraction!: string
  @text('sourceType') sourceType!: string

  // Confidence & state
  @field('initialConfidence') initialConfidence!: number
  @field('currentConfidence') currentConfidence!: number
  @text('state') state!: string

  // Emotional metadata
  @field('emotionalValence') emotionalValence!: number
  @field('emotionalIntensity') emotionalIntensity!: number
  @text('stakes') stakes!: string

  // Timestamps
  @field('validFrom') validFrom!: number
  @field('validUntil') validUntil!: number | null
  @field('createdAt') createdAt!: number
  @field('lastConfirmed') lastConfirmed!: number
  @field('confirmationCount') confirmationCount!: number

  // Relations
  @text('extractionProgramId') extractionProgramId!: string
  @text('supersededBy') supersededBy!: string | null
  @text('elaborates') elaborates!: string | null

  // Memory system
  @text('memoryTier') memoryTier!: string
  @field('salience') salience!: number
  @field('promotedAt') promotedAt!: number | null
  @field('lastAccessed') lastAccessed!: number

  // Relation accessors
  @relation('extraction_programs', 'extractionProgramId')
  extractionProgram!: Relation<ExtractionProgram>

  @children('source_tracking')
  sourceTracking!: Query<SourceTracking>
}
