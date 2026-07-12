/**
 * Shared-document plumbing for async multi-writer collaboration.
 *
 * Model: the owner's feed is the doc's identity and carries the descriptor
 * (an owner snapshot that lists collaborator writer streams). Every writer —
 * owner included — publishes their own encrypted full Yjs state to their own
 * feed. Any client merges by fetching all writer states and letting Yjs
 * CRDT-merge them (the editor accepts an array of base64 states natively).
 *
 * Collaborators are added via a two-step handshake with no extra infra:
 * the collaborator opens the edit link, publishes once (creating their
 * writer feed), and sends the resulting "collaborator card" (their feed
 * manifest ref) back to the owner over any channel. The owner pastes it
 * into the Share dialog, which republishes the descriptor.
 */

import type { JSONContent } from '@tiptap/core'
import { getSwarmJson } from './swarm'
import { decryptJson, isEncryptedEnvelope } from './crypto'
import {
  DOC_SCHEMA,
  DocRecord,
  DocSnapshot,
  DocWriter,
  createDoc,
  listDocs,
  updateDoc,
} from './docs-store'

export type RemoteDocState = {
  name: string
  kind: 'doc' | 'sheet'
  writers: DocWriter[]
  /** Base64 Yjs states from every available writer stream, owner first. */
  states: string[]
  ownerPublishedAt: number
}

const fetchSnapshot = async (
  feedRef: string,
  keyB64: string
): Promise<DocSnapshot | null> => {
  try {
    const data = await getSwarmJson(feedRef)
    const payload = isEncryptedEnvelope(data)
      ? await decryptJson(keyB64, data)
      : data
    if ((payload as any)?.schema !== DOC_SCHEMA) return null
    return payload as DocSnapshot
  } catch (err) {
    console.warn(`Failed to fetch writer stream ${feedRef.slice(0, 8)}…`, err)
    return null
  }
}

const isYjsState = (content: DocSnapshot['content']): content is string =>
  typeof content === 'string' && content.length > 0

/**
 * Fetch the owner descriptor plus every writer stream and collect all
 * mergeable Yjs states. Streams that fail to load are skipped — CRDT merge
 * makes partial reads safe (missing edits appear on the next sync).
 */
export const fetchRemoteDocState = async (
  ownerFeedRef: string,
  keyB64: string
): Promise<RemoteDocState> => {
  const ownerSnapshot = await fetchSnapshot(ownerFeedRef, keyB64)
  if (!ownerSnapshot) {
    throw new Error('Could not load the shared document from Swarm.')
  }

  const writers = ownerSnapshot.writers || []
  const writerSnapshots = await Promise.all(
    writers.map((writer) => fetchSnapshot(writer.feedRef, keyB64))
  )

  const states: string[] = []
  if (isYjsState(ownerSnapshot.content)) states.push(ownerSnapshot.content)
  for (const snapshot of writerSnapshots) {
    if (snapshot && isYjsState(snapshot.content)) states.push(snapshot.content)
  }

  return {
    name: ownerSnapshot.name,
    kind: ownerSnapshot.kind === 'sheet' ? 'sheet' : 'doc',
    writers,
    states,
    ownerPublishedAt: ownerSnapshot.publishedAt,
  }
}

/**
 * Open an edit link: reuse the existing local record for this shared doc,
 * or create a collaborator record bound to the owner's feed.
 */
export const joinSharedDoc = (
  ownerFeedRef: string,
  keyB64: string,
  name = 'Shared document'
): DocRecord => {
  const existing = listDocs().find(
    (doc) =>
      doc.sharedFrom === ownerFeedRef ||
      // The owner opening their own edit link lands on their own doc
      doc.manifestRef === ownerFeedRef
  )
  if (existing) return existing

  const doc = createDoc(name)
  return (
    updateDoc(doc.id, {
      role: 'collaborator',
      sharedFrom: ownerFeedRef,
      keyB64,
    }) || doc
  )
}

/** Merge helper: build the editor's initialContent from remote + local. */
export const mergeInitialContent = (
  remoteStates: string[],
  localContent: JSONContent | string | null
): string | string[] | JSONContent => {
  const states = [...remoteStates]
  if (typeof localContent === 'string' && localContent.length > 0) {
    states.push(localContent)
  }
  if (states.length > 0) return states
  // No Yjs states anywhere — fall back to legacy JSON content or empty
  return localContent ?? ''
}
