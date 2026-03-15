/**
 * EmbeddingTestWidget — Comprehensive embedding model benchmark
 *
 * Side-by-side benchmark of all-MiniLM-L6-v2 vs bge-small-en-v1.5.
 * Tests: model load, throughput (50 sentences), similarity discrimination
 * across 6 categories, and top-k retrieval accuracy.
 */

import { useState, useCallback, useRef } from 'react'
import type { WidgetProps } from '../types'
import { FlaskConical, Play, Loader2, ChevronDown, ChevronRight } from 'lucide-react'

// ============================================================================
// Test Data — mirrors real knowledge graph content
// ============================================================================

// 50 sentences spanning entity descriptions, memories, topics, goals, relationships
const CORPUS = [
  // 0-4: Entities (person)
  'John Chen is the CTO of Acme Corp and leads the Project Atlas initiative.',
  'Sarah Kim works as a senior product designer at Figma in San Francisco.',
  'Dr. Emily Watson specializes in pediatric cardiology at Stanford Medical Center.',
  'Marcus Johnson is a freelance photographer who shoots for National Geographic.',
  'Priya Patel manages the infrastructure team at Cloudflare.',
  // 5-9: Entities (org/place)
  'Acme Corp is a Series B startup building AI-powered supply chain tools.',
  'The San Francisco office is located at 450 Mission Street, 12th floor.',
  'Stanford Medical Center is a teaching hospital affiliated with Stanford University.',
  'Project Atlas is a cross-functional initiative to rebuild the data pipeline.',
  'The Berlin office handles European operations and GDPR compliance.',
  // 10-14: Memories (observations)
  'John mentioned he is considering moving to Austin for the lower cost of living.',
  'Sarah prefers async communication and rarely joins video calls before noon.',
  'The quarterly revenue increased by 15% compared to last year.',
  'The authentication system migration is scheduled for Q2 and requires a code freeze.',
  'Marcus said he is planning a six-month sabbatical starting in September.',
  // 15-19: Memories (facts)
  'The new authentication system uses JWT tokens with refresh rotation.',
  'Our AWS bill was $47,000 last month, up from $38,000 the month before.',
  'The mobile app has 2.3 million monthly active users as of March.',
  'Python 3.12 introduced per-interpreter GIL for better multi-threading.',
  'The company switched from Slack to Microsoft Teams in January.',
  // 20-24: Topics
  'Machine learning model deployment strategies for edge devices.',
  'Kubernetes cluster autoscaling and resource optimization.',
  'React server components and the future of server-side rendering.',
  'Privacy regulations and GDPR compliance in European markets.',
  'Database sharding patterns for high-throughput write workloads.',
  // 25-29: Goals
  'Reduce API response latency to under 200ms at the 99th percentile.',
  'Ship the new onboarding flow by end of March to improve activation rates.',
  'Hire three senior engineers for the platform team before Q3.',
  'Migrate all services from EC2 to EKS by the end of the year.',
  'Achieve SOC 2 Type II certification before the enterprise sales push.',
  // 30-34: Relationships / context
  'John reports to the VP of Engineering and collaborates closely with Sarah on design reviews.',
  'The infrastructure team depends on the security team for IAM policy changes.',
  'Project Atlas blocked by the authentication migration which is owned by Priya.',
  'The Berlin office coordinates with the SF office on product launches.',
  'Marcus and Emily are college friends who reconnected at a conference last year.',
  // 35-39: Corrections / contradictions
  'Actually, the AWS bill was $52,000 last month, not $47,000 as previously stated.',
  'Sarah has been promoted to VP of Design, she is no longer a senior designer.',
  'The mobile app milestone was revised down to 2.1 million MAU after recount.',
  'John decided against moving to Austin and will stay in San Francisco.',
  'The Q2 code freeze was pushed to Q3 due to the product launch schedule.',
  // 40-44: Casual / personal
  'I need to schedule a dentist appointment for next Thursday morning.',
  'Remember to buy groceries: avocados, eggs, sourdough bread, and oat milk.',
  'The restaurant Sarah recommended downtown has amazing ramen and late-night hours.',
  'My flight to Tokyo departs at 2pm on Friday from SFO terminal G.',
  'The gym membership renewal is due on the 15th, consider switching to the annual plan.',
  // 45-49: Short fragments (like STT partial results)
  'John Chen CTO Acme',
  'authentication JWT refresh tokens',
  'Berlin GDPR compliance',
  'kubernetes autoscaling pods',
  'dentist appointment Thursday',
]

