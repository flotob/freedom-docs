import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { joinSharedDoc } from '../lib/shared-doc'

/**
 * Edit-link entry point (#/e/<ownerFeedRef>/<key>): bind a local
 * collaborator record to the shared doc and open the editor.
 */
export const JoinPage = () => {
  const { reference, docKey } = useParams()
  const navigate = useNavigate()
  const joined = useRef(false)

  useEffect(() => {
    if (!reference || !docKey || joined.current) return
    joined.current = true
    const doc = joinSharedDoc(reference.toLowerCase(), docKey)
    navigate(`/edit/${doc.id}`, { replace: true })
  }, [reference, docKey, navigate])

  return (
    <main className="min-h-full flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-4 border-[var(--border)] border-b-gray-800" />
    </main>
  )
}
