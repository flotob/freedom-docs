import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { B64URL_KEY_REGEX } from '../lib/crypto'
import { DRIVE_ENTRY } from '../lib/drive-link'

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

/**
 * The docs app has no standalone home — your documents live in ddrive
 * (created there, listed there, opened from there). This page hands off to
 * the drive, plus a paste-a-link opener for shared documents.
 */
export const DocList = () => {
  const navigate = useNavigate()
  const [openRef, setOpenRef] = useState('')

  const onOpenShared = () => {
    const parsed = parseShareInput(openRef)
    if (parsed) {
      navigate(parsed.key ? `/d/${parsed.ref}/${parsed.key}` : `/d/${parsed.ref}`)
    }
  }

  return (
    <main className="min-h-dvh flex flex-col bg-[var(--frame-bg)] text-[var(--text)]">
      <header className="flex items-center gap-2.5 px-6 py-5 sm:px-8">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent)]! text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </div>
        <span className="logotype text-[20px]">ddrive Docs</span>
      </header>

      <div className="flex flex-1 items-start justify-center px-4 pt-[10vh] pb-12 sm:px-6">
        <div className="w-full max-w-[420px] flex flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] font-medium leading-tight tracking-[-0.02em]">
              Your documents live in ddrive
            </h1>
            <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">
              Create and open documents and spreadsheets from your drive —
              they open here in the editor.
            </p>
          </div>

          <a
            href={`${DRIVE_ENTRY}#/`}
            className="flex w-full max-w-[300px] items-center justify-center gap-2.5 rounded-full px-6! py-3.5! text-[15px] font-medium text-white bg-[var(--accent)]! hover:opacity-90"
          >
            Open ddrive
          </a>

          <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col gap-3 text-left">
            <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Have a share link?
            </span>
            <div className="flex gap-2">
              <input
                value={openRef}
                onChange={(e) => setOpenRef(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenShared()
                }}
                placeholder="Paste a document link or reference"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--content-bg)] px-4! py-3! text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
              />
              <button
                onClick={onOpenShared}
                disabled={!parseShareInput(openRef)}
                className="shrink-0 rounded-xl px-4! py-3! text-[14px] font-medium text-white bg-[var(--accent)]! hover:opacity-90 disabled:opacity-50"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
