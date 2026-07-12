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

export const DOC_SCHEMA = 'freedom-docs/doc/1'

export type DocRecord = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  // Set once the doc has a Swarm feed (Freedom Browser)
  feedId?: string
  manifestRef?: string
  // Last published immutable snapshot
  lastPublishedRef?: string
  publishedAt?: number
}

export type DocSnapshot = {
  schema: typeof DOC_SCHEMA
  name: string
  content: JSONContent | string
  publishedAt: number
}

const INDEX_KEY = 'freedom-docs:index'
const contentKey = (id: string) => `freedom-docs:content:${id}`

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

export const createDoc = (name = 'Untitled'): DocRecord => {
  const doc: DocRecord = {
    id: nanoid(12),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
