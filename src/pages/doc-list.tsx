import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DocRecord,
  createDoc,
  deleteDoc,
  listDocs,
} from '../lib/docs-store'
import { isFreedomBrowser } from '../lib/swarm'

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

  const onDelete = (id: string) => {
    deleteDoc(id)
    setDocs(listDocs())
  }

  const onOpenShared = () => {
    const ref = openRef.trim().replace(/^bzz:\/\//, '').replace(/\/+$/, '')
    if (/^[0-9a-fA-F]{64}$/.test(ref)) {
      navigate(`/d/${ref.toLowerCase()}`)
    }
  }

  return (
    <main className="min-h-full px-4 sm:px-6">
      <div className="max-w-[860px] mx-auto py-8 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Freedom Docs</h1>
          <p className="text-[15px] text-[#77818A]">
            End-to-end yours: documents that live on Ethereum Swarm, published
            through your own node in Freedom Browser. No accounts, no servers.
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
          <div className="flex-1 flex gap-2">
            <input
              value={openRef}
              onChange={(e) => setOpenRef(e.target.value)}
              placeholder="Open shared doc: bzz://… or 64-hex reference"
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
                <span className="font-medium text-[15px]">{doc.name}</span>
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
