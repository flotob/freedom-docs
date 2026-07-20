import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DocRecord, adoptDoc, getDoc, saveContent } from '../lib/docs-store'
import { fetchRemoteDocState } from '../lib/shared-doc'
import { mergeYjsStates } from '../lib/yjs-merge'

/**
 * Owner recovery: rebuild a doc's local record from its Swarm feed.
 *
 * The drive routes here when a doc entry's pointer resolves but this
 * device has no local record (localStorage wiped, fresh device) while the
 * CURRENT origin identity still owns the doc's feed — verified drive-side
 * via swarm_listFeeds before choosing this route. Also the landing leg of
 * the drive's "repair" action, which re-homes a foreign doc onto a fresh
 * feed owned by this origin first.
 *
 * Params (all in the hash-route query): docId, key (b64url), feedRef
 * (manifest ref, the content source + share identity), feedId (the feed
 * registry name updateFeed accepts — freedom-docs:<docId>), kind, name,
 * return.
 */
export const RecoverDocPage = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Recovering document…')
  const [error, setError] = useState<string | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const docId = params.get('docId')
      const key = params.get('key')
      const feedRef = params.get('feedRef')
      const feedId = params.get('feedId') || undefined
      const returnParam = params.get('return')
      const ret = returnParam ? `?return=${encodeURIComponent(returnParam)}` : ''

      if (!docId || !key || !feedRef) {
        setError('This recovery link is incomplete.')
        return
      }

      // Already present (e.g. recovered in another tab meanwhile) — open it.
      if (getDoc(docId)) {
        navigate(`/edit/${docId}${ret}`, { replace: true })
        return
      }

      setStatus('Fetching the latest version from Swarm…')
      const remote = await fetchRemoteDocState(feedRef, key)

      const record: DocRecord = {
        id: docId,
        name: remote.name || params.get('name') || 'Untitled',
        kind: remote.kind || (params.get('kind') === 'sheet' ? 'sheet' : 'doc'),
        ...(remote.sheetId ? { sheetId: remote.sheetId } : {}),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        keyB64: key,
        // feedId lets publish() keep updating the SAME feed — the doc's
        // share identity survives the recovery.
        ...(feedId ? { feedId } : {}),
        manifestRef: feedRef,
        writers: remote.writers || [],
      }

      setStatus('Rebuilding your local copy…')
      if (remote.states.length > 0) {
        // CRDT-merge every stream into one state — identical to what the
        // editor would compute, but persisted so it opens instantly.
        saveContent(docId, mergeYjsStates(remote.states))
      }
      adoptDoc(record)

      navigate(`/edit/${docId}${ret}`, { replace: true })
    }

    run().catch((err) => {
      console.error(err)
      setError(err?.message || 'Could not recover the document from Swarm.')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="text-center max-w-[420px] px-6">
          <p className="text-red-600 text-[14px] mb-4">{error}</p>
          <button
            onClick={() => history.back()}
            className="text-blue-600 hover:underline text-[14px]"
          >
            Go back
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
        <div className="text-sm text-[var(--text-muted)]">{status}</div>
      </div>
    </main>
  )
}
