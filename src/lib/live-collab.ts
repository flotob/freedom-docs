/**
 * Live collaboration layer over swarm-kit's `live` messaging (PSS/GSOC).
 *
 * The durable layer (native Swarm feeds + the owner descriptor + per-writer
 * streams in docs-store/shared-doc) remains the source of truth. This module
 * is purely *live propagation + peer discovery* on top of it, so an open
 * editing session feels near-real-time instead of manual-sync:
 *
 *   - presence channel — each open session announces its identity (stable
 *     writerId, display name, and its published writer-feed ref once it has
 *     one). The owner reacts by adding freshly-seen writers to the descriptor,
 *     which replaces the copy-paste "collaborator card" handshake.
 *   - yjs channel — each session broadcasts its full Yjs state (encrypted with
 *     the per-doc key) on a debounce. Peers merge it into the editor when the
 *     local user is idle (a remount is the only cursor-safe apply the editor's
 *     public API allows), otherwise the host lights its "New changes" affordance.
 *
 * Everything here is best-effort: GSOC delivery is unordered and at-least-once,
 * so payloads are CRDT-mergeable Yjs states and identity is carried explicitly.
 * If the provider lacks the messaging feature, startLiveCollab returns null and
 * the app falls back to its manual Sync button.
 */

import {
  createSwarmKit,
  hasMessagingFeature,
  type LiveBus,
} from '@freedom/swarm-kit'
import {
  encryptJson,
  decryptJson,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from './crypto'

const BUS_TOPIC_PREFIX = 'freedom-docs:collab/v1:'
const PRESENCE_CHANNEL = 'presence'
const YJS_CHANNEL = 'yjs'
/** Debounce for outbound state broadcasts — bounds GSOC/object writes while
 * staying well under human "feels live" latency. */
const BROADCAST_DEBOUNCE_MS = 1200

/** A peer announcing itself on the presence channel. */
export type LivePeer = {
  writerId: string
  /** The peer's published writer-feed ref, once they have one. */
  feedRef?: string
  name?: string
}

type PresenceFrame = LivePeer
type YjsFrame = {
  /** Sender's stable writerId — lets receivers drop their own echoes. */
  from: string
  /** Encrypted full Yjs state (base64 string inside the envelope). */
  env: EncryptedEnvelope
}

export type LiveCollabOptions = {
  /** The doc's shared identity (owner feed ref) — same for every participant. */
  docIdentity: string
  /** Per-doc AES key (base64url). */
  keyB64: string
  /** This session's stable writer id. */
  myWriterId: string
  /** This session's published writer-feed ref, if any (for owner discovery). */
  myFeedRef?: string | null
  myName?: string
  /** A peer we haven't seen announced itself (owner uses this to add writers). */
  onPeerDiscovered: (peer: LivePeer) => void
  /** A peer's decrypted full Yjs state arrived (deduped against our own). */
  onRemoteState: (state: string, from: string) => void
}

export type LiveCollabSession = {
  /** Debounced: broadcast the latest local Yjs state to peers. */
  broadcastState: (state: string) => void
  /** Re-announce our presence (e.g. after we gain a feed ref). */
  announce: (patch?: Partial<LivePeer>) => void
  close: () => Promise<void>
}

const WRITER_ID_KEY = 'freedom-docs:writer-id'

/** A stable per-browser-profile writer id (one identity across all docs). */
export const getProfileWriterId = (): string => {
  try {
    let id = localStorage.getItem(WRITER_ID_KEY)
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      localStorage.setItem(WRITER_ID_KEY, id)
    }
    return id
  } catch {
    // Non-persistent fallback (private mode / no storage).
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
}

const getProvider = () =>
  typeof window !== 'undefined'
    ? (window as unknown as { swarm?: unknown }).swarm
    : undefined

/**
 * Start a live session for a shared doc. Returns null (no live layer) when the
 * provider has no messaging feature — callers keep working via manual sync.
 */
export const startLiveCollab = async (
  opts: LiveCollabOptions
): Promise<LiveCollabSession | null> => {
  const provider = getProvider()
  if (!provider) return null

  const kit = createSwarmKit(provider as Parameters<typeof createSwarmKit>[0])

  let capabilities: Awaited<ReturnType<typeof kit.getCapabilities>>
  try {
    capabilities = await kit.getCapabilities()
  } catch {
    return null
  }
  if (!hasMessagingFeature(capabilities)) return null

  try {
    await kit.requestAccess()
  } catch {
    // Access denied — no live layer, but manual sync still works.
    return null
  }

  let bus: LiveBus
  try {
    bus = kit.live.bus({ topic: `${BUS_TOPIC_PREFIX}${opts.docIdentity}` })
  } catch {
    return null
  }

  const presence = bus.channel<PresenceFrame>(PRESENCE_CHANNEL)
  const yjs = bus.channel<YjsFrame>(YJS_CHANNEL)

  let closed = false
  let self: LivePeer = {
    writerId: opts.myWriterId,
    feedRef: opts.myFeedRef ?? undefined,
    name: opts.myName,
  }
  let lastAnnouncedAt = 0

  const announce = (patch?: Partial<LivePeer>) => {
    if (closed) return
    if (patch) self = { ...self, ...patch }
    lastAnnouncedAt = Date.now()
    void presence.send(self).catch(() => {})
  }

  // Subscribe to peers announcing themselves.
  await presence.subscribe((message) => {
    const peer = message.value
    if (!peer?.writerId || peer.writerId === opts.myWriterId) return
    opts.onPeerDiscovered(peer)
    // Answer a peer we may be new to, so discovery is mutual (throttled).
    if (Date.now() - lastAnnouncedAt > 8000) announce()
  })

  // Subscribe to peers' state broadcasts.
  await yjs.subscribe((message) => {
    const frame = message.value
    if (!frame || frame.from === opts.myWriterId) return
    if (!isEncryptedEnvelope(frame.env)) return
    void decryptJson(opts.keyB64, frame.env)
      .then((state) => {
        if (typeof state === 'string' && state.length > 0) {
          opts.onRemoteState(state, frame.from)
        }
      })
      .catch(() => {
        // Not decryptable with our key — ignore (wrong doc / stale).
      })
  })

  // Announce ourselves now that both channels are live.
  announce()

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let pendingState: string | null = null

  const flush = async () => {
    debounceTimer = null
    const state = pendingState
    pendingState = null
    if (closed || !state) return
    try {
      const env = await encryptJson(opts.keyB64, state)
      await yjs.send({ from: opts.myWriterId, env })
    } catch {
      // Best-effort: peers catch up on the next broadcast or manual sync.
    }
  }

  const broadcastState = (state: string) => {
    if (closed || !state) return
    pendingState = state
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => void flush(), BROADCAST_DEBOUNCE_MS)
  }

  return {
    broadcastState,
    announce,
    async close() {
      closed = true
      if (debounceTimer) clearTimeout(debounceTimer)
      try {
        await bus.close()
      } catch {
        // ignore
      }
    },
  }
}
