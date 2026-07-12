import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DocRecord,
  createDoc,
  deleteDoc,
  exportBackup,
  importBackup,
  listDocs,
} from '../lib/docs-store'
import { isFreedomBrowser } from '../lib/swarm'
import { B64URL_KEY_REGEX } from '../lib/crypto'

const REF_REGEX = /[0-9a-fA-F]{64}/

/** Accepts a full share URL, "ref/key", bzz://ref, or a bare 64-hex ref. */
const parseShareInput = (
  input: string
): { ref: string; key?: string } | null => {
  const trimmed = input.trim()
  const refMatch = trimmed.match(REF_REGEX)
  if (!refMatch) return null
  const after = trimmed.slice(refMatch.index! + 64).replace(/^\//, '')
  const keyCandidate = after.split(/[/?#]/)[0]
  return {
    ref: refMatch[0].toLowerCase(),
    key: B64URL_KEY_REGEX.test(keyCandidate) ? keyCandidate : undefined,
  }
}

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

export const DocList = () => {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<DocRecord[]>(listDocs())
  const [openRef, setOpenRef] = useState('')

  const onNewDoc = () => {
    const doc = createDoc()
    navigate(`/edit/${doc.id}`)
  }

  const onNewSheet = () => {
    const doc = createDoc('Untitled Sheet', 'sheet')
    navigate(`/edit/${doc.id}`)
  }

  const onDelete = (id: string) => {
    deleteDoc(id)
    setDocs(listDocs())
  }

  const onOpenShared = () => {
    const parsed = parseShareInput(openRef)
    if (parsed) {
      navigate(parsed.key ? `/d/${parsed.ref}/${parsed.key}` : `/d/${parsed.ref}`)
    }
  }

  const onExportBackup = () => {
    const backup = exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `freedom-docs-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importInputRef = useRef<HTMLInputElement>(null)

  const onImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const backup = JSON.parse(await file.text())
      const count = importBackup(backup)
      setDocs(listDocs())
      alert(`Imported ${count} document(s).`)
    } catch (err: any) {
      alert(err?.message || 'Import failed')
    } finally {
      e.target.value = ''
    }
  }

  return (
    <main className="min-h-full px-4 sm:px-6">
      <div className="max-w-[860px] mx-auto py-8 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Freedom Docs</h1>
          <p className="text-[15px] text-[#77818A]">
            End-to-end encrypted documents on Ethereum Swarm, published through
            your own node in Freedom Browser. Only people you hand the share
            link to can read them. No accounts, no servers.
          </p>
          {!isFreedomBrowser() && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[14px] text-amber-800">
              No Swarm provider detected — you can write and read locally, but
              publishing needs Freedom Browser.
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onNewDoc}
            className="bg-black text-white rounded-lg px-5 py-2.5 text-[15px] font-medium hover:bg-gray-800"
          >
            + New Document
          </button>
          <button
            onClick={onNewSheet}
            className="bg-emerald-700 text-white rounded-lg px-5 py-2.5 text-[15px] font-medium hover:bg-emerald-800"
          >
            + New Sheet
          </button>
          <div className="flex-1 flex gap-2">
            <input
              value={openRef}
              onChange={(e) => setOpenRef(e.target.value)}
              placeholder="Open shared doc: paste a share link or Swarm reference"
              className="flex-1 bg-white px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-gray-300 text-[14px]"
            />
            <button
              onClick={onOpenShared}
              className="border border-gray-300 rounded-lg px-4 py-2 text-[14px] hover:bg-gray-100"
            >
              Open
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 text-[13px] text-gray-500 -mt-4">
          <button onClick={onExportBackup} className="hover:text-gray-800">
            Export backup (docs + keys)
          </button>
          <span>·</span>
          <button
            onClick={() => importInputRef.current?.click()}
            className="hover:text-gray-800"
          >
            Import backup
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            onChange={onImportBackup}
            className="hidden"
          />
        </div>

        <div className="flex flex-col gap-2">
          {docs.length === 0 && (
            <div className="text-gray-500 text-[15px] py-8 text-center border border-dashed border-gray-300 rounded-xl">
              No documents yet — create your first one.
            </div>
          )}
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:border-gray-300 cursor-pointer"
              onClick={() => navigate(`/edit/${doc.id}`)}
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium text-[15px] flex items-center gap-2">
                  <span className="text-gray-400 text-[13px]">
                    {doc.kind === 'sheet' ? '▦' : '≣'}
                  </span>
                  {doc.name}
                  {doc.role === 'collaborator' && (
                    <span className="text-[11px] font-normal bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5">
                      shared with me
                    </span>
                  )}
                  {doc.role !== 'collaborator' && (doc.writers?.length || 0) > 0 && (
                    <span className="text-[11px] font-normal bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                      {doc.writers!.length} collaborator
                      {doc.writers!.length > 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                <span className="text-[13px] text-gray-500">
                  Edited {formatDate(doc.updatedAt)}
                  {doc.publishedAt && (
                    <> · Published {formatDate(doc.publishedAt)}</>
                  )}
                  {doc.manifestRef && <> · On Swarm</>}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(doc.id)
                }}
                className="text-gray-400 hover:text-red-500 text-[13px] px-2 py-1"
                title="Remove from this device (published copies stay on Swarm)"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
