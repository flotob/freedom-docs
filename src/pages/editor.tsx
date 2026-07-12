import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DdocEditor } from '@fileverse-dev/ddoc'
import type { JSONContent } from '@tiptap/core'
import {
  DOC_SCHEMA,
  DocSnapshot,
  getDoc,
  loadContent,
  saveContent,
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

type PublishState = 'idle' | 'publishing' | 'published' | 'error'

export const EditorPage = () => {
  const { docId } = useParams()
  const navigate = useNavigate()
  const doc = useMemo(() => (docId ? getDoc(docId) : undefined), [docId])

  const [docName, setDocName] = useState(doc?.name || 'Untitled')
  const [zoomLevel, setZoomLevel] = useState('1')
  const [isNavbarVisible, setIsNavbarVisible] = useState(true)
  const [publishState, setPublishState] = useState<PublishState>('idle')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [shareRef, setShareRef] = useState<string | null>(
    doc?.manifestRef || doc?.lastPublishedRef || null
  )
  const [copied, setCopied] = useState(false)
  const [versions, setVersions] = useState(doc?.versions || [])
  const [showHistory, setShowHistory] = useState(false)

  // Latest editor content, tracked via onChange and flushed to localStorage.
  const contentRef = useRef<JSONContent | string | null>(
    docId ? loadContent(docId) : null
  )
  const initialContent = useRef(contentRef.current)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const onChange = useCallback(
    (updatedDocContent: string | JSONContent) => {
      contentRef.current = updatedDocContent
      if (!docId) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveContent(docId, updatedDocContent)
        updateDoc(docId, {})
      }, 800)
    },
    [docId]
  )

  const onRename = (name: string) => {
    setDocName(name)
    if (docId) updateDoc(docId, { name })
  }

  const onPublish = async () => {
    if (!docId || !doc) return
    try {
      setPublishState('publishing')
      setPublishError(null)

      const connected = await connectSwarm()
      if (!connected && !hasWritableStorage()) {
        throw new Error(
          'No Swarm provider available. Open Freedom Docs in Freedom Browser to publish.'
        )
      }

      if (contentRef.current) saveContent(docId, contentRef.current)

      const snapshot: DocSnapshot = {
        schema: DOC_SCHEMA,
        name: docName,
        content: contentRef.current ?? '',
        publishedAt: Date.now(),
      }
      const snapshotRef = await publishJson(snapshot, `${docName}.json`)

      let manifestRef = doc.manifestRef
      let feedId = doc.feedId

      if (supportsFeeds()) {
        if (!feedId) {
          const feed = await createDocFeed(`freedom-docs:${docId}`)
          feedId = feed.feedId
          manifestRef = feed.manifestReference
        }
        await updateDocFeed(feedId!, snapshotRef)
      } else {
        // Dev fallback without feeds: the share ref changes on each publish.
        manifestRef = snapshotRef
      }

      const updated = updateDoc(docId, {
        feedId,
        manifestRef,
        lastPublishedRef: snapshotRef,
        publishedAt: Date.now(),
        name: docName,
        versions: [
          ...(getDoc(docId)?.versions || []),
          { ref: snapshotRef, publishedAt: Date.now() },
        ],
      })
      setVersions(updated?.versions || [])
      setShareRef(manifestRef || snapshotRef)
      setPublishState('published')
      setTimeout(() => setPublishState('idle'), 2500)
    } catch (err: any) {
      console.error(err)
      setPublishError(err?.message || 'Publish failed')
      setPublishState('error')
    }
  }

  // Share link points at this app's viewer route, so it works from any
  // origin the app is served from (bzz://, gateway, dev server).
  const shareUrl = shareRef
    ? `${window.location.href.split('#')[0]}#/d/${shareRef}`
    : null

  const onCopyShare = async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!doc) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Document not found on this device.</p>
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:underline"
          >
            Back to documents
          </button>
        </div>
      </main>
    )
  }

  const renderNavbar = () => (
    <div className="w-full flex items-center justify-between gap-4 px-3 py-1.5">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 hover:text-gray-800 text-[14px] shrink-0"
        >
          ← Docs
        </button>
        <input
          value={docName}
          onChange={(e) => onRename(e.target.value)}
          className="font-medium text-[15px] bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-300 rounded px-2 py-1 min-w-0"
        />
        {publishError && (
          <span
            className="text-[12px] text-red-600 truncate max-w-[280px]"
            title={publishError}
          >
            {publishError}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {versions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"
            >
              History ({versions.length})
            </button>
            {showHistory && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[240px] max-h-[300px] overflow-auto z-50">
                {[...versions].reverse().map((version, i) => (
                  <button
                    key={version.ref}
                    onClick={() => {
                      setShowHistory(false)
                      navigate(`/d/${version.ref}`)
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 flex justify-between gap-3"
                  >
                    <span>
                      v{versions.length - i}
                      {i === 0 && (
                        <span className="text-gray-400"> (latest)</span>
                      )}
                    </span>
                    <span className="text-gray-500">
                      {new Date(version.publishedAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {shareUrl && (
          <button
            onClick={onCopyShare}
            className="text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"
            title={shareUrl}
          >
            {copied ? 'Copied!' : 'Copy share link'}
          </button>
        )}
        <button
          onClick={onPublish}
          disabled={publishState === 'publishing'}
          className="bg-black text-white rounded-lg px-4 py-1.5 text-[14px] font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {publishState === 'publishing'
            ? 'Publishing…'
            : publishState === 'published'
              ? 'Published ✓'
              : 'Publish to Swarm'}
        </button>
      </div>
    </div>
  )

  return (
    <main className="min-h-full">
      <DdocEditor
        isPreviewMode={false}
        initialContent={initialContent.current ?? ''}
        onChange={onChange}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        isNavbarVisible={isNavbarVisible}
        setIsNavbarVisible={setIsNavbarVisible}
        documentName={docName}
        renderNavbar={renderNavbar}
      />
    </main>
  )
}
