// File System Access API type augmentations (not yet in standard DOM lib)
declare global {
  interface FileSystemHandle {
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
  interface Window {
    showDirectoryPicker?(options?: {
      mode?: 'read' | 'readwrite'
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
    }): Promise<FileSystemDirectoryHandle>
  }
}

/**
 * File Upload Service — File System Access API + WatermelonDB metadata
 *
 * ARCHITECTURE: Users grant folder access once → files are copied there → metadata in DB.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Flow:
 * 1. User drops/selects file → requestFolderAccess() if not already granted
 * 2. File is copied to the user-selected folder
 * 3. Preview text extracted (first paragraph for text, filename for images)
 * 4. Metadata saved to uploaded_files table
 * 5. Recording created → routed through unified pipeline
 *
 * The File System Access API (showDirectoryPicker) gives us a persistent
 * handle to a folder the user chooses. We save this handle to IndexedDB
 * so it persists across sessions. On file drop, we copy the file there.
 *
 * Supported formats:
 * - Text: PDF, TXT, MD, DOCX (text extraction)
 * - Images: PNG, JPG, WEBP (metadata only — dimensions, size)
 *
 * WHY local storage? Privacy. Files never leave the user's machine.
 * Ramble processes them locally and only extracts topics, not entities
 * (uploaded content could be third-party noise).
 */

import { uploadedFileStore } from '../db/stores/uploadedFileStore'
import type UploadedFile from '../db/models/UploadedFile'
import { createLogger } from '../program/utils/logger'

const logger = createLogger('FileUpload')

// IndexedDB key for persisting the directory handle
const IDB_STORE_NAME = 'ramble-file-handles'
const IDB_KEY = 'upload-folder'

// Supported file types
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'html', 'htm'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'doc'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])

export type FileUploadResult = {
  uploadedFile: UploadedFile
  previewText: string
  isImage: boolean
}

// ============================================================================
// Directory Handle Persistence (IndexedDB)
// ============================================================================

/**
 * Save a directory handle to IndexedDB for persistence across sessions.
 */
async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_STORE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('handles', 'readwrite')
      tx.objectStore('handles').put(handle, IDB_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Load a previously saved directory handle from IndexedDB.
 * Returns null if no handle was saved or if IndexedDB is unavailable.
 */
async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_STORE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('handles', 'readonly')
      const getReq = tx.objectStore('handles').get(IDB_KEY)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result ?? null)
      }
      getReq.onerror = () => { db.close(); resolve(null) }
    }
    request.onerror = () => resolve(null)
  })
}

// ============================================================================
// File System Access
// ============================================================================

/** Cached directory handle for the current session */
let cachedDirHandle: FileSystemDirectoryHandle | null = null

/**
 * Get a directory handle — either from cache, IndexedDB, or prompt the user.
 * Returns null if the user cancels the picker or the API is unavailable.
 */
export async function getUploadFolder(): Promise<FileSystemDirectoryHandle | null> {
  // Check if File System Access API is available
  if (!window.showDirectoryPicker) {
    logger.warn('File System Access API not available — file uploads disabled')
    return null
  }

  // Use cached handle if available
  if (cachedDirHandle) {
    // Verify we still have permission
    const permission = await cachedDirHandle.queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') return cachedDirHandle
  }

  // Try loading from IndexedDB
  const saved = await loadDirectoryHandle()
  if (saved) {
    // Re-request permission (handles expire between sessions)
    try {
      const permission = await saved.requestPermission({ mode: 'readwrite' })
      if (permission === 'granted') {
        cachedDirHandle = saved
        return saved
      }
    } catch {
      // Permission denied or handle invalid — fall through to picker
    }
  }

  // Prompt user to select a folder
  try {
    const handle = await window.showDirectoryPicker!({
      mode: 'readwrite',
      startIn: 'documents',
    })
    cachedDirHandle = handle
    await saveDirectoryHandle(handle)
    logger.info('Upload folder selected', { name: handle.name })
    return handle
  } catch (err) {
    // User cancelled the picker
    if ((err as Error).name === 'AbortError') {
      logger.info('User cancelled folder picker')
      return null
    }
    logger.error('Failed to get upload folder', { error: err })
    return null
  }
}

/**
 * Check if we have a valid upload folder without prompting.
 */
