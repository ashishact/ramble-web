/**
 * Chain Manager
 *
 * Manages thought chains - organizing related claims into coherent topics.
 * Handles chain creation, claim assignment, dormancy detection, and revival.
 */

import type {
  ThoughtChain,
  CreateThoughtChain,
  Claim,
  ChainClaim,
  ChainState,
} from '../types';
import type { ProgramStoreInstance } from '../store/programStore';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Chain');

// ============================================================================
// Types
// ============================================================================

export interface ChainManagerConfig {
  /** Time in ms after which a chain becomes dormant (default: 30 minutes) */
  dormancyThreshold: number;
  /** Maximum number of active chains (default: 10) */
  maxActiveChains: number;
  /** Minimum confidence to include a claim in a chain */
  minClaimConfidence: number;
}

export interface ChainMatchResult {
  chainId: string;
  topic: string;
  relevanceScore: number;
}

export interface ChainSummary {
  id: string;
  topic: string;
  state: ChainState;
  claimCount: number;
  lastExtended: number;
  branches: string[];
}

const DEFAULT_CONFIG: ChainManagerConfig = {
  dormancyThreshold: 30 * 60 * 1000, // 30 minutes
  maxActiveChains: 10,
  minClaimConfidence: 0.3,
};

// ============================================================================
// Chain Manager Implementation
// ============================================================================

export class ChainManager {
  private store: ProgramStoreInstance;
  private config: ChainManagerConfig;

