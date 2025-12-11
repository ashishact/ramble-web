/**
 * ClaimSource Model - Many-to-many mapping
 */

import { Model } from '@nozbe/watermelondb'
import { text } from '@nozbe/watermelondb/decorators'

export default class ClaimSource extends Model {
  static table = 'claim_sources'

  @text('claimId') claimId!: string
  @text('unitId') unitId!: string
}