// Retrieval queries — each has a known correct answer (index into CORPUS)
interface RetrievalQuery {
  query: string
  correctIndex: number
  label: string // short description of what we're testing
}

const RETRIEVAL_QUERIES: RetrievalQuery[] = [
  // Entity lookup — natural language search for a person
  { query: 'Who is the CTO?', correctIndex: 0, label: 'Entity: role lookup' },
  { query: 'Tell me about John Chen', correctIndex: 0, label: 'Entity: name lookup' },
  { query: 'Who works at Figma?', correctIndex: 1, label: 'Entity: org lookup' },
  { query: 'the photographer', correctIndex: 3, label: 'Entity: profession' },
  { query: 'Cloudflare infrastructure', correctIndex: 4, label: 'Entity: org+role' },
  // Paraphrased recall — can it find the original from a reworded query?
  { query: 'What was our revenue growth?', correctIndex: 12, label: 'Recall: revenue' },
  { query: 'How much did we spend on AWS?', correctIndex: 16, label: 'Recall: AWS cost' },
  { query: 'How many users does the mobile app have?', correctIndex: 17, label: 'Recall: MAU' },
  { query: 'When did we switch chat tools?', correctIndex: 19, label: 'Recall: Slack→Teams' },
  { query: 'JWT authentication system', correctIndex: 15, label: 'Recall: auth tech' },
  // Fragment matching — can STT partials find the full sentence?
  { query: 'John Chen CTO', correctIndex: 0, label: 'Fragment: person' },
  { query: 'JWT tokens refresh', correctIndex: 15, label: 'Fragment: auth' },
  { query: 'GDPR Berlin', correctIndex: 9, label: 'Fragment: place+topic' },
  { query: 'kubernetes autoscaling', correctIndex: 21, label: 'Fragment: topic' },
  { query: 'dentist Thursday', correctIndex: 40, label: 'Fragment: personal' },
  // Goal/topic search — abstract queries
  { query: 'API performance goals', correctIndex: 25, label: 'Topic: API latency' },
  { query: 'hiring plan', correctIndex: 27, label: 'Topic: hiring' },
  { query: 'SOC 2 compliance', correctIndex: 29, label: 'Topic: security cert' },
  { query: 'database scalability', correctIndex: 24, label: 'Topic: DB sharding' },
  { query: 'moving to Kubernetes', correctIndex: 28, label: 'Topic: EKS migration' },
  // Relationship / context
  { query: 'Who does John work with?', correctIndex: 30, label: 'Relation: collaboration' },
  { query: 'What blocks Project Atlas?', correctIndex: 32, label: 'Relation: blocker' },
  { query: 'Marcus and Emily relationship', correctIndex: 34, label: 'Relation: personal' },
  // Correction retrieval — finding updated info
  { query: 'corrected AWS bill amount', correctIndex: 35, label: 'Correction: AWS' },
  { query: 'Sarah new role promotion', correctIndex: 36, label: 'Correction: promotion' },
]

// Similarity test pairs — 6 categories to stress-test discrimination
interface SimPair {
  category: string
  a: string
  b: string
  expected: 'high' | 'medium' | 'low'
}

const SIMILARITY_PAIRS: SimPair[] = [
  { category: 'Entity', a: 'John Chen is the CTO of Acme Corp', b: 'John Chen serves as Chief Technology Officer at Acme Corporation', expected: 'high' },
  { category: 'Entity', a: 'Sarah Kim works at Figma', b: 'Priya Patel manages infrastructure at Cloudflare', expected: 'low' },
  { category: 'Paraphrase', a: 'The quarterly revenue increased by 15% compared to last year', b: 'Year-over-year quarterly earnings grew fifteen percent', expected: 'high' },
  { category: 'Paraphrase', a: 'The company switched from Slack to Teams', b: 'We migrated our chat platform from Slack to Microsoft Teams', expected: 'high' },
  { category: 'Topic', a: 'Kubernetes cluster autoscaling and resource optimization', b: 'Docker container orchestration and horizontal pod scaling', expected: 'medium' },
  { category: 'Topic', a: 'React server components and SSR', b: 'Database sharding for write workloads', expected: 'low' },
  { category: 'Temporal', a: 'Our AWS bill was $47,000 last month', b: 'Our AWS bill was $52,000 last month', expected: 'high' },
  { category: 'Temporal', a: 'Sarah is a senior product designer', b: 'Sarah has been promoted to VP of Design', expected: 'medium' },
  { category: 'Negation', a: 'John is considering moving to Austin', b: 'John decided against moving to Austin', expected: 'medium' },
  { category: 'Negation', a: 'The code freeze is scheduled for Q2', b: 'The Q2 code freeze was pushed to Q3', expected: 'medium' },
  { category: 'Cross-domain', a: 'Machine learning model deployment on edge devices', b: 'Remember to buy avocados and sourdough bread', expected: 'low' },
  { category: 'Cross-domain', a: 'Reduce API latency to under 200ms p99', b: 'My flight to Tokyo departs at 2pm Friday', expected: 'low' },
]

