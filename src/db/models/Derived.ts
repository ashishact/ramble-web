/**
 * Derived Model - Layer 2: Memoized computations
 *
 * Claims, Goals, Concerns, etc. are computed from primitives
 * and cached here with dependency tracking for invalidation.
 */

import { Model } from '@nozbe/watermelondb'
import { field, text } from '@nozbe/watermelondb/decorators'

export default class Derived extends Model {
  static table = 'derived'

  @text('type') type!: string                      // 'claim' | 'goal' | 'concern' | etc.
  @text('dependencyIdsJson') dependencyIdsJson!: string
  @text('dependencyHash') dependencyHash!: string  // For change detection
  @text('dataJson') dataJson!: string
  @field('stale') stale!: boolean
  @field('computedAt') computedAt!: number

  get dependencyIds(): string[] {
    return JSON.parse(this.dependencyIdsJson || '[]')
  }

  get data(): Record<string, unknown> {
    return JSON.parse(this.dataJson || '{}')
  }
}
