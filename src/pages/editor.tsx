import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DdocEditor } from '@fileverse-dev/ddoc'
import type { JSONContent } from '@tiptap/core'
import { mergeYjsStates } from '../lib/yjs-merge'

// The spreadsheet engine (and its CSS) loads only when a sheet is opened
const DSheetEditor = lazy(() => import('../lib/sheet-editor'))
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
  SwarmNotFoundError,
} from '../lib/swarm'
import { encryptJson, generateDocKey } from '../lib/crypto'
import {
  DRIVE_ENTRY,
  PENDING_DOC_IMPORT_KEY,
  getDriveSession,
} from '../lib/drive-link'
import {
  applyTheme,
  getStoredTheme,
  setTheme,
  systemTheme,
  type Theme,
} from '../lib/theme'
import { fetchRemoteDocState, mergeInitialContent } from '../lib/shared-doc'
import {
  getProfileWriterId,
  startLiveCollab,
  type LiveCollabSession,
  type LivePeer,
} from '../lib/live-collab'

type PublishState = 'idle' | 'publishing' | 'published' | 'error'

const SWARM_REF_REGEX = /^[0-9a-fA-F]{64}$/

/** How long the local user must be idle before a remote update is auto-merged
 * (a merge remounts the editor, so we never do it mid-keystroke). */
const REMOTE_APPLY_IDLE_MS = 2000

