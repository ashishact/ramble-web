/**
 * Claim Debug Panel
 *
 * Shows source tracking information for debugging claim extraction issues
 * - Original transcript text with highlighting
 * - Extractor and pattern information
 * - LLM prompt and response
 */

import { Icon } from '@iconify/react';
import type { Claim } from '../../program/types';

interface ClaimDebugPanelProps {
  claim: Claim;
  onClose: () => void;
}

export function ClaimDebugPanel({ claim, onClose }: ClaimDebugPanelProps) {
  const { source_tracking } = claim;

  if (!source_tracking) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-base-200 rounded-lg shadow-xl max-w-4xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Source Tracking</h2>
            <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
              <Icon icon="mdi:close" className="w-5 h-5" />
            </button>
          </div>
          <div className="alert alert-warning">
            <Icon icon="mdi:alert" className="w-5 h-5" />
            <span>No source tracking information available for this claim.</span>
          </div>
        </div>
      </div>
    );
  }

  // Highlight the relevant portion of text if positions are available
  const highlightedText = () => {
    if (!source_tracking.char_start || !source_tracking.char_end) {
      return source_tracking.unit_text;
    }

    const before = source_tracking.unit_text.slice(0, source_tracking.char_start);
    const highlighted = source_tracking.unit_text.slice(source_tracking.char_start, source_tracking.char_end);
    const after = source_tracking.unit_text.slice(source_tracking.char_end);

    return (
      <>
        <span className="text-base-content/60">{before}</span>
        <mark className="bg-warning/30 px-1 rounded">{highlighted}</mark>
        <span className="text-base-content/60">{after}</span>
      </>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-base-200 rounded-lg shadow-xl max-w-6xl w-full my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-base-300">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Icon icon="mdi:bug" className="w-6 h-6 text-warning" />
              Claim Source Tracking
            </h2>
            <p className="text-sm text-base-content/60 mt-1">Debug information for this claim</p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm btn-circle">
            <Icon icon="mdi:close" className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Claim Statement */}
          <div className="card bg-base-100">
            <div className="card-body">
              <h3 className="card-title text-lg flex items-center gap-2">
                <Icon icon="mdi:text-box" className="w-5 h-5" />
                Extracted Claim
              </h3>
              <p className="text-base-content font-medium">{claim.statement}</p>
              <div className="flex gap-2 mt-2">
                <div className="badge badge-primary">{claim.claim_type}</div>
                <div className="badge badge-outline">Confidence: {(claim.current_confidence * 100).toFixed(0)}%</div>
              </div>
            </div>
          </div>

          {/* Extractor Information */}
          <div className="card bg-base-100">
            <div className="card-body">
              <h3 className="card-title text-lg flex items-center gap-2">
                <Icon icon="mdi:robot" className="w-5 h-5" />
                Extractor Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-base-content/60">Extractor ID</div>
                  <div className="font-mono text-sm bg-base-200 px-2 py-1 rounded mt-1">
                    {claim.extraction_program_id}
                  </div>
                </div>
                {source_tracking.pattern_id && (
                  <div>
                    <div className="text-sm text-base-content/60">Pattern Matched</div>
                    <div className="font-mono text-sm bg-base-200 px-2 py-1 rounded mt-1">
                      {source_tracking.pattern_id}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Original Transcript */}
          <div className="card bg-base-100">
            <div className="card-body">
              <h3 className="card-title text-lg flex items-center gap-2">
                <Icon icon="mdi:message-text" className="w-5 h-5" />
                Original Transcript
                {source_tracking.char_start !== null && source_tracking.char_end !== null && (
                  <span className="badge badge-sm">
                    chars {source_tracking.char_start}-{source_tracking.char_end}
                  </span>
                )}
              </h3>
              <div className="prose max-w-none">
                <p className="text-base leading-relaxed whitespace-pre-wrap">
                  {highlightedText()}
                </p>
              </div>
              {source_tracking.unit_id && (
                <div className="text-xs text-base-content/50 mt-2">
                  Unit ID: <code className="bg-base-200 px-1 py-0.5 rounded">{source_tracking.unit_id}</code>
                </div>
              )}
            </div>
          </div>

          {/* LLM Prompt */}
          {source_tracking.llm_prompt && (
            <div className="card bg-base-100">
              <div className="card-body">
                <h3 className="card-title text-lg flex items-center gap-2">
                  <Icon icon="mdi:file-document-edit" className="w-5 h-5" />
                  LLM Prompt Sent
                </h3>
                <div className="collapse collapse-arrow bg-base-200">
                  <input type="checkbox" />
                  <div className="collapse-title font-medium">Click to expand prompt</div>
                  <div className="collapse-content">
                    <pre className="text-xs whitespace-pre-wrap bg-base-300 p-4 rounded mt-2 max-h-96 overflow-auto">
                      {source_tracking.llm_prompt}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* LLM Response */}
          {source_tracking.llm_response && (
            <div className="card bg-base-100">
              <div className="card-body">
                <h3 className="card-title text-lg flex items-center gap-2">
                  <Icon icon="mdi:robot-happy" className="w-5 h-5" />
                  LLM Response Received
                </h3>
                <div className="collapse collapse-arrow bg-base-200">
                  <input type="checkbox" defaultChecked />
                  <div className="collapse-title font-medium">Click to collapse response</div>
                  <div className="collapse-content">
                    <pre className="text-xs whitespace-pre-wrap bg-base-300 p-4 rounded mt-2 max-h-96 overflow-auto">
                      {source_tracking.llm_response}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Warning */}
          <div className="alert alert-info">
            <Icon icon="mdi:information" className="w-5 h-5" />
            <div className="flex-1">
              <div className="font-semibold">Debugging Tips</div>
              <div className="text-sm mt-1">
                • Check if the highlighted text actually supports the claim<br />
                • Look for transcription errors in the original text<br />
                • Review the LLM response to see if it misinterpreted the prompt<br />
                • Verify the pattern match is appropriate for this extractor
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-6 border-t border-base-300">
          <button onClick={onClose} className="btn btn-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