  constructor(store: ProgramStoreInstance, config?: Partial<ChainManagerConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new thought chain
   */
  createChain(topic: string, parentChainId?: string): ThoughtChain {
    const data: CreateThoughtChain = {
      topic,
      branches_from: parentChainId ?? null,
      state: 'active',
    };

    const chain = this.store.chains.create(data);

    logger.info('Created thought chain', {
      id: chain.id,
      topic,
      parent: parentChainId,
    });

    // Check if we need to make old chains dormant
    this.enforceActiveChainLimit();

    return chain;
  }

  /**
   * Add a claim to a chain
   */
  addClaimToChain(chainId: string, claimId: string): ChainClaim | null {
    const chain = this.store.chains.getById(chainId);
    if (!chain) {
      logger.warn('Cannot add claim to non-existent chain', { chainId, claimId });
      return null;
    }

    // Get current claims to determine position
    const existingClaims = this.store.chains.getClaimsInChain(chainId);
    const position = existingClaims.length;

    // Add the claim
    const chainClaim = this.store.chains.addClaimToChain({
      chain_id: chainId,
      claim_id: claimId,
      position,
    });

    // Extend the chain (update last_extended timestamp)
    this.store.chains.extendChain(chainId);

    // If chain was dormant, revive it
    if (chain.state === 'dormant') {
      this.store.chains.revive(chainId);
      logger.debug('Revived dormant chain', { chainId });
    }

    logger.debug('Added claim to chain', { chainId, claimId, position });

    return chainClaim;
  }

  /**
   * Find the best matching chain for a claim based on topic similarity
   * Returns null if no good match found (new chain should be created)
   */
  findMatchingChain(claim: Claim): ChainMatchResult | null {
    const activeChains = this.store.chains.getActive();

    if (activeChains.length === 0) {
      return null;
    }

    // Score each active chain by relevance to the claim
    const scored = activeChains
      .map((chain) => ({
        chainId: chain.id,
        topic: chain.topic,
        relevanceScore: this.calculateRelevance(claim, chain),
      }))
      .filter((r) => r.relevanceScore > 0.3) // Minimum relevance threshold
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    if (scored.length === 0) {
      return null;
    }

    return scored[0];
  }

  /**
   * Calculate relevance between a claim and a chain
   * Uses simple keyword overlap - could be enhanced with embeddings
   */
  private calculateRelevance(claim: Claim, chain: ThoughtChain): number {
    const claimWords = this.extractKeywords(claim.statement + ' ' + claim.subject);
    const topicWords = this.extractKeywords(chain.topic);

    if (claimWords.length === 0 || topicWords.length === 0) {
      return 0;
    }

    // Calculate Jaccard similarity
    const claimSet = new Set(claimWords);
    const topicSet = new Set(topicWords);
    const intersection = [...claimSet].filter((w) => topicSet.has(w)).length;
    const union = new Set([...claimSet, ...topicSet]).size;

    return intersection / union;
  }

  /**
   * Extract keywords from text for matching
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'and',
      'but',
      'or',
      'nor',
      'for',
      'yet',
      'so',
      'in',
      'on',
      'at',
      'by',
      'to',
      'of',
      'with',
      'from',
      'as',
      'that',
      'this',
      'it',
      'i',
      'you',
      'he',
      'she',
      'we',
      'they',
      'my',
      'your',
      'his',
      'her',
      'our',
      'their',
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Check all chains for dormancy
   */
  checkDormancy(): void {
    const activeChains = this.store.chains.getActive();
    const timestamp = now();
    let dormantCount = 0;

    for (const chain of activeChains) {
      const timeSinceExtension = timestamp - chain.last_extended;

      if (timeSinceExtension > this.config.dormancyThreshold) {
        this.store.chains.markDormant(chain.id);
        dormantCount++;

        logger.debug('Chain became dormant', {
          chainId: chain.id,
          topic: chain.topic,
          inactiveFor: Math.round(timeSinceExtension / 1000 / 60) + ' minutes',
        });
      }
    }

    if (dormantCount > 0) {
      logger.info('Marked chains as dormant', { count: dormantCount });
    }
  }

  /**
   * Enforce maximum active chain limit
   */
  private enforceActiveChainLimit(): void {
    const activeChains = this.store.chains.getActive();

    if (activeChains.length <= this.config.maxActiveChains) {
      return;
    }

    // Sort by last_extended (oldest first)
    const sorted = [...activeChains].sort((a, b) => a.last_extended - b.last_extended);

    // Mark oldest chains as dormant
    const toMakeDormant = sorted.slice(0, activeChains.length - this.config.maxActiveChains);

    for (const chain of toMakeDormant) {
      this.store.chains.markDormant(chain.id);
      logger.debug('Enforced dormancy on chain', { chainId: chain.id });
    }
  }

  /**
   * Conclude a chain explicitly
   */
  concludeChain(chainId: string): void {
    this.store.chains.markConcluded(chainId);
    logger.info('Concluded chain', { chainId });
  }

  /**
   * Branch a new chain from an existing one
   */
  branchChain(parentChainId: string, newTopic: string): ThoughtChain {
    const parent = this.store.chains.getById(parentChainId);
    if (!parent) {
      throw new Error(`Parent chain not found: ${parentChainId}`);
    }

    return this.createChain(newTopic, parentChainId);
  }

  /**
   * Get all claims in a chain in order
   */
  getChainClaims(chainId: string): Claim[] {
    const chainClaims = this.store.chains.getClaimsInChain(chainId);

    // Sort by position
    chainClaims.sort((a, b) => a.position - b.position);

    // Fetch full claim objects
    const claims: Claim[] = [];
    for (const cc of chainClaims) {
      const claim = this.store.claims.getById(cc.claim_id);
      if (claim) {
        claims.push(claim);
      }
    }

    return claims;
  }

  /**
   * Get summary of all chains
   */
  getChainSummaries(): ChainSummary[] {
    const chains = this.store.chains.getAll();

    return chains.map((chain) => {
      const claims = this.store.chains.getClaimsInChain(chain.id);
      const children = chains.filter((c) => c.branches_from === chain.id);

      return {
        id: chain.id,
        topic: chain.topic,
        state: chain.state,
        claimCount: claims.length,
        lastExtended: chain.last_extended,
        branches: children.map((c) => c.id),
      };
    });
  }

  /**
   * Get active chains sorted by recent activity
   */
  getActiveChainsByRecency(): ThoughtChain[] {
    const active = this.store.chains.getActive();
    return [...active].sort((a, b) => b.last_extended - a.last_extended);
  }

  /**
   * Merge topic from claims if chain topic is generic
   */
  updateChainTopic(chainId: string, newTopic: string): void {
    this.store.chains.update(chainId, { topic: newTopic });
    logger.debug('Updated chain topic', { chainId, newTopic });
  }

  /**
   * Get the chain containing a specific claim
   */
  getChainForClaim(claimId: string): ThoughtChain | null {
    const chainId = this.store.chains.getChainForClaim(claimId);
    if (!chainId) return null;
    return this.store.chains.getById(chainId);
  }
}

/**
 * Create a chain manager instance
 */
export function createChainManager(
  store: ProgramStoreInstance,
  config?: Partial<ChainManagerConfig>
): ChainManager {
  return new ChainManager(store, config);
}
