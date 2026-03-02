/**
 * Document Processor — File Upload Handling
 *
 * VISION: Documents get acknowledged and stored. We extract topics (what it's
 * about) but NOT entities (who specifically). Uploaded content could be
 * third-party material — entities would be noise. Topics are safe because
 * they describe the subject area, not specific people/organizations.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * On file upload:
 *   1. Extract text preview (first ~500 chars + filename)
 *   2. Create a Recording of type 'document' / 'image'
 *   3. System I: reads preview text, extracts topic hints
 *   4. System II: creates a low-confidence memory noting the file was uploaded,
 *      links to topic hints
 *   5. Store file reference in uploaded_files table for future deep extraction
 *
 * Future: deep extraction with user confirmation for entity extraction
 * from trusted documents.
 */

import { recordingManager } from '../kernel/recordingManager'
import { getKernel } from '../kernel/kernel'
import { createLogger } from '../utils/logger'
import type { RecordingType } from '../types/recording'

const logger = createLogger('FileUpload')

// ============================================================================
// Document Processing Pipeline
// ============================================================================

/**
 * Process an uploaded file through the unified pipeline.
 *
 * Creates a Recording of the appropriate type, adds the preview text
 * as a chunk, then submits to the kernel for System II processing.
 *
 * The confidence will be low because uploaded content has no effort filter
 * (information density weighting — throughputRate is effectively infinite
 * for pasted/uploaded content).
 *
 * @param fileName - Original filename
 * @param previewText - Extracted text preview (first ~500 chars)
 * @param fileType - MIME type of the file
 */
export async function processUploadedDocument(
  fileName: string,
  previewText: string,
  fileType: string,
): Promise<void> {
  if (!previewText.trim()) {
    logger.info('Skipping empty document', { fileName })
    return
  }

  // Determine recording type from MIME type
  const recordingType: RecordingType = fileType.startsWith('image/') ? 'image' : 'document'

  try {
    // Create a recording for this document
    const recording = recordingManager.start(recordingType, { origin: 'in-app' })

    // Add preview text as a single chunk
    recordingManager.addChunk(
      `[Uploaded file: ${fileName}]\n${previewText}`,
    )

    // End the recording (calculates throughputRate — will be very high for instant uploads)
    recordingManager.end()

    // Submit to kernel for processing
    // Source = 'text' because this is uploaded content, not speech
    // The low confidence comes from the origin='document' set in memoryStore
    const kernel = getKernel()
    await kernel.submitInput(
      `[Uploaded file: ${fileName}]\n${previewText}`,
      'text',
    )

    logger.info('Document processed through pipeline', {
      fileName,
      recordingId: recording.id,
      type: recordingType,
      previewLength: previewText.length,
    })
  } catch (error) {
    logger.error('Document processing failed', {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
