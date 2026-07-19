import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  DOC_SCHEMA,
  DocSnapshot,
  createDoc,
  updateDoc,
} from '../lib/docs-store'
import {
  connectSwarm,
  createDocFeed,
  hasWritableStorage,
  publishJson,
  supportsFeeds,
  updateDocFeed,
} from '../lib/swarm'
import { encryptJson } from '../lib/crypto'

/**
 * Machine route: create a fresh document/spreadsheet and hand its durable
 * reference back to whoever asked (the drive's "New Document" action).
 *
 * `?kind=doc|sheet` picks the kind; `?returnTo=<url>` is where to redirect
 * with the new doc's { docId, feedRef, key, kind, name }. With no returnTo it
 * just opens the editor. The doc is published once so it has a durable Swarm
 * feed the drive can store and reopen from any device.
 */
export const CreatePage = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const kind = params.get('kind') === 'sheet' ? 'sheet' : 'doc'
  const returnTo = params.get('returnTo')
  const [status, setStatus] = useState('Creating…')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const name =
        kind === 'sheet' ? 'Untitled spreadsheet' : 'Untitled document'
      const doc = createDoc(name, kind)
      const key = doc.keyB64!

      try {
        setStatus('Connecting to Swarm…')
        const connected = await connectSwarm()
        if (!connected && !hasWritableStorage()) {
          throw new Error('Open Freedom Browser to create documents.')
        }

        setStatus('Publishing…')
        const snapshot: DocSnapshot = {
          schema: DOC_SCHEMA,
          name,
          kind,
          ...(doc.sheetId ? { sheetId: doc.sheetId } : {}),
          content: '',
          publishedAt: Date.now(),
          writers: [],
        }
        const envelope = await encryptJson(key, snapshot)
        const snapshotRef = await publishJson(envelope, 'freedom-docs.json')

        let feedId: string | undefined
        let manifestRef = snapshotRef
        if (supportsFeeds()) {
          const feed = await createDocFeed(`freedom-docs:${doc.id}`)
          feedId = feed.feedId
          manifestRef = feed.manifestReference
          await updateDocFeed(feedId, snapshotRef)
        }

        updateDoc(doc.id, {
          feedId,
          manifestRef,
          keyB64: key,
          lastPublishedRef: snapshotRef,
          publishedAt: Date.now(),
          versions: [{ ref: snapshotRef, publishedAt: Date.now() }],
        })

        if (returnTo) {
          const query = new URLSearchParams({
            docId: doc.id,
            kind,
            name,
            key,
            feedRef: manifestRef,
          })
          const separator = returnTo.includes('?') ? '&' : '?'
          window.location.href = `${returnTo}${separator}${query.toString()}`
        } else {
          navigate(`/edit/${doc.id}`, { replace: true })
        }
      } catch (err: any) {
        console.error(err)
        // The local record exists — fall back to the editor so work isn't lost.
        setStatus(
          `${err?.message || 'Could not publish'} — opening editor…`
        )
        setTimeout(() => navigate(`/edit/${doc.id}`, { replace: true }), 1500)
      }
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
        <div className="text-sm text-[var(--text-muted)]">{status}</div>
      </div>
    </main>
  )
}