/** Cheap fingerprint of writer states to detect unseen remote changes. */
const fingerprintStates = async (states: string[]): Promise<string> => {
  const joined = states.join('|')
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(joined)
  )
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const EditorPage = () => {
  const { docId } = useParams()
  const navigate = useNavigate()
  // When opened from the drive (?return=<url>), the back button returns there.
  const [searchParams] = useSearchParams()
  const returnUrl = searchParams.get('return')
  const goBack = useCallback(() => {
    if (returnUrl) window.location.href = returnUrl
    // The drive is the index — land back there when signed in; the docs
    // home is only a hand-off page.
    else if (getDriveSession()) window.location.href = `${DRIVE_ENTRY}#/`
    else navigate('/')
  }, [returnUrl, navigate])
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
  const isSheet = doc?.kind === 'sheet'

  // Link-joined docs aren't in the user's drive index yet — offer to add
  // them (owner-created docs always arrive via the drive already).
  const inDriveKey = doc ? `freedom-docs:in-drive:${doc.id}` : ''
  const [addedToDrive, setAddedToDrive] = useState(
    () => !!(inDriveKey && localStorage.getItem(inDriveKey))
  )
  const canAddToDrive =
    isCollaborator &&
    !addedToDrive &&
    !!doc?.sharedFrom &&
    !!doc?.keyB64 &&
    !!getDriveSession()
  const addToDrive = () => {
    const session = getDriveSession()
    if (!session || !doc?.sharedFrom || !doc?.keyB64) return
    localStorage.setItem(
      PENDING_DOC_IMPORT_KEY,
      JSON.stringify({ portalAddress: session.portalAddress, folderId: 'root' })
    )
    localStorage.setItem(inDriveKey, '1')
    setAddedToDrive(true)
    const query = new URLSearchParams({
      kind: isSheet ? 'sheet' : 'doc',
      name: docName || doc.name,
      docId: doc.id,
      feedRef: doc.sharedFrom,
      key: doc.keyB64,
    })
    window.location.href = `${DRIVE_ENTRY}#/import?${query.toString()}`
  }

  const [docName, setDocName] = useState(doc?.name || 'Untitled')
  // Shared with ddrive ('drive:theme'): ddoc gets the prop, our chrome the
  // token classes (html.dark toggles the token set).
  const [theme, setThemeState] = useState<Theme>(
    () => getStoredTheme() ?? systemTheme()
  )
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    setTheme(next)
  }
  // dsheet has NO dark theme (its grid can't be restyled), and a dark shell
  // whose text tokens leak into a white canvas is unreadable. Sheets force
  // the light token set while open; the chosen theme returns on unmount.
  useEffect(() => {
    if (!isSheet) return
    applyTheme('light')
    return () => applyTheme(getStoredTheme() ?? systemTheme())
  }, [isSheet])
  const [zoomLevel, setZoomLevel] = useState('1')
  const [isNavbarVisible, setIsNavbarVisible] = useState(true)
  // Slides mode: ddoc converts the doc's markdown into presentable slides
  // (md2slides) — the feature lives inside the editor, we just host the state.
  const [isPresentationMode, setIsPresentationMode] = useState(false)
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
  const [remoteChanged, setRemoteChanged] = useState(false)
  // Fingerprint of the writer states last merged into the editor
  const lastAppliedHashRef = useRef<string>('')

  // --- Live collaboration (swarm-kit live: GSOC presence + state relay) ---
  const writerId = useMemo(() => getProfileWriterId(), [])
  const liveSessionRef = useRef<LiveCollabSession | null>(null)
  // Latest full Yjs state seen from each peer writer (convergent per-writer).
  const remoteByWriterRef = useRef<Map<string, string>>(new Map())
  // Wall-clock of the last local edit — gates cursor-safe remote apply.
  const lastLocalEditRef = useRef<number>(0)
  // Fingerprint of the live states last auto-applied (skip redundant remounts).
  const lastLiveHashRef = useRef<string>('')
  // Feed refs currently being added from discovery — dedupes concurrent hints.
  const discoveringRef = useRef<Set<string>>(new Set())
  // Stable indirections so the live session never restarts on every render.
  const publishRef = useRef<(list: DocWriter[]) => Promise<void>>(
    async () => {}
  )
  const liveHandlersRef = useRef<{
    onPeer: (peer: LivePeer) => void
    onRemote: (state: string, from: string) => void
  }>({ onPeer: () => {}, onRemote: () => {} })

  // Latest editor content (base64 Yjs state), tracked via onChange.
  const contentRef = useRef<JSONContent | string | null>(
    docId ? loadContent(docId) : null
  )
  // Unsaved-changes tracking for the Save button: baseline = content at
  // open (or after the last save/sync); onChange compares against it, so
  // an editor-mount onChange with identical content doesn't flag dirty.
  const [dirty, setDirty] = useState(false)
  const savedBaselineRef = useRef<JSONContent | string | null>(
    contentRef.current
  )
  // After a sync-merge remount the editor re-emits the (merged) state via
  // onChange — adopt that emission as the new baseline instead of flagging
  // it as an unsaved edit the user never made.
  const adoptNextChangeAsBaselineRef = useRef(false)
  // Stable indirection to the change handler (defined below) so the sheet's
  // onChange prop can be identity-stable.
  const onChangeRef = useRef<(c: string | JSONContent) => void>(() => {})
  const [editorInput, setEditorInput] = useState<{
    key: number
    content: string | string[] | JSONContent
  } | null>(isShared ? null : { key: 0, content: contentRef.current ?? '' })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sheetStatus, setSheetStatus] = useState<string>('')

  // Merged Yjs state for the sheet editor, computed once per sync (not every
  // render) so publish-triggered re-renders never churn the prop.
  const sheetPortalContent = useMemo(() => {
    if (!editorInput) return ''
    const states = Array.isArray(editorInput.content)
      ? editorInput.content
      : typeof editorInput.content === 'string' && editorInput.content
        ? [editorInput.content]
        : []
    return states.length > 0 ? mergeYjsStates(states as string[]) : ''
  }, [editorInput])

  // Stable handlers so the sheet editor's props don't change identity on
  // every parent re-render (publish state, doc refresh, etc.).
  const onSheetChange = useCallback(
    (_data: unknown, encodedUpdate?: string) => {
      // Delegates to onChange, which timestamps the edit and live-broadcasts
      // the encoded Yjs state to peers.
      if (encodedUpdate) onChangeRef.current(encodedUpdate)
    },
    []
  )
  const onSheetSyncStatus = useCallback((status: string) => {
    setSheetStatus(status)
  }, [])

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
        // Adopt the owner's shared sheetId so our dsheet keys match theirs.
        updateDoc(docId, {
          name: remote.name,
          kind: remote.kind,
          ...(remote.sheetId ? { sheetId: remote.sheetId } : {}),
        })
      }
      // Owner: the local writers list is authoritative (the descriptor is
      // published from it) — never overwrite it from a feed read, which may
      // lag right after a republish.
      // Fold in any live states we've received over GSOC that may not have
      // landed on the durable feeds yet — all Yjs states, CRDT-convergent.
      const liveStates = [...remoteByWriterRef.current.values()]
      const mergedStates = [...remote.states, ...liveStates]
      setEditorInput((prev) => ({
        key: (prev?.key ?? 0) + 1,
        content: mergeInitialContent(mergedStates, contentRef.current),
      }))
      adoptNextChangeAsBaselineRef.current = true
      lastAppliedHashRef.current = await fingerprintStates(remote.states)
      lastLiveHashRef.current = await fingerprintStates(liveStates)
      setRemoteChanged(false)
      setSyncedAt(Date.now())
      refreshDoc()
    } catch (err: any) {
      console.error(err)
      // An empty owner feed = the doc was shared before its first save —
      // normal for edit links, not a failure worth alarming over.
      setSyncError(
        err instanceof SwarmNotFoundError
          ? "The owner hasn't saved this document yet — it will appear here once they do."
          : err?.message || 'Sync failed'
      )
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

  /**
   * Merge the latest live states from peers into the editor (a remount — the
   * only cursor-safe apply the editor's public API allows). Skips when the set
   * of live states hasn't changed since the last apply.
   */
  const applyRemoteStates = useCallback(async () => {
    const states = [...remoteByWriterRef.current.values()]
    if (states.length === 0) return
    const hash = await fingerprintStates(states)
    if (hash === lastLiveHashRef.current) {
      setRemoteChanged(false)
      return
    }
    lastLiveHashRef.current = hash
    setEditorInput((prev) => ({
      key: (prev?.key ?? 0) + 1,
      content: mergeInitialContent(states, contentRef.current),
    }))
    setRemoteChanged(false)
    setSyncedAt(Date.now())
  }, [])

  // Auto-apply peers' changes when the local user goes idle; otherwise light
  // the "New changes" affordance so a mid-typing remount never steals focus.
  const maybeApplyRemote = useCallback(() => {
    if (remoteByWriterRef.current.size === 0 || document.hidden) return
    if (Date.now() - lastLocalEditRef.current >= REMOTE_APPLY_IDLE_MS) {
      void applyRemoteStates()
    } else {
      setRemoteChanged(true)
    }
  }, [applyRemoteStates])

  useEffect(() => {
    const timer = setInterval(() => maybeApplyRemote(), 1000)
    return () => clearInterval(timer)
  }, [maybeApplyRemote])

  // Background change detection: poll writer streams and light up the Sync
  // button when someone published something we haven't merged yet. No
  // auto-remount — that would steal the cursor mid-typing.
  useEffect(() => {
    const timer = setInterval(async () => {
      const current = docId ? getDoc(docId) : undefined
      const identityRef =
        current?.role === 'collaborator'
          ? current?.sharedFrom
          : current?.writers?.length
            ? current?.manifestRef
            : undefined
      if (!identityRef || !current?.keyB64 || document.hidden) return
      try {
        const remote = await fetchRemoteDocState(identityRef, current.keyB64)
        const hash = await fingerprintStates(remote.states)
        if (lastAppliedHashRef.current && hash !== lastAppliedHashRef.current) {
          setRemoteChanged(true)
        }
      } catch {
        // Silent — polling failures surface on the next manual sync
      }
    }, 15000)
    return () => clearInterval(timer)
  }, [docId])

  // Flush the debounced local save when leaving — the last edit before a
  // navigation/close must not lose the race with the save timer.
  useEffect(() => {
    const flush = () => {
      if (docId && contentRef.current) saveContent(docId, contentRef.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      flush()
    }
  }, [docId])

  const onChange = useCallback(
    (updatedDocContent: string | JSONContent) => {
      contentRef.current = updatedDocContent
      if (adoptNextChangeAsBaselineRef.current) {
        adoptNextChangeAsBaselineRef.current = false
        savedBaselineRef.current = updatedDocContent
        setDirty(false)
      } else {
        // String states compare cheaply; object (JSONContent) docs just
        // flag dirty on any change — reference equality never matches.
        setDirty(
          typeof updatedDocContent === 'string' &&
            typeof savedBaselineRef.current === 'string'
            ? updatedDocContent !== savedBaselineRef.current
            : true
        )
      }
      lastLocalEditRef.current = Date.now()
      // Live-propagate to peers (only base64 Yjs states are CRDT-mergeable;
      // JSONContent docs fall back to the durable sync path).
      if (typeof updatedDocContent === 'string') {
        liveSessionRef.current?.broadcastState(updatedDocContent)
      }
      if (!docId) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveContent(docId, updatedDocContent)
        updateDoc(docId, {})
      }, 800)
    },
    [docId]
  )
  onChangeRef.current = onChange

  const onRename = (name: string) => {
    setDocName(name)
    if (docId) updateDoc(docId, { name })
  }

  const publish = async (writerList: DocWriter[]) => {
    if (!docId || !doc) return
    const connected = await connectSwarm()
    if (!connected && !hasWritableStorage()) {
      throw new Error(
        'No Swarm provider available. Open ddrive in Freedom Browser to save.'
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
      kind: doc?.kind || 'doc',
      ...(doc?.sheetId ? { sheetId: doc.sheetId } : {}),
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
    savedBaselineRef.current = contentRef.current
    setDirty(false)

    // A collaborator's first publish creates their writer feed — announce it
    // over presence so the owner auto-adds them (no card paste needed).
    if (isCollaborator && manifestRef) {
      liveSessionRef.current?.announce({ feedRef: manifestRef })
    }
  }
  publishRef.current = publish

  const onPublish = async () => {
    try {
      setPublishState('publishing')
      setPublishError(null)
      await publish(writers)
      setPublishState('published')
      setTimeout(() => setPublishState('idle'), 2500)
    } catch (err: any) {
      console.error(err)
      setPublishError(err?.message || 'Save failed')
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
      setPublishError(err?.message || 'Failed to save collaborator list')
      setPublishState('error')
    }
  }

  const onRemoveWriter = async (feedRef: string) => {
    const next = writers.filter((writer) => writer.feedRef !== feedRef)
    setWriters(next)
    try {
      await publish(next)
    } catch (err: any) {
      setPublishError(err?.message || 'Failed to save collaborator list')
    }
  }

  /**
   * Owner-side: a collaborator announced their writer feed over presence. Add
   * it to the descriptor and republish, so async readers and the durable
   * catch-up path see them too — the live replacement for the card handshake.
   */
  const addDiscoveredWriter = useCallback(
    async (peer: LivePeer) => {
      if (isCollaborator || !peer.feedRef) return
      const ref = peer.feedRef.trim().toLowerCase()
      if (!SWARM_REF_REGEX.test(ref)) return
      if (discoveringRef.current.has(ref)) return
      const current = getDoc(docId!)
      if (current?.writers?.some((writer) => writer.feedRef === ref)) return
      discoveringRef.current.add(ref)
      try {
        const next = [
          ...(current?.writers || []),
          {
            feedRef: ref,
            label:
              peer.name?.trim() ||
              `Collaborator ${(current?.writers?.length || 0) + 1}`,
          },
        ]
        setWriters(next)
        await publishRef.current(next)
        await syncFromSwarm()
      } catch (err: any) {
        setPublishError(err?.message || 'Failed to add collaborator')
      } finally {
        discoveringRef.current.delete(ref)
      }
    },
    [isCollaborator, docId, syncFromSwarm]
  )

  // Keep the session's callbacks pointed at the latest closures without
  // restarting the GSOC subscription on every render.
  liveHandlersRef.current.onPeer = addDiscoveredWriter
  liveHandlersRef.current.onRemote = (state, from) => {
    remoteByWriterRef.current.set(from, state)
    maybeApplyRemote()
  }

  // Start/stop the live session. Runs once the doc has a shareable identity
  // (post-publish) so the owner is listening for collaborators and every
  // participant relays edits. Falls back silently when messaging is absent.
  useEffect(() => {
    if (!docIdentityRef || !docKey) return
    let session: LiveCollabSession | null = null
    let cancelled = false
    const myFeedRef = isCollaborator ? doc?.manifestRef : docIdentityRef
    startLiveCollab({
      docIdentity: docIdentityRef,
      keyB64: docKey,
      myWriterId: writerId,
      myFeedRef,
      myName: docName,
      onPeerDiscovered: (peer) => liveHandlersRef.current.onPeer(peer),
      onRemoteState: (state, from) =>
        liveHandlersRef.current.onRemote(state, from),
    })
      .then((s) => {
        if (cancelled) {
          void s?.close()
          return
        }
        session = s
        liveSessionRef.current = s
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (liveSessionRef.current === session) liveSessionRef.current = null
      void session?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIdentityRef, docKey, isCollaborator, writerId])

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
          <p className="text-[var(--text-muted)] mb-4">Document not found on this device.</p>
          <button
            onClick={goBack}
            className="text-blue-600 hover:underline"
          >
            {returnUrl ? 'Back to drive' : 'Back to documents'}
          </button>
        </div>
      </main>
    )
  }

  // Share controls, rendered in two shells: a dropdown on desktop and a
  // bottom drawer on phones (the dropdown is unusable at 380px).
  const sharePanel = (
    <>
      {!viewLink && (
        <p className="text-[var(--text-muted)]">
          Save once to get shareable links.
        </p>
      )}
      {viewLink && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">Read-only link</span>
          <button
            onClick={() => copyToClipboard('view', viewLink)}
            className="border border-[var(--border)] rounded px-2 py-1 hover:bg-[var(--hover)]!"
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
            className="border border-[var(--border)] rounded px-2 py-1 hover:bg-[var(--hover)]!"
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
              <code className="text-[11px] break-all flex-1 bg-[var(--surface-2)] rounded p-2">
                {myCard}
              </code>
              <button
                onClick={() => copyToClipboard('card', myCard)}
                className="border border-[var(--border)] rounded px-2 py-1 hover:bg-[var(--hover)]! shrink-0"
              >
                {copied === 'card' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-[var(--text-muted)]">
              Save once to create your writer stream, then send this card
              to the owner so they can add you.
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
                <span className="text-[var(--text-muted)]">
                  {writer.feedRef.slice(0, 8)}…
                </span>
              </span>
              <button
                onClick={() => onRemoveWriter(writer.feedRef)}
                className="text-[var(--text-muted)] hover:text-red-500"
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
              className="w-[100px] border border-[var(--border)] rounded px-2 py-1"
            />
            <input
              value={newWriterRef}
              onChange={(e) => setNewWriterRef(e.target.value)}
              placeholder="Paste collaborator card (64-hex)"
              className="flex-1 border border-[var(--border)] rounded px-2 py-1"
            />
            <button
              onClick={onAddWriter}
              disabled={!SWARM_REF_REGEX.test(newWriterRef.trim())}
              className="border border-[var(--border)] rounded px-2 py-1 hover:bg-[var(--hover)]! disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <p className="text-[var(--text-muted)] text-[12px]">
            Send the edit link to a collaborator; they save once and send
            you back their collaborator card.
          </p>
        </div>
      )}
    </>
  )

  // A doc that has never been saved to Swarm can always be saved (that
  // first save is what mints the shareable links), otherwise only when
  // there are unsaved changes.
  const canSave = dirty || !doc?.lastPublishedRef

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
      <div className="flex flex-1 items-center gap-3 min-w-0">
        {/* Mobile only: chevron back to the drive. Desktop has no back
            control at all — the drive tab is still open next door. */}
        <button
          onClick={goBack}
          title="Back to ddrive"
          className="desktop-hidden shrink-0 -ml-1 p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <input
          value={docName}
          onChange={(e) => onRename(e.target.value)}
          disabled={isCollaborator}
          className="flex-1 w-full font-medium text-[15px] bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--border)] rounded px-2 py-1 min-w-0 truncate disabled:text-[var(--text-muted)]"
          title={isCollaborator ? 'Only the owner can rename a shared doc' : undefined}
        />
        {isSheet && sheetStatus && sheetStatus !== 'synced' && (
          <button
            onClick={() =>
              setEditorInput((prev) =>
                prev ? { ...prev, key: prev.key + 1 } : prev
              )
            }
            className="text-[12px] text-amber-700 border border-amber-300 rounded-lg px-2 py-1 shrink-0"
            title={`Sheet status: ${sheetStatus}`}
          >
            ↻ Reload sheet
          </button>
        )}
        {isShared && (
          <button
            onClick={syncFromSwarm}
            disabled={syncing}
            style={
              remoteChanged
                ? { backgroundColor: '#2563eb', color: '#fff', borderColor: '#2563eb' }
                : undefined
            }
            className={
              remoteChanged
                ? 'text-[12px] border rounded-lg px-2 py-1 shrink-0 animate-pulse'
                : 'text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2 py-1 shrink-0'
            }
            title={
              syncedAt
                ? `Last synced ${new Date(syncedAt).toLocaleTimeString()}`
                : 'Fetch collaborators’ latest changes'
            }
          >
            {syncing
              ? 'Syncing…'
              : remoteChanged
                ? '⟳ New changes'
                : '⟳ Sync'}
          </button>
        )}
        {canAddToDrive && (
          <button
            onClick={addToDrive}
            className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-2 py-1 shrink-0"
            title="Save this shared document into your ddrive"
          >
            + Add to ddrive
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
        {/* Sheets are light-only (dsheet limitation) — no toggle there. */}
        {!isSheet && (
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            className="text-[15px] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        )}
        {versions.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-3 py-1.5"
            >
              History ({versions.length})
            </button>
            {showHistory && (
              <div className="absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[240px] max-h-[300px] overflow-auto z-50">
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
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--hover)]! flex justify-between gap-3"
                  >
                    <span>
                      v{versions.length - i}
                      {i === 0 && <span className="text-[var(--text-muted)]"> (latest)</span>}
                    </span>
                    <span className="text-[var(--text-muted)]">
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
              className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-lg px-3 py-1.5"
            >
              Share
            </button>
            {/* Desktop: anchored dropdown. */}
            {showShare && (
              <div className="mobile-hidden absolute right-0 top-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg p-4 w-[380px] z-50 text-[13px]">
                <div className="flex flex-col gap-3">{sharePanel}</div>
              </div>
            )}
            {/* Mobile: bottom drawer through a portal (the class must sit on
                the portal ROOT — it renders into <body>, outside any
                responsive wrapper in this tree). */}
            {showShare &&
              createPortal(
                <div className="desktop-hidden fixed inset-0 z-[70]">
                  <div
                    className="absolute inset-0 bg-black/40"
                    onClick={() => setShowShare(false)}
                  />
                  <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-[var(--surface)] border-t border-[var(--border)] shadow-[0_-8px_30px_rgba(0,0,0,0.35)] p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[75vh] overflow-y-auto overscroll-contain flex flex-col gap-3 text-[13px]">
                    <div className="mx-auto h-1 w-10 rounded-full bg-[var(--border)]" />
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[15px]">Share</span>
                      <button
                        onClick={() => setShowShare(false)}
                        className="text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
                      >
                        ✕
                      </button>
                    </div>
                    {sharePanel}
                  </div>
                </div>,
                document.body
              )}
          </div>
        )}
        {/* "Save" (users don't know what "publish" means). The button IS the
            unsaved-changes indicator: accent Save when dirty (or never yet
            saved), muted disabled Saved when clean. */}
        <button
          onClick={onPublish}
          disabled={
            publishState === 'publishing' ||
            (!canSave && publishState !== 'published')
          }
          title={
            canSave ? 'You have unsaved changes' : 'All changes saved to Swarm'
          }
          className={
            canSave || publishState !== 'idle'
              ? 'bg-[var(--accent)]! text-white rounded-lg px-4 py-1.5 text-[14px] font-medium hover:opacity-90 disabled:opacity-70'
              : 'border border-[var(--border)] text-[var(--text-muted)] rounded-lg px-4 py-1.5 text-[14px] font-medium'
          }
        >
          {publishState === 'publishing'
            ? 'Saving…'
            : publishState === 'published'
              ? 'Saved ✓'
              : canSave
                ? 'Save'
                : 'Saved'}
        </button>
      </div>
    </div>
  )

  if (!editorInput) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
          <div className="text-sm text-[var(--text-muted)]">
            Syncing shared document from Swarm…
          </div>
        </div>
      </main>
    )
  }

  if (isSheet) {
    // The sheet editor takes a single merged Yjs state (portalContent,
    // memoized above) and emits the full state as onChange's 2nd argument.
    return (
      <main className="min-h-full">
        <Suspense
          fallback={
            <div className="min-h-full flex items-center justify-center pt-32">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
            </div>
          }
        >
          <DSheetEditor
            key={editorInput.key}
            dsheetId={doc?.sheetId || docId!}
            isNewSheet={sheetPortalContent === ''}
            isAuthorized={true}
            portalContent={sheetPortalContent || undefined}
            onChange={onSheetChange}
            onContentSyncStatusChange={onSheetSyncStatus}
            renderNavbar={renderNavbar}
            // Unlocks dsheet's built-in Import/Export menu (.xlsx/.csv in,
            // .xlsx/.csv/.json out) — gated off by default.
            allowSheetDownload={true}
          />
        </Suspense>
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
        theme={theme}
        // Built-in Slides mode (md2slides): present the doc as slides.
        isPresentationMode={isPresentationMode}
        setIsPresentationMode={setIsPresentationMode}
      />
    </main>
  )
}