// ============================================================================
// Types
// ============================================================================

interface PairResult {
  category: string
  score: number
  expected: 'high' | 'medium' | 'low'
}

interface RetrievalResult {
  query: string
  label: string
  rank: number | null  // rank of correct answer (1-based), null if not in top-k
  topK: Array<{ index: number; score: number; text: string }>
}

interface ModelResult {
  name: string
  modelId: string
  loadTimeMs: number | null
  singleEmbedMs: number | null
  batchEmbedMs: number | null
  batchSize: number
  dimensions: number | null
  pairResults: PairResult[]
  avgSeparation: number | null
  retrievalResults: RetrievalResult[]
  retrievalTop1: number | null  // % correct in top 1
  retrievalTop3: number | null  // % correct in top 3
  retrievalTop5: number | null  // % correct in top 5
  error: string | null
  status: 'idle' | 'loading' | 'running' | 'done' | 'error'
  progress: string
}

// ============================================================================
// Helpers
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function fmt(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-emerald-600'
  if (score >= 0.5) return 'text-amber-600'
  return 'text-red-500'
}

function expectedBadge(expected: 'high' | 'medium' | 'low'): string {
  if (expected === 'high') return 'bg-emerald-100 text-emerald-700'
  if (expected === 'medium') return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

function pctColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600'
  if (pct >= 60) return 'text-amber-600'
  return 'text-red-500'
}

// ============================================================================
// Model Runner
// ============================================================================

