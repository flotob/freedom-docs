import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { toUint8Array } from 'js-base64'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useHeadlessEditor } from '@fileverse-dev/ddoc'
import {
  DOC_SCHEMA,
  DocRecord,
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

// Headless sheet conversion pulls in the whole dsheet stack — lazy chunk.
const SheetImporter = lazy(() => import('../lib/sheet-importer'))

/**
 * Machine route: import an office/markdown file from the drive as a native
 * Freedom Doc or Freedom Sheet ("Open as Google Docs/Sheets" equivalent).
 *
 * Query params (all inside the URL fragment — HashRouter — so nothing here
 * ever reaches a gateway):
 *   kind=doc|sheet        target kind (docx/md → doc, xlsx/csv → sheet)
 *   src=<swarm ref>       the file's content reference (ciphertext if private)
 *   name=<file name>      original file name
 *   key=<b64url>&iv=<b64url>   raw AES-GCM key + IV for private files
 *   returnTo=<url>        where to hand the new doc's identity (drive /import)
 *
 * Conversion runs entirely in-browser: docs via ddoc's headless editor
 * (mammoth inside ddoc), sheets via dsheet's import machinery driven headless
 * against our own Y.Doc (see lib/sheet-importer). The original drive file is
 * untouched; this creates a new native document next to it.
 */
export const ImportFilePage = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { getYjsContentFromDocx, getYjsContentFromMarkdown } =
    useHeadlessEditor()
  const [status, setStatus] = useState('Preparing import…')
  const [error, setError] = useState<string | null>(null)
  // Sheet conversion happens in a rendered (lazy) component; this holds its job.
  const [sheetJob, setSheetJob] = useState<{ file: File; doc: DocRecord } | null>(
    null
  )
  const ranRef = useRef(false)

  const returnTo = params.get('returnTo')

  /** Publish the converted content as the new doc's first snapshot, then hand
   *  the identity back to the drive (or open the editor). */
  const publishAndReturn = async (doc: DocRecord, contentState: string) => {
    setStatus('Publishing…')
    saveContent(doc.id, contentState)
    const docKey = doc.keyB64!
    const snapshot: DocSnapshot = {
      schema: DOC_SCHEMA,
      name: doc.name,
      kind: doc.kind || 'doc',
      ...(doc.sheetId ? { sheetId: doc.sheetId } : {}),
      content: contentState,
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
        kind: doc.kind || 'doc',
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

  const fail = (err: unknown) => {
    console.error('Import failed:', err)
    setError(err instanceof Error ? err.message : 'Import failed')
  }

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      const src = params.get('src')
      const fileName = params.get('name') || 'Imported document'
      const key = params.get('key')
      const iv = params.get('iv')
      const kind = params.get('kind') === 'sheet' ? 'sheet' : 'doc'
      if (!src) throw new Error('Missing file reference')

      // Dev affordance: a path/URL src (never a valid 64-hex swarm ref) is
      // fetched directly so conversion can be tested without a Swarm node;
      // the Swarm-connect gate then only applies at publish time.
      const isDevSrc = src.startsWith('/') || src.startsWith('http')
      if (!isDevSrc) {
        setStatus('Connecting to Swarm…')
        const connected = await connectSwarm()
        if (!connected && !hasWritableStorage()) {
          throw new Error('Open Freedom Browser to import documents.')
        }
      }

      setStatus('Fetching file…')
      let bytes = isDevSrc
        ? new Uint8Array(await (await fetch(src)).arrayBuffer())
        : await getSwarmBytes(src)
      if (key && iv) {
        setStatus('Decrypting…')
        // enc=b64: the drive stores ciphertext as base64 text (mobile-safe
        // string payloads) — decode before decrypting.
        if (params.get('enc') === 'b64') {
          bytes = toUint8Array(new TextDecoder().decode(bytes))
        }
        bytes = await decryptBytesWithRawKey(bytes, iv, key)
      }

      setStatus('Converting…')
      const file = new File([bytes as BlobPart], fileName)
      const baseName =
        fileName.replace(/\.(docx?|md|markdown|txt|xlsx?|csv)$/i, '') ||
        'Imported document'

      if (kind === 'sheet') {
        // The record must exist first: dsheet keys workbook content by the
        // record's sheetId, so the importer needs it up front.
        const doc = createDoc(baseName, 'sheet')
        setSheetJob({ file, doc })
        return // continues via <SheetImporter onDone>
      }

      const lower = fileName.toLowerCase()
      const isMarkdown =
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.txt')
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

      const doc = createDoc(baseName, 'doc')
      await publishAndReturn(doc, yjsState)
    }

    run().catch(fail)
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
        {sheetJob && !error && (
          <Suspense fallback={null}>
            <SheetImporter
              file={sheetJob.file}
              dsheetId={sheetJob.doc.sheetId!}
              onDone={(state) => publishAndReturn(sheetJob.doc, state).catch(fail)}
              onError={fail}
            />
          </Suspense>
        )}
      </div>
    </main>
  )
}