export async function hasUploadFolder(): Promise<boolean> {
  if (cachedDirHandle) {
    const permission = await cachedDirHandle.queryPermission({ mode: 'readwrite' })
    return permission === 'granted'
  }
  const saved = await loadDirectoryHandle()
  if (saved) {
    const permission = await saved.queryPermission({ mode: 'readwrite' })
    return permission === 'granted'
  }
  return false
}

// ============================================================================
// File Processing
// ============================================================================

/**
 * Get file extension from a filename, without the dot.
 */
function getExtension(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

/**
 * Determine if a file is an image based on its extension.
 */
function isImageFile(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension)
}

/**
 * Determine if a file is a text-based file we can extract content from.
 */
function isTextFile(extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension)
}

/**
 * Extract preview text from a file.
 * - Text files: first ~500 chars
 * - Documents: filename (deep extraction is a future feature)
 * - Images: filename + dimensions if available
 */
async function extractPreviewText(file: File, extension: string): Promise<string> {
  if (isTextFile(extension)) {
    try {
      const text = await file.text()
      // First paragraph or first 500 chars
      const firstParagraph = text.split(/\n\s*\n/)[0] ?? text
      return firstParagraph.slice(0, 500).trim()
    } catch {
      return `[${file.name}]`
    }
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    // Deep text extraction is a Phase 6 feature.
    // For now, use the filename as preview.
    return `[Document: ${file.name}]`
  }

  if (isImageFile(extension)) {
    return `[Image: ${file.name}]`
  }

  return `[File: ${file.name}]`
}

/**
 * Extract metadata from an image file (dimensions).
 */
async function extractImageMetadata(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

// ============================================================================
// Main Upload API
// ============================================================================

/**
 * Upload a file: copy to user folder, extract preview, save metadata.
 *
 * @param file - The File object from a drop event or file input
 * @returns Upload result with metadata, preview text, and whether it's an image
 * @throws If no upload folder is available
 */
export async function uploadFile(file: File): Promise<FileUploadResult> {
  const dirHandle = await getUploadFolder()
  if (!dirHandle) {
    throw new Error('No upload folder available — user must grant folder access first')
  }

  const extension = getExtension(file.name)
  const isImage = isImageFile(extension)

  // Generate unique filename to avoid collisions
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storageName = `${timestamp}_${safeName}`

  // Copy file to user folder
  const fileHandle = await dirHandle.getFileHandle(storageName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(file)
  await writable.close()

  logger.info('File copied to upload folder', {
    name: file.name,
    storageName,
    size: file.size,
    type: file.type,
  })

  // Extract preview text
  const previewText = await extractPreviewText(file, extension)

  // Build metadata
  const metadata: Record<string, unknown> = {}
  if (isImage) {
    const dims = await extractImageMetadata(file)
    if (dims) {
      metadata.width = dims.width
      metadata.height = dims.height
    }
  }
  if (DOCUMENT_EXTENSIONS.has(extension)) {
    // Page count extraction is a future feature for PDFs
    metadata.documentType = extension
  }

  // Save to DB
  const uploadedFile = await uploadedFileStore.create({
    fileName: file.name,
    fileType: file.type || `application/${extension}`,
    fileSize: file.size,
    fileExtension: extension,
    storagePath: storageName,
    status: 'pending',
    previewText,
    metadata,
  })

  return { uploadedFile, previewText, isImage }
}

/**
 * Upload multiple files at once.
 * Each file is processed independently — failures don't block others.
 */
export async function uploadFiles(files: FileList | File[]): Promise<FileUploadResult[]> {
  const results: FileUploadResult[] = []
  for (const file of Array.from(files)) {
    try {
      const result = await uploadFile(file)
      results.push(result)
    } catch (err) {
      logger.error('Failed to upload file', { name: file.name, error: err })
    }
  }
  return results
}

/**
 * Check if a file type is supported for upload.
 */
export function isSupportedFileType(fileName: string): boolean {
  const ext = getExtension(fileName)
  return TEXT_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)
}

/**
 * Get a human-readable description of supported file types.
 */
export function getSupportedTypesDescription(): string {
  return 'Text (TXT, MD, CSV, JSON), Documents (PDF, DOCX), Images (PNG, JPG, WEBP, GIF)'
}
