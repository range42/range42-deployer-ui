/** JSON-safe authored files. Git stores decoded bytes, never the base64 wrapper. */
import { encodeContentBase64, decodeBytesBase64 } from './git/encoding'

export interface BinaryFile {
  encoding: 'base64'
  content: string
  size: number
  media_type?: string
}
export type FileContent = string | BinaryFile
export type ProjectFiles = Record<string, FileContent>
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024

export function isBinaryFile(value: unknown): value is BinaryFile {
  return !!value && typeof value === 'object' && 'encoding' in value && value.encoding === 'base64'
    && 'content' in value && typeof value.content === 'string' && 'size' in value && Number.isInteger(value.size)
    && (!('media_type' in value) || typeof value.media_type === 'string')
}

export function validateFilePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error(`Invalid repository file path: ${path}. Use a relative path without traversal or control characters.`)
  }
}

export function fileBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (!isBinaryFile(value)) throw new Error('Invalid file content: expected text or a base64 asset with an integer size.')
  if (value.size < 0 || value.size > MAX_FILE_BYTES || value.content.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    throw new Error('The 1 MiB per-file limit was exceeded. Use a smaller file.')
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.content)) {
    throw new Error('Invalid base64 asset content.')
  }
  const binary = atob(value.content)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (bytes.length !== value.size) throw new Error('Binary file size does not match its decoded content.')
  if (encodeContentBase64(bytes) !== value.content) throw new Error('Invalid non-canonical base64 asset content.')
  return bytes
}

export function assetFromBytes(bytes: Uint8Array, mediaType = 'application/octet-stream'): BinaryFile {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('The 1 MiB per-file limit was exceeded. Use a smaller file.')
  return { encoding: 'base64', content: encodeContentBase64(bytes), size: bytes.byteLength, media_type: mediaType }
}

export function validateFileMap(files: unknown): asserts files is ProjectFiles {
  if (!files || typeof files !== 'object' || Array.isArray(files)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(files))) throw new Error('Invalid project file map: expected an object mapping relative paths to file content.')
  let total = 0
  for (const [path, value] of Object.entries(files)) {
    validateFilePath(path)
    const size = fileBytes(value).byteLength
    if (size > MAX_FILE_BYTES) throw new Error(`The 1 MiB per-file limit was exceeded: ${path}. Use a smaller file.`)
    total += size
    if (total > MAX_PROJECT_FILE_BYTES) throw new Error('The 2 MiB project file limit was exceeded. Remove files or use smaller assets.')
  }
}

export function fileContentEquals(a: FileContent | undefined, b: FileContent | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  const left = fileBytes(a), right = fileBytes(b)
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

export function fileBase64(content: FileContent): string {
  return encodeContentBase64(fileBytes(content))
}

/** UTF-8 text stays compatible; undecodable bytes and NUL-bearing data stay binary. */
export function contentFromBase64(base64: string): FileContent {
  const bytes = decodeBytesBase64(base64)
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (!text.includes('\0')) return text
  } catch { /* Non-UTF-8 data belongs in the binary asset view. */ }
  return assetFromBytes(bytes)
}

export function fileText(content: FileContent): string {
  if (typeof content !== 'string') throw new Error('Binary file cannot be opened as text. Download or replace the asset instead.')
  return content
}

export function cloneFiles(files: ProjectFiles): ProjectFiles {
  validateFileMap(files)
  return Object.fromEntries(Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? value : { ...value }]))
}

export function authoredFilesMetadata(files: ProjectFiles = {}) {
  validateFileMap(files)
  const binary = Object.fromEntries(Object.entries(files).filter(([, value]) => isBinaryFile(value)).map(([path, value]) => {
    if (!isBinaryFile(value)) throw new Error('Invalid binary file metadata')
    const { content: _content, ...metadata } = value
    return [path, metadata]
  }))
  return { ui_files: Object.keys(files), ...(Object.keys(binary).length ? { ui_binary_files: binary } : {}) }
}

export function restoreBinaryFile(content: FileContent, metadata: unknown): BinaryFile {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid binary file metadata')
  const asset = { ...metadata, content: fileBase64(content) }
  if (!isBinaryFile(asset)) throw new Error('Invalid binary file metadata type or size')
  fileBytes(asset)
  return { encoding: 'base64', content: asset.content, size: asset.size, ...(asset.media_type ? { media_type: asset.media_type } : {}) }
}


export function decodeGitFileContent(body: { encoding?: string; content?: string; size?: number }): FileContent {
  if (typeof body.content !== 'string') throw new Error('Git file content is unavailable. Retry the read before saving.')
  let content: FileContent
  if (body.encoding === 'base64') content = contentFromBase64(body.content)
  else if (body.encoding === 'utf-8' || body.encoding === 'text') content = body.content
  else throw new Error(`Unsupported Git file encoding: ${body.encoding || '(missing)'}. The file was not loaded.`)
  if (body.size !== undefined && fileBytes(content).byteLength !== body.size) throw new Error('Git file content size mismatch. Retry the read before saving.')
  return content
}


const RESERVED_PROJECT_FILES = new Set(['meta.json', 'overlay.json', 'canvas_layout.json', 'topology.json', '.lock'])
export function validateAuthoredFilePath(path: string): void {
  validateFilePath(path)
  if (RESERVED_PROJECT_FILES.has(path)) throw new Error(`Reserved project document path: ${path}. Choose a path inside content/ or scenarios/.`)
}

export function validateAuthoredFiles(files: unknown): asserts files is ProjectFiles {
  validateFileMap(files)
  for (const path of Object.keys(files)) validateAuthoredFilePath(path)
}
