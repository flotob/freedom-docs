import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DdocEditor } from '@fileverse-dev/ddoc'
import type { JSONContent } from '@tiptap/core'
import {
  DOC_SCHEMA,
  DocRecord,
  DocSnapshot,
  DocWriter,
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
import { encryptJson, generateDocKey } from '../lib/crypto'
import { fetchRemoteDocState, mergeInitialContent } from '../lib/shared-doc'

type PublishState = 'idle' | 'publishing' | 'published' | 'error'

const SWARM_REF_REGEX = /^[0-9a-fA-F]{64}$/

export const EditorPage = () => {
  const { docId } = useParams()
  const navigate = useNavigate()
  // Live copy of the doc record: refreshed after every mutation so share
  // links, the collaborator card, and sync targets appear without a reload.
  const [doc, setDoc] = useState<DocRecord | undefined>(() =>
    docId ? getDoc(docId) : undefined
  )
  const refreshDoc = useCallback(() => {
    if (docId) setDoc(getDoc(docId))
  }, [docId])

  const isCollaborator = doc?.role === 'collaborator'
  // The doc's public identity: the owner's feed (own feed for owners)
  const docIdentityRef = isCollaborator ? doc?.sharedFrom : doc?.manifestRef
  const isShared = Boolean(isCollaborator || doc?.writers?.length)

  const [docName, setDocName] = useState(doc?.name || 'Untitled')
  const [zoomLevel, setZoomLevel] = useState('1')
  const [isNavbarVisible, setIsNavbarVisible] = useState(true)
  const [publishState, setPublishState] = useState<PublishState>('idle')
  const [publishError, setPublishError] = useState<string | null>(null)
  const [docKey, setDocKey] = useState<string | null>(doc?.keyB64 || null)
  const [versions, setVersions] = useState(doc?.versions || [])
  const [writers, setWriters] = useState<DocWriter[]>(doc?.writers || [])
  const [showHistory, setShowHistory] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [newWriterRef, setNewWriterRef] = useState('')
  const [newWriterLabel, setNewWriterLabel] = useState('')
  const [syncing, setSyncing] = useState(isShared)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)

  // Latest editor content (base64 Yjs state), tracked via onChange.
  const contentRef = useRef<JSONContent | string | null>(
    docId ? loadContent(docId) : null
  )
  const [editorInput, setEditorInput] = useState<{
    key: number
    content: string | string[] | JSONContent
  } | null>(isShared ? null : { key: 0, content: contentRef.current ?? '' })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Fetch all writer states and (re)mount the editor with merged content.
   * Reads the doc record fresh from the store so it never acts on stale
   * refs/keys captured before a publish.
   */
  const syncFromSwarm = useCallback(async () => {
    const current = docId ? getDoc(docId) : undefined
    const collaborator = current?.role === 'collaborator'
    const identityRef = collaborator
      ? current?.sharedFrom
      : current?.manifestRef
    const key = current?.keyB64
    if (!docId || !identityRef || !key) {
      setEditorInput((prev) => prev ?? { key: 0, content: contentRef.current ?? '' })
      setSyncing(false)
      return
    }
    try {
      setSyncing(true)
      setSyncError(null)
      const remote = await fetchRemoteDocState(identityRef, key)
      if (collaborator && remote.name) {
        setDocName(remote.name)
        updateDoc(docId, { name: remote.name })
      }
      // Owner: the local writers list is authoritative (the descriptor is
      // published from it) — never overwrite it from a feed read, which may
      // lag right after a republish.
      setEditorInput((prev) => ({
        key: (prev?.key ?? 0) + 1,
        content: mergeInitialContent(remote.states, contentRef.current),
      }))
      setSyncedAt(Date.now())
      refreshDoc()
    } catch (err: any) {
      console.error(err)
      setSyncError(err?.message || 'Sync failed')
      // Still let the user edit locally
      setEditorInput((prev) => prev ?? { key: 0, content: contentRef.current ?? '' })
    } finally {
      setSyncing(false)
    }
  }, [docId, refreshDoc])

  // Shared docs sync on open
  useEffect(() => {
    if (isShared) syncFromSwarm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const publish = async (writerList: DocWriter[]) => {
    if (!docId || !doc) return
    const connected = await connectSwarm()
    if (!connected && !hasWritableStorage()) {
      throw new Error(
        'No Swarm provider available. Open Freedom Docs in Freedom Browser to publish.'
      )
    }

    let key = docKey
    if (!key) {
      key = generateDocKey()
      setDocKey(key)
    }

    if (contentRef.current) saveContent(docId, contentRef.current)

    const snapshot: DocSnapshot = {
      schema: DOC_SCHEMA,
      name: docName,
      content: contentRef.current ?? '',
      publishedAt: Date.now(),
      // Only the owner's descriptor lists writers
      ...(isCollaborator ? {} : { writers: writerList }),
    }
    const envelope = await encryptJson(key, snapshot)
    const snapshotRef = await publishJson(envelope, 'freedom-docs.json')

    const current = getDoc(docId)
    let manifestRef = current?.manifestRef
    let feedId = current?.feedId

    if (supportsFeeds()) {
      if (!feedId) {
        const feed = await createDocFeed(`freedom-docs:${docId}`)
        feedId = feed.feedId
        manifestRef = feed.manifestReference
      }
      await updateDocFeed(feedId!, snapshotRef)
    } else {
      manifestRef = snapshotRef
    }

    const updated = updateDoc(docId, {
      feedId,
      manifestRef,
      lastPublishedRef: snapshotRef,
      publishedAt: Date.now(),
      name: docName,
      keyB64: key,
      writers: isCollaborator ? undefined : writerList,
      versions: [
        ...(current?.versions || []),
        { ref: snapshotRef, publishedAt: Date.now() },
      ],
    })
    setVersions(updated?.versions || [])
    refreshDoc()
  }

  const onPublish = async () => {
    try {
      setPublishState('publishing')
      setPublishError(null)
      await publish(writers)
      setPublishState('published')
      setTimeout(() => setPublishState('idle'), 2500)
    } catch (err: any) {
      console.error(err)
      setPublishError(err?.message || 'Publish failed')
      setPublishState('error')
    }
  }

  const onAddWriter = async () => {
    const ref = newWriterRef.trim().toLowerCase()
    if (!SWARM_REF_REGEX.test(ref)) return
    if (writers.some((writer) => writer.feedRef === ref)) return
    const next = [
      ...writers,
      { feedRef: ref, label: newWriterLabel.trim() || `Collaborator ${writers.length + 1}` },
    ]
    setWriters(next)
    setNewWriterRef('')
    setNewWriterLabel('')
    // Republish immediately so the descriptor lists the new writer,
    // then pull their stream right away.
    try {
      setPublishState('publishing')
      await publish(next)
      setPublishState('published')
      setTimeout(() => setPublishState('idle'), 2500)
      await syncFromSwarm()
    } catch (err: any) {
      setPublishError(err?.message || 'Failed to publish collaborator list')
      setPublishState('error')
    }
  }

  const onRemoveWriter = async (feedRef: string) => {
    const next = writers.filter((writer) => writer.feedRef !== feedRef)
    setWriters(next)
    try {
      await publish(next)
    } catch (err: any) {
      setPublishError(err?.message || 'Failed to publish collaborator list')
    }
  }

  const base = window.location.href.split('#')[0]
  const viewLink =
    docIdentityRef && docKey ? `${base}#/d/${docIdentityRef}/${docKey}` : null
  const editLink =
    !isCollaborator && docIdentityRef && docKey
      ? `${base}#/e/${docIdentityRef}/${docKey}`
      : null
  // The collaborator's card is their own feed ref — created on first publish
  const myCard = isCollaborator ? doc?.manifestRef || null : null

  const copyToClipboard = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
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
    <div
      // The editor renders its navbar and toolbar as sibling fixed bars, both
      // z-45 with the toolbar painted later — dropdowns inside the navbar
      // would be covered. Lift the host <nav> one level so they layer above.
      ref={(el) => {
        const nav = el?.closest('nav') as HTMLElement | null
        if (nav) nav.style.zIndex = '46'
      }}
      className="w-full flex items-center justify-between gap-4 px-3 py-1.5">
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
          disabled={isCollaborator}
          className="font-medium text-[15px] bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-300 rounded px-2 py-1 min-w-0 disabled:text-gray-500"
          title={isCollaborator ? 'Only the owner can rename a shared doc' : undefined}
        />
        {isShared && (
          <button
            onClick={syncFromSwarm}
            disabled={syncing}
            className="text-[12px] text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-2 py-1 shrink-0"
            title={
              syncedAt
                ? `Last synced ${new Date(syncedAt).toLocaleTimeString()}`
                : 'Fetch collaborators’ latest changes'
            }
          >
            {syncing ? 'Syncing…' : '⟳ Sync'}
          </button>
        )}
        {(publishError || syncError) && (
          <span
            className="text-[12px] text-red-600 truncate max-w-[240px]"
            title={publishError || syncError || ''}
          >
            {publishError || syncError}
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
                      navigate(
                        docKey
                          ? `/d/${version.ref}/${docKey}`
                          : `/d/${version.ref}`
                      )
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 flex justify-between gap-3"
                  >
                    <span>
                      v{versions.length - i}
                      {i === 0 && <span className="text-gray-400"> (latest)</span>}
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
        {(viewLink || myCard || !isCollaborator) && (
          <div className="relative">
            <button
              onClick={() => setShowShare((v) => !v)}
              className="text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"
            >
              Share
            </button>
            {showShare && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-[380px] z-50 flex flex-col gap-3 text-[13px]">
                {!viewLink && (
                  <p className="text-gray-500">
                    Publish once to get shareable links.
                  </p>
                )}
                {viewLink && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Read-only link</span>
                    <button
                      onClick={() => copyToClipboard('view', viewLink)}
                      className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                    >
                      {copied === 'view' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
                {editLink && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Edit link</span>
                    <button
                      onClick={() => copyToClipboard('edit', editLink)}
                      className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
                    >
                      {copied === 'edit' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}

                {isCollaborator && (
                  <div className="border-t pt-3">
                    <div className="font-medium mb-1">Your collaborator card</div>
                    {myCard ? (
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] break-all flex-1 bg-gray-50 rounded p-2">
                          {myCard}
                        </code>
                        <button
                          onClick={() => copyToClipboard('card', myCard)}
                          className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 shrink-0"
                        >
                          {copied === 'card' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    ) : (
                      <p className="text-gray-500">
                        Publish once to create your writer stream, then send
                        this card to the owner so they can add you.
                      </p>
                    )}
                  </div>
                )}

                {!isCollaborator && (
                  <div className="border-t pt-3 flex flex-col gap-2">
                    <div className="font-medium">
                      Collaborators ({writers.length})
                    </div>
                    {writers.map((writer) => (
                      <div
                        key={writer.feedRef}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate" title={writer.feedRef}>
                          {writer.label}{' '}
                          <span className="text-gray-400">
                            {writer.feedRef.slice(0, 8)}…
                          </span>
                        </span>
                        <button
                          onClick={() => onRemoveWriter(writer.feedRef)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={newWriterLabel}
                        onChange={(e) => setNewWriterLabel(e.target.value)}
                        placeholder="Name"
                        className="w-[100px] border border-gray-200 rounded px-2 py-1"
                      />
                      <input
                        value={newWriterRef}
                        onChange={(e) => setNewWriterRef(e.target.value)}
                        placeholder="Paste collaborator card (64-hex)"
                        className="flex-1 border border-gray-200 rounded px-2 py-1"
                      />
                      <button
                        onClick={onAddWriter}
                        disabled={!SWARM_REF_REGEX.test(newWriterRef.trim())}
                        className="border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    <p className="text-gray-400 text-[12px]">
                      Send the edit link to a collaborator; they publish once
                      and send you back their collaborator card.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
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

  if (!editorInput) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-200 border-b-gray-800" />
          <div className="text-sm text-gray-600">
            Syncing shared document from Swarm…
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-full">
      <DdocEditor
        key={editorInput.key}
        isPreviewMode={false}
        initialContent={editorInput.content}
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
