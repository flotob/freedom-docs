import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeadlessEditor } from '@fileverse-dev/ddoc'
import {
  DOC_SCHEMA,
  DocSnapshot,
  createDoc,
  saveContent,
  updateDoc,
} from '../lib/docs-store'
import {
  connectSwarm,
  createDocFeed,
  getSwarmBytes,
  hasWritableStorage,
  publishJson,
  supportsFeeds,
  updateDocFeed,
} from '../lib/swarm'
import { decryptBytesWithRawKey, encryptJson } from '../lib/crypto'

/**
 * Machine route: import an office/markdown file from the drive as a native
 * Freedom Doc ("Open as Google Docs" equivalent).
 *
 * Query params (all inside the URL fragment — HashRouter — so nothing here
 * ever reaches a gateway):
 *   src=<swarm ref>       the file's content reference (ciphertext if private)
 *   name=<file name>      original file name (decides docx vs markdown)
 *   key=<b64url>&iv=<b64url>   raw AES-GCM key + IV for private files
 *   returnTo=<url>        where to hand the new doc's identity (drive /import)
 *
 * Conversion runs entirely in-browser via ddoc's headless editor
 * (getYjsContentFromDocx / getYjsContentFromMarkdown — mammoth inside ddoc).
 * The original file in the drive is untouched; this creates a new native doc.
 */
export const ImportFilePage = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { getYjsContentFromDocx, getYjsContentFromMarkdown } =
    useHeadlessEditor()
  const [status, setStatus] = useState('Preparing import…')
  const [error, setError] = useState<string | null>(null)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const src = params.get('src')
      const fileName = params.get('name') || 'Imported document'
      const key = params.get('key')
      const iv = params.get('iv')
      const returnTo = params.get('returnTo')
      if (!src) throw new Error('Missing file reference')

      setStatus('Connecting to Swarm…')
      const connected = await connectSwarm()
      if (!connected && !hasWritableStorage()) {
        throw new Error('Open Freedom Browser to import documents.')
      }

      setStatus('Fetching file…')
      let bytes = await getSwarmBytes(src)
      if (key && iv) {
        setStatus('Decrypting…')
        bytes = await decryptBytesWithRawKey(bytes, iv, key)
      }

      setStatus('Converting…')
      const lower = fileName.toLowerCase()
      const isMarkdown =
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.txt')
      const file = new File([bytes as BlobPart], fileName)
      // Embedded images would need an upload backend inside the converter;
      // not wired yet — fail with a clear message instead of silently.
      const noImageUpload = async (): Promise<never> => {
        throw new Error(
          'This file contains embedded images, which imports don’t support yet.'
        )
      }
      const yjsState = isMarkdown
        ? await getYjsContentFromMarkdown(file, noImageUpload)
        : await getYjsContentFromDocx(file, noImageUpload)
      if (!yjsState) throw new Error('Could not convert this file')

      // Create the native doc with the converted content.
      const baseName = fileName.replace(/\.(docx?|md|markdown|txt)$/i, '')
      const doc = createDoc(baseName || 'Imported document', 'doc')
      saveContent(doc.id, yjsState)
      const docKey = doc.keyB64!

      setStatus('Publishing…')
      const snapshot: DocSnapshot = {
        schema: DOC_SCHEMA,
        name: doc.name,
        kind: 'doc',
        content: yjsState,
        publishedAt: Date.now(),
        writers: [],
      }
      const envelope = await encryptJson(docKey, snapshot)
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
        keyB64: docKey,
        lastPublishedRef: snapshotRef,
        publishedAt: Date.now(),
        versions: [{ ref: snapshotRef, publishedAt: Date.now() }],
      })

      if (returnTo) {
        const query = new URLSearchParams({
          docId: doc.id,
          kind: 'doc',
          name: doc.name,
          key: docKey,
          feedRef: manifestRef,
        })
        const separator = returnTo.includes('?') ? '&' : '?'
        window.location.href = `${returnTo}${separator}${query.toString()}`
      } else {
        navigate(`/edit/${doc.id}`, { replace: true })
      }
    }

    run().catch((err) => {
      console.error('Import failed:', err)
      setError(err instanceof Error ? err.message : 'Import failed')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        {error ? (
          <>
            <div className="text-3xl">⚠️</div>
            <div className="text-sm text-red-600 max-w-md">{error}</div>
            <button
              onClick={() => navigate('/')}
              className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm"
            >
              Back to documents
            </button>
          </>
        ) : (
          <>
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-b-gray-800" />
            <div className="text-sm text-gray-600">{status}</div>
          </>
        )}
      </div>
    </main>
  )
}
