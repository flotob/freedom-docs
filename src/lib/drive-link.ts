/**
 * Links into the co-deployed ddrive app (one Swarm collection, drive at
 * /drive/, docs at /docs/). Explicit index.html — Swarm serves exact file
 * paths reliably; directory-index resolution is not guaranteed.
 */
export const DRIVE_ENTRY =
  import.meta.env.VITE_DRIVE_ENTRY || '/drive/index.html'

// The drive's pending-import stash (see the drive's utils/docs-interop.ts).
export const PENDING_DOC_IMPORT_KEY = 'drive:pending-doc-import'

/** The signed-in drive session the two apps share via localStorage. */
export const getDriveSession = (): { portalAddress: string } | null => {
  try {
    const raw = localStorage.getItem('portalDetails')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.portalAddress ? parsed : null
  } catch {
    return null
  }
}