type PipeFn = (text: string | string[], opts?: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>

async function embedText(pipe: PipeFn, text: string): Promise<number[]> {
  const result = await pipe(text, { pooling: 'mean', normalize: true })
  return result.tolist()[0]
}

async function runBenchmark(
  modelId: string,
  onUpdate: (partial: Partial<ModelResult>) => void
): Promise<void> {
  // Load model
  onUpdate({ status: 'loading', progress: 'Loading model...' })
  const loadStart = performance.now()

  let pipe: PipeFn

  try {
    const { pipeline } = await import('@huggingface/transformers')
    const p = await pipeline('feature-extraction', modelId, { dtype: 'q8' })
    pipe = p as unknown as PipeFn
  } catch (err) {
    onUpdate({ error: `Load failed: ${err}`, status: 'error', progress: '' })
    return
  }

  const loadTimeMs = performance.now() - loadStart
  onUpdate({ loadTimeMs, status: 'running', progress: 'Single embed...' })

  // Single embed (warmup + measurement)
  const singleStart = performance.now()
  const firstVec = await embedText(pipe, CORPUS[0])
  const singleEmbedMs = performance.now() - singleStart
  const dims = firstVec.length
  onUpdate({ singleEmbedMs, dimensions: dims })

  // Batch embed — all 50 sentences, store vectors for retrieval test
  onUpdate({ progress: `Embedding corpus 0/${CORPUS.length}...` })
  const corpusVectors: number[][] = [firstVec] // reuse first
  const batchStart = performance.now()
  for (let i = 1; i < CORPUS.length; i++) {
    corpusVectors.push(await embedText(pipe, CORPUS[i]))
    if (i % 10 === 9) {
      onUpdate({ progress: `Embedding corpus ${i + 1}/${CORPUS.length}...` })
    }
  }
  const batchEmbedMs = performance.now() - batchStart + singleEmbedMs // include first
  onUpdate({ batchEmbedMs, batchSize: CORPUS.length })

  // Similarity pairs
  onUpdate({ progress: `Similarity pairs 0/${SIMILARITY_PAIRS.length}...` })
  const pairResults: PairResult[] = []
  for (let i = 0; i < SIMILARITY_PAIRS.length; i++) {
    const pair = SIMILARITY_PAIRS[i]
    const [embA, embB] = await Promise.all([
      embedText(pipe, pair.a),
      embedText(pipe, pair.b),
    ])
    pairResults.push({
      category: pair.category,
      score: cosineSimilarity(embA, embB),
      expected: pair.expected,
    })
    if (i % 4 === 3) {
      onUpdate({ progress: `Similarity pairs ${i + 1}/${SIMILARITY_PAIRS.length}...` })
    }
  }

  const highScores = pairResults.filter(p => p.expected === 'high').map(p => p.score)
  const lowScores = pairResults.filter(p => p.expected === 'low').map(p => p.score)
  const avgHigh = highScores.reduce((a, b) => a + b, 0) / highScores.length
  const avgLow = lowScores.reduce((a, b) => a + b, 0) / lowScores.length
  const avgSeparation = avgHigh - avgLow
  onUpdate({ pairResults, avgSeparation })

  // Top-K Retrieval
  onUpdate({ progress: `Retrieval queries 0/${RETRIEVAL_QUERIES.length}...` })
  const K = 5
  const retrievalResults: RetrievalResult[] = []

  for (let q = 0; q < RETRIEVAL_QUERIES.length; q++) {
    const rq = RETRIEVAL_QUERIES[q]
    const queryVec = await embedText(pipe, rq.query)

    // Score against all corpus vectors
    const scored = corpusVectors.map((cv, idx) => ({
      index: idx,
      score: cosineSimilarity(queryVec, cv),
      text: CORPUS[idx],
    }))
    scored.sort((a, b) => b.score - a.score)

    const topK = scored.slice(0, K)
    const rankIdx = topK.findIndex(s => s.index === rq.correctIndex)
    const rank = rankIdx >= 0 ? rankIdx + 1 : null

    retrievalResults.push({
      query: rq.query,
      label: rq.label,
      rank,
      topK: topK.map(s => ({
        index: s.index,
        score: s.score,
        text: s.text.length > 60 ? s.text.slice(0, 57) + '...' : s.text,
      })),
    })

    if (q % 5 === 4) {
      onUpdate({ progress: `Retrieval queries ${q + 1}/${RETRIEVAL_QUERIES.length}...` })
    }
  }

  const total = retrievalResults.length
  const retrievalTop1 = Math.round((retrievalResults.filter(r => r.rank === 1).length / total) * 100)
  const retrievalTop3 = Math.round((retrievalResults.filter(r => r.rank !== null && r.rank <= 3).length / total) * 100)
  const retrievalTop5 = Math.round((retrievalResults.filter(r => r.rank !== null).length / total) * 100)

  onUpdate({ retrievalResults, retrievalTop1, retrievalTop3, retrievalTop5, status: 'done', progress: '' })

  // Console log
  console.log(`[EmbeddingTest] ${modelId}`, {
    loadTimeMs: Math.round(loadTimeMs),
    perItemMs: Math.round(batchEmbedMs / CORPUS.length),
    avgSeparation: avgSeparation.toFixed(4),
    retrievalTop1: `${retrievalTop1}%`,
    retrievalTop3: `${retrievalTop3}%`,
    retrievalTop5: `${retrievalTop5}%`,
    misses: retrievalResults.filter(r => r.rank === null).map(r => r.label),
  })
}

// ============================================================================
// Result Card
// ============================================================================

const ResultCard: React.FC<{
  result: ModelResult
  isRunning: boolean
  onRun: () => void
}> = ({ result, isRunning, onRun }) => {
  const [showPairs, setShowPairs] = useState(false)
  const [showRetrieval, setShowRetrieval] = useState(false)
  const [expandedQuery, setExpandedQuery] = useState<number | null>(null)

  const perItem = result.batchEmbedMs !== null && result.batchSize > 0
    ? result.batchEmbedMs / result.batchSize
    : null

  return (
    <div className="border border-slate-200 rounded p-2 flex-1 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] font-bold text-slate-700 truncate">{result.name}</span>
        <button
          onClick={onRun}
          disabled={isRunning}
          className="ml-auto shrink-0 flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {result.status === 'loading' || result.status === 'running' ? (
            <Loader2 size={9} className="animate-spin" />
          ) : (
            <Play size={9} />
          )}
          {result.status === 'loading' ? 'Loading...' : result.status === 'running' ? 'Testing...' : 'Run'}
        </button>
      </div>

      <div className="text-[9px] text-slate-400 mb-1.5 truncate">{result.modelId}</div>

      {/* Progress */}
      {result.progress && (
        <div className="text-[9px] text-blue-500 mb-1.5 animate-pulse">{result.progress}</div>
      )}

      {/* Performance table */}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] mb-2">
        <span className="text-slate-400">Model load</span>
        <span className={`font-mono ${result.loadTimeMs !== null ? 'text-slate-700' : 'text-slate-300'}`}>
          {fmt(result.loadTimeMs)}
        </span>

        <span className="text-slate-400">Single embed</span>
        <span className={`font-mono ${result.singleEmbedMs !== null ? 'text-slate-700' : 'text-slate-300'}`}>
          {fmt(result.singleEmbedMs)}
        </span>

        <span className="text-slate-400">Batch ({result.batchSize})</span>
        <span className={`font-mono ${result.batchEmbedMs !== null ? 'text-slate-700' : 'text-slate-300'}`}>
          {fmt(result.batchEmbedMs)}
        </span>

        <span className="text-slate-400">Per item</span>
        <span className={`font-mono ${perItem !== null ? 'text-slate-700' : 'text-slate-300'}`}>
          {fmt(perItem)}
        </span>

        <span className="text-slate-400">Dimensions</span>
        <span className={`font-mono ${result.dimensions !== null ? 'text-slate-700' : 'text-slate-300'}`}>
          {result.dimensions ?? '—'}
        </span>

        <span className="text-slate-400 font-medium">Separation</span>
        <span className={`font-mono font-medium ${result.avgSeparation !== null ? 'text-emerald-600' : 'text-slate-300'}`}>
          {result.avgSeparation !== null ? result.avgSeparation.toFixed(4) : '—'}
        </span>
      </div>

      {/* Retrieval accuracy — the headline metric */}
      {result.retrievalTop5 !== null && (
        <div className="border border-slate-100 rounded px-2 py-1.5 mb-2 bg-slate-50">
          <div className="text-[9px] font-medium text-slate-500 mb-1">Retrieval Accuracy ({RETRIEVAL_QUERIES.length} queries)</div>
          <div className="flex gap-3 text-[10px]">
            <div className="text-center">
              <div className={`font-mono font-bold text-sm ${pctColor(result.retrievalTop1!)}`}>{result.retrievalTop1}%</div>
              <div className="text-slate-400 text-[8px]">Top-1</div>
            </div>
            <div className="text-center">
              <div className={`font-mono font-bold text-sm ${pctColor(result.retrievalTop3!)}`}>{result.retrievalTop3}%</div>
              <div className="text-slate-400 text-[8px]">Top-3</div>
            </div>
            <div className="text-center">
              <div className={`font-mono font-bold text-sm ${pctColor(result.retrievalTop5!)}`}>{result.retrievalTop5}%</div>
              <div className="text-slate-400 text-[8px]">Top-5</div>
            </div>
          </div>
        </div>
      )}

      {/* Expandable sections */}
      <div className="flex-1 overflow-auto space-y-1">
        {/* Retrieval details */}
        {result.retrievalResults.length > 0 && (
          <div>
            <button
              onClick={() => setShowRetrieval(p => !p)}
              className="flex items-center gap-1 text-[9px] font-medium text-slate-500 hover:text-slate-700 w-full"
            >
              {showRetrieval ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Retrieval Details
              <span className="text-slate-300 ml-1">
                {result.retrievalResults.filter(r => r.rank === null).length} misses
              </span>
            </button>
            {showRetrieval && (
              <div className="mt-1 space-y-0.5">
                {result.retrievalResults.map((rr, i) => (
                  <div key={i}>
                    <button
                      onClick={() => setExpandedQuery(expandedQuery === i ? null : i)}
                      className="flex items-center gap-1 text-[9px] w-full hover:bg-slate-50 rounded px-0.5"
                    >
                      {rr.rank !== null ? (
                        <span className={`font-mono font-medium w-[18px] text-right ${rr.rank === 1 ? 'text-emerald-600' : rr.rank <= 3 ? 'text-amber-600' : 'text-blue-500'}`}>
                          #{rr.rank}
                        </span>
                      ) : (
                        <span className="font-mono font-medium w-[18px] text-right text-red-500">✗</span>
                      )}
                      <span className="text-slate-400 truncate flex-1 text-left">{rr.label}</span>
                    </button>
                    {expandedQuery === i && (
                      <div className="ml-5 mt-0.5 mb-1 p-1 bg-slate-50 rounded text-[8px] space-y-0.5">
                        <div className="text-slate-500 font-medium">Q: "{rr.query}"</div>
                        {rr.topK.map((tk, j) => (
                          <div key={j} className={`flex gap-1 ${tk.index === RETRIEVAL_QUERIES[i].correctIndex ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                            <span className="font-mono w-[14px] text-right shrink-0">{j + 1}.</span>
                            <span className="font-mono w-[36px] shrink-0">{tk.score.toFixed(3)}</span>
                            <span className="truncate">{tk.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Similarity pairs */}
        {result.pairResults.length > 0 && (
          <div>
            <button
              onClick={() => setShowPairs(p => !p)}
              className="flex items-center gap-1 text-[9px] font-medium text-slate-500 hover:text-slate-700 w-full"
            >
              {showPairs ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Similarity Pairs
            </button>
            {showPairs && (
              <div className="mt-1 space-y-0.5">
                {result.pairResults.map((pair, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px]">
                    <span className={`px-1 py-0 rounded text-[8px] font-medium ${expectedBadge(pair.expected)}`}>
                      {pair.expected}
                    </span>
                    <span className="text-slate-400 w-[60px] truncate">{pair.category}</span>
                    <span className={`font-mono font-medium ${scoreColor(pair.score)}`}>
                      {pair.score.toFixed(4)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {result.error && (
        <div className="mt-1.5 text-[9px] text-red-500 bg-red-50 rounded px-1.5 py-1">{result.error}</div>
      )}

      {/* Status */}
      {result.status === 'done' && (
        <div className="mt-1.5 text-[9px] text-emerald-500 font-medium">Complete</div>
      )}
    </div>
  )
}

// ============================================================================
// Widget
// ============================================================================

const MODELS: Array<{ name: string; modelId: string }> = [
  { name: 'MiniLM-L6-v2', modelId: 'Xenova/all-MiniLM-L6-v2' },
  { name: 'BGE-small-v1.5', modelId: 'Xenova/bge-small-en-v1.5' },
]

const makeInitial = (m: typeof MODELS[number]): ModelResult => ({
  name: m.name,
  modelId: m.modelId,
  loadTimeMs: null,
  singleEmbedMs: null,
  batchEmbedMs: null,
  batchSize: CORPUS.length,
  dimensions: null,
  pairResults: [],
  avgSeparation: null,
  retrievalResults: [],
  retrievalTop1: null,
  retrievalTop3: null,
  retrievalTop5: null,
  error: null,
  status: 'idle',
  progress: '',
})

export const EmbeddingTestWidget: React.FC<WidgetProps> = () => {
  const [results, setResults] = useState<ModelResult[]>(MODELS.map(makeInitial))
  const runningRef = useRef(false)

  const updateResult = useCallback((index: number, partial: Partial<ModelResult>) => {
    setResults(prev => prev.map((r, i) => i === index ? { ...r, ...partial } : r))
  }, [])

  const runModel = useCallback(async (index: number) => {
    if (runningRef.current) return
    runningRef.current = true
    updateResult(index, makeInitial(MODELS[index]))
    await runBenchmark(MODELS[index].modelId, (partial) => updateResult(index, partial))
    runningRef.current = false
  }, [updateResult])

  const runAll = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    for (let i = 0; i < MODELS.length; i++) {
      updateResult(i, makeInitial(MODELS[i]))
    }
    for (let i = 0; i < MODELS.length; i++) {
      await runBenchmark(MODELS[i].modelId, (partial) => updateResult(i, partial))
    }
    runningRef.current = false
  }, [updateResult])

  const anyRunning = results.some(r => r.status === 'loading' || r.status === 'running')

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"lucide:flask-conical","title":"Embedding Test","desc":"Compare embedding model speed and quality."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-slate-100 flex items-center gap-1.5">
        <FlaskConical size={12} className="text-purple-500 shrink-0" />
        <span className="text-[11px] font-medium text-slate-700">Embedding Benchmark</span>
        <button
          onClick={runAll}
          disabled={anyRunning}
          className="ml-auto flex items-center gap-1 text-[9px] px-2 py-0.5 rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50"
        >
          {anyRunning ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
          Run All
        </button>
      </div>

      {/* Test info */}
      <div className="flex-shrink-0 px-2 py-1 text-[9px] text-slate-400 border-b border-slate-50">
        {CORPUS.length} corpus · {RETRIEVAL_QUERIES.length} retrieval queries · {SIMILARITY_PAIRS.length} sim pairs
      </div>

      {/* Model cards */}
      <div className="flex-1 overflow-hidden p-2 flex gap-2">
        {results.map((result, i) => (
          <ResultCard
            key={result.modelId}
            result={result}
            isRunning={anyRunning}
            onRun={() => runModel(i)}
          />
        ))}
      </div>
    </div>
  )
}
