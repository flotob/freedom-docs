import { Suspense, lazy, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DdocEditor } from '@fileverse-dev/ddoc'
import { applyTheme, getStoredTheme, systemTheme } from '../lib/theme'
import { mergeYjsStates } from '../lib/yjs-merge'

const DSheetEditor = lazy(() => import('../lib/sheet-editor'))
import { DOC_SCHEMA, DocSnapshot } from '../lib/docs-store'
import { getSwarmJson } from '../lib/swarm'
import { decryptJson, isEncryptedEnvelope } from '../lib/crypto'
import { fetchRemoteDocState } from '../lib/shared-doc'

export const ViewerPage = () => {
  const { reference, docKey } = useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<DocSnapshot | null>(null)

  // Sheets are light-only (dsheet limitation) — force light while viewing.
  const isSheetSnapshot = snapshot?.kind === 'sheet'
  useEffect(() => {
    if (!isSheetSnapshot) return
    applyTheme('light')
    return () => applyTheme(getStoredTheme() ?? systemTheme())
  }, [isSheetSnapshot])
  const [error, setError] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState('1')
  const [isNavbarVisible, setIsNavbarVisible] = useState(true)

  useEffect(() => {
    if (!reference) return
    let cancelled = false
    setSnapshot(null)
    setError(null)

    const load = async () => {
      const data = await getSwarmJson(reference)
      if (cancelled) return

      let payload: any = data
      if (isEncryptedEnvelope(data)) {
        if (!docKey) {
          setError(
            'This document is encrypted — you need the full share link (it includes the decryption key).'
          )
          return
        }
        try {
          payload = await decryptJson(docKey, data)
        } catch {
          setError('Wrong key — this link cannot decrypt the document.')
          return
        }
      }
      if (cancelled) return

      if (payload?.schema !== DOC_SCHEMA) {
        setError('This Swarm reference is not a ddrive document.')
        return
      }

      const snapshot = payload as DocSnapshot
      // Shared doc: merge every collaborator's stream into the view
      if (snapshot.writers?.length && docKey) {
        try {
          const remote = await fetchRemoteDocState(reference, docKey)
          if (cancelled) return
          if (remote.states.length > 0) {
            snapshot.content = remote.states as unknown as string
          }
        } catch (err) {
          console.warn('Failed to merge collaborator streams:', err)
        }
      }
      setSnapshot(snapshot)
    }

    load().catch((err) => {
      if (!cancelled) setError(err?.message || 'Failed to load document')
    })

    return () => {
      cancelled = true
    }
  }, [reference, docKey])

  const renderNavbar = () => (
    <div className="w-full flex items-center justify-between gap-4 px-3 py-1.5">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => navigate('/')}
          className="text-[var(--text-muted)] hover:text-[var(--text)] text-[14px] shrink-0"
        >
          ← Docs
        </button>
        <span className="font-medium text-[15px] truncate">
          {snapshot?.name || 'Shared document'}
        </span>
      </div>
      <span className="text-[13px] text-[var(--text-muted)] shrink-0">
        Read-only · served from Swarm
      </span>
    </div>
  )

  if (error) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-[14px] mb-4">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:underline text-[14px]"
          >
            Back to documents
          </button>
        </div>
      </main>
    )
  }

  if (!snapshot) {
    return (
      <main className="min-h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
      </main>
    )
  }

  if (snapshot.kind === 'sheet') {
    const states = Array.isArray(snapshot.content)
      ? (snapshot.content as string[])
      : typeof snapshot.content === 'string' && snapshot.content
        ? [snapshot.content]
        : []
    const portalContent = states.length > 0 ? mergeYjsStates(states) : ''
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
            dsheetId={snapshot.sheetId || `viewer-${reference}`}
            isNewSheet={false}
            isAuthorized={false}
            isReadOnly={true}
            portalContent={portalContent || undefined}
            renderNavbar={renderNavbar}
          />
        </Suspense>
      </main>
    )
  }

  return (
    <main className="min-h-full">
      <DdocEditor
        isPreviewMode={true}
        theme={getStoredTheme() ?? systemTheme()}
        initialContent={snapshot.content}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        isNavbarVisible={isNavbarVisible}
        setIsNavbarVisible={setIsNavbarVisible}
        documentName={snapshot.name}
        renderNavbar={renderNavbar}
      />
    </main>
  )
}
