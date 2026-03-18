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
 * File Upload Service — File System Access API + DuckDB metadata
 *
 * ARCHITECTURE: Users grant folder access once → files are copied there → metadata in DuckDB.
 */

import { createLogger } from '../program/utils/logger'

const logger = createLogger('FileUpload')

// IndexedDB key for persisting the directory handle
const IDB_STORE_NAME = 'ramble-file-handles'
const IDB_KEY = 'upload-folder'

// Supported file types
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'xml', 'html', 'htm'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'doc'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'])

export interface UploadedFileInfo {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  fileExtension: string
  storagePath: string
  status: string
  previewText?: string
  metadata: Record<string, unknown>
  createdAt: number
}

export type FileUploadResult = {
  uploadedFile: UploadedFileInfo
  previewText: string
  isImage: boolean
}

// ============================================================================
// Directory Handle Persistence (IndexedDB)
// ============================================================================

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

let cachedDirHandle: FileSystemDirectoryHandle | null = null

export async function getUploadFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) {
    logger.warn('File System Access API not available — file uploads disabled')
    return null
  }

  if (cachedDirHandle) {
    const permission = await cachedDirHandle.queryPermission({ mode: 'readwrite' })
    if (permission === 'granted') return cachedDirHandle
  }

  const saved = await loadDirectoryHandle()
  if (saved) {
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
    if ((err as Error).name === 'AbortError') {
      logger.info('User cancelled folder picker')
      return null
    }
    logger.error('Failed to get upload folder', { error: err })
    return null
  }
}

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

function getExtension(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
}

function isImageFile(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension)
}

function isTextFile(extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension)
}

async function extractPreviewText(file: File, extension: string): Promise<string> {
  if (isTextFile(extension)) {
    try {
      const text = await file.text()
      const firstParagraph = text.split(/\n\s*\n/)[0] ?? text
      return firstParagraph.slice(0, 500).trim()
    } catch {
      return `[${file.name}]`
    }
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return `[Document: ${file.name}]`
  }

  if (isImageFile(extension)) {
    return `[Image: ${file.name}]`
  }

  return `[File: ${file.name}]`
}

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

export async function uploadFile(file: File): Promise<FileUploadResult> {
  const dirHandle = await getUploadFolder()
  if (!dirHandle) {
    throw new Error('No upload folder available — user must grant folder access first')
  }

  const extension = getExtension(file.name)
  const isImage = isImageFile(extension)

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
    metadata.documentType = extension
  }

  // Save to DuckDB as a graph node
  const { graphMutations } = await import('../graph/data')
  const node = await graphMutations.createNode(
    ['uploaded_file'],
    {
      fileName: file.name,
      fileType: file.type || `application/${extension}`,
      fileSize: file.size,
      fileExtension: extension,
      storagePath: storageName,
      status: 'pending',
      previewText,
      metadata,
    }
  )

  const uploadedFile: UploadedFileInfo = {
    id: node.id,
    fileName: file.name,
    fileType: file.type || `application/${extension}`,
    fileSize: file.size,
    fileExtension: extension,
    storagePath: storageName,
    status: 'pending',
    previewText,
    metadata,
    createdAt: node.created_at,
  }

  return { uploadedFile, previewText, isImage }
}

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

export function isSupportedFileType(fileName: string): boolean {
  const ext = getExtension(fileName)
  return TEXT_EXTENSIONS.has(ext) || DOCUMENT_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)
}

export function getSupportedTypesDescription(): string {
  return 'Text (TXT, MD, CSV, JSON), Documents (PDF, DOCX), Images (PNG, JPG, WEBP, GIF)'
}
