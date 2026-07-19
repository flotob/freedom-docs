/**
 * Local document index + content store.
 *
 * The index (list of my docs) and each doc's working content live in
 * localStorage. Published snapshots live on Swarm; the feed manifest
 * reference is the doc's stable share address. This keeps the MVP
 * deterministic — no background sync, the app state is the source of
 * truth until you hit Publish.
 */

import { nanoid } from 'nanoid'
import type { JSONContent } from '@tiptap/core'
import { generateDocKey } from './crypto'

export const DOC_SCHEMA = 'freedom-docs/doc/1'

export type DocVersion = {
  ref: string
  publishedAt: number
}

/** A collaborator's writer stream: their feed manifest ref + display label. */
export type DocWriter = {
  label: string
  feedRef: string
}

export type DocKind = 'doc' | 'sheet'

export type DocRecord = {
  id: string
  name: string
  // 'doc' (rich text, default) or 'sheet' (spreadsheet)
  kind?: DocKind
  // Stable, shared spreadsheet id used as dsheet's internal array key. All
  // collaborators MUST use the same value or their edits key into an empty
  // array. Shared via the snapshot; owner generates it at creation.
  sheetId?: string
  createdAt: number
  updatedAt: number
  // Per-doc AES-256-GCM key (base64url). Docs created before E2EE lack it
  // until their next publish.
  keyB64?: string
  // Set once the doc has a Swarm feed (Freedom Browser)
  feedId?: string
  manifestRef?: string
  // Last published immutable snapshot
  lastPublishedRef?: string
  publishedAt?: number
  // Every published snapshot, oldest first — each ref is immutable on Swarm
  versions?: DocVersion[]
  // --- shared-doc fields ---
  // 'owner' (default) or 'collaborator' (joined via an edit link)
  role?: 'owner' | 'collaborator'
  // Collaborator only: the owner's feed manifest ref (the doc's identity)
  sharedFrom?: string
  // Owner only: accepted collaborator writer streams
  writers?: DocWriter[]
}

export type DocSnapshot = {
  schema: typeof DOC_SCHEMA
  name: string
  // 'doc' when absent (pre-sheets snapshots)
  kind?: DocKind
  // Shared dsheet key (sheets only) — collaborators must reuse it verbatim
  sheetId?: string
  // Base64-encoded Yjs full state (what the editor's onChange emits)
  content: JSONContent | string
  publishedAt: number
  // Owner snapshots only: accepted collaborator writer streams. Readers and
  // editors fetch each writer's latest snapshot and CRDT-merge the states.
  writers?: DocWriter[]
}

const INDEX_KEY = 'freedom-docs:index'
const contentKey = (id: string) => `freedom-docs:content:${id}`
// Fingerprint of the content as of the last successful save-to-Swarm.
// Survives reloads, unlike an in-memory baseline — the editor compares the
// local working copy against it to know whether unsaved changes exist.
const savedFingerprintKey = (id: string) => `freedom-docs:saved-fp:${id}`

export const getSavedFingerprint = (id: string): string | null =>
  localStorage.getItem(savedFingerprintKey(id))

export const setSavedFingerprint = (id: string, fingerprint: string) => {
  localStorage.setItem(savedFingerprintKey(id), fingerprint)
}

export const listDocs = (): DocRecord[] => {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const docs: DocRecord[] = raw ? JSON.parse(raw) : []
    return docs.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

const saveIndex = (docs: DocRecord[]) => {
  localStorage.setItem(INDEX_KEY, JSON.stringify(docs))
}

export const getDoc = (id: string): DocRecord | undefined =>
  listDocs().find((doc) => doc.id === id)

export const createDoc = (name = 'Untitled', kind: DocKind = 'doc'): DocRecord => {
  const doc: DocRecord = {
    id: nanoid(12),
    name,
    kind,
    ...(kind === 'sheet' ? { sheetId: nanoid(12) } : {}),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    keyB64: generateDocKey(),
  }
  saveIndex([doc, ...listDocs()])
  return doc
}

export const updateDoc = (
  id: string,
  patch: Partial<Omit<DocRecord, 'id'>>
): DocRecord | undefined => {
  const docs = listDocs()
  const index = docs.findIndex((doc) => doc.id === id)
  if (index === -1) return undefined
  docs[index] = { ...docs[index], ...patch, updatedAt: Date.now() }
  saveIndex(docs)
  return docs[index]
}

export const deleteDoc = (id: string) => {
  saveIndex(listDocs().filter((doc) => doc.id !== id))
  localStorage.removeItem(contentKey(id))
  localStorage.removeItem(savedFingerprintKey(id))
}

export const loadContent = (id: string): JSONContent | string | null => {
  try {
    const raw = localStorage.getItem(contentKey(id))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const saveContent = (id: string, content: JSONContent | string) => {
  localStorage.setItem(contentKey(id), JSON.stringify(content))
}

// --- Backup export/import (walk-away for the local doc list + keys) ---

export const BACKUP_SCHEMA = 'freedom-docs/backup/1'

export type DocsBackup = {
  schema: typeof BACKUP_SCHEMA
  exportedAt: number
  docs: Array<DocRecord & { content: JSONContent | string | null }>
}

export const exportBackup = (): DocsBackup => ({
  schema: BACKUP_SCHEMA,
  exportedAt: Date.now(),
  docs: listDocs().map((doc) => ({ ...doc, content: loadContent(doc.id) })),
})

/** Merge a backup into this device; existing docs win on newer updatedAt. */
export const importBackup = (backup: DocsBackup): number => {
  if (backup?.schema !== BACKUP_SCHEMA || !Array.isArray(backup.docs)) {
    throw new Error('Not a Freedom Docs backup file')
  }
  const existing = new Map(listDocs().map((doc) => [doc.id, doc]))
  let imported = 0
  for (const entry of backup.docs) {
    const { content, ...record } = entry
    const current = existing.get(record.id)
    if (current && current.updatedAt >= record.updatedAt) continue
    existing.set(record.id, record)
    if (content !== null && content !== undefined) {
      saveContent(record.id, content)
    }
    imported++
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify([...existing.values()]))
  return imported
}
