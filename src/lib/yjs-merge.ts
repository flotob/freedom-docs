/**
 * Merge several base64-encoded Yjs full states into one.
 *
 * The ddoc editor accepts an array of states and merges internally; the
 * dsheet editor's portalContent takes a single state string, so for sheets
 * we CRDT-merge the writer streams ourselves before handing over.
 */

import * as Y from 'yjs'
import { fromUint8Array, toUint8Array } from 'js-base64'

export const mergeYjsStates = (states: string[]): string => {
  if (states.length === 1) return states[0]
  const doc = new Y.Doc()
  for (const state of states) {
    try {
      Y.applyUpdate(doc, toUint8Array(state))
    } catch (err) {
      console.warn('Skipping unmergeable Yjs state:', err)
    }
  }
  const merged = fromUint8Array(Y.encodeStateAsUpdate(doc))
  doc.destroy()
  return merged
}
