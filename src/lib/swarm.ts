/**
 * Swarm adapter for Freedom Docs — the only module that touches window.swarm.
 *
 * Documents are published as immutable JSON snapshots; each doc gets a native
 * Swarm feed (created/updated through the Freedom Browser provider) whose
 * manifest reference is the doc's stable share address: bzz://<manifest>/
 * always resolves to the latest published snapshot.
 *
 * Outside Freedom Browser: reads fall back to an HTTP Bee gateway; writes
 * fall back to a local Bee node when VITE_BEE_API + VITE_BEE_POSTAGE_BATCH
 * are set (dev only, no feeds — every publish yields a new immutable ref).
 */

export interface SwarmPublishResult {
  reference: string
  bzzUrl: string
}

export interface SwarmFeedInfo {
  feedId: string
  owner?: string
  topic?: string
  manifestReference: string
  bzzUrl?: string
}

interface WindowSwarmProvider {
  requestAccess: () => Promise<unknown>
  getCapabilities: () => Promise<{
    canPublish: boolean
    reason?: string
    limits?: Record<string, number>
  }>
  publishData: (params: {
    data: string | Uint8Array
    contentType?: string
    name?: string
  }) => Promise<SwarmPublishResult>
  createFeed: (params: { name: string }) => Promise<SwarmFeedInfo>
  updateFeed: (params: {
    feedId: string
    reference: string
  }) => Promise<{ feedId: string; reference: string; bzzUrl?: string }>
}

declare global {
  interface Window {
    swarm?: WindowSwarmProvider
  }
}

const FALLBACK_GATEWAY = (
  import.meta.env.VITE_FALLBACK_GATEWAY || 'https://api.gateway.ethswarm.org'
).replace(/\/+$/, '')

const DEV_BEE_API = (import.meta.env.VITE_BEE_API || '').replace(/\/+$/, '')
const DEV_BEE_BATCH = import.meta.env.VITE_BEE_POSTAGE_BATCH || ''

const isBzzScheme = () =>
  typeof window !== 'undefined' && window.location?.protocol === 'bzz:'

export const isFreedomBrowser = () =>
  typeof window !== 'undefined' && !!window.swarm

export const hasWritableStorage = () =>
  isFreedomBrowser() || Boolean(DEV_BEE_API && DEV_BEE_BATCH)

export const supportsFeeds = () => isFreedomBrowser()

export const swarmUrl = (reference: string) => {
  if (isBzzScheme()) return `bzz://${reference}/`
  const origin = DEV_BEE_API || FALLBACK_GATEWAY
  return `${origin}/bzz/${reference}/`
}

export const connectSwarm = async (timeoutMs = 4000): Promise<boolean> => {
  const start = Date.now()
  while (!window.swarm && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!window.swarm) return false
  await window.swarm.requestAccess()
  const capabilities = await window.swarm.getCapabilities()
  if (!capabilities.canPublish) {
    throw new Error(
      capabilities.reason ||
        'Swarm node cannot publish. Check your postage stamps in Freedom Browser.'
    )
  }
  return true
}

export const publishJson = async (
  value: unknown,
  name?: string
): Promise<string> => {
  const payload = JSON.stringify(value)
  if (window.swarm) {
    const result = await window.swarm.publishData({
      data: payload,
      contentType: 'application/json',
      name,
    })
    return result.reference
  }
  return devBeePublish(payload, 'application/json', name)
}

export const createDocFeed = async (name: string): Promise<SwarmFeedInfo> => {
  if (!window.swarm) {
    throw new Error('Feeds require Freedom Browser')
  }
  return window.swarm.createFeed({ name })
}

export const updateDocFeed = async (feedId: string, reference: string) => {
  if (!window.swarm) {
    throw new Error('Feeds require Freedom Browser')
  }
  return window.swarm.updateFeed({ feedId, reference })
}

const devBeePublish = async (
  data: string | Uint8Array,
  contentType: string,
  name?: string
): Promise<string> => {
  if (!DEV_BEE_API || !DEV_BEE_BATCH) {
    throw new Error(
      'No Swarm provider available. Open this app in Freedom Browser, or set VITE_BEE_API and VITE_BEE_POSTAGE_BATCH for local development.'
    )
  }
  const url = new URL(`${DEV_BEE_API}/bzz`)
  if (name) url.searchParams.set('name', name)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Swarm-Postage-Batch-Id': DEV_BEE_BATCH,
    },
    body: data as BodyInit,
  })
  if (!response.ok) {
    throw new Error(`Bee upload failed: ${response.status}`)
  }
  const { reference } = await response.json()
  return reference
}

/** Fetch raw bytes from Swarm (e.g. an uploaded file's content). */
export const getSwarmBytes = async (reference: string): Promise<Uint8Array> => {
  let lastError: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const response = await fetch(swarmUrl(reference))
      if (!response.ok) throw new Error(`Swarm fetch failed: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      lastError = error
    }
  }
  console.error('Swarm fetch failed:', lastError)
  throw new Error('Failed to load the file from Swarm.')
}

export const getSwarmJson = async (reference: string) => {
  let lastError: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const response = await fetch(swarmUrl(reference))
      if (!response.ok) throw new Error(`Swarm fetch failed: ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  console.error('Swarm fetch failed:', lastError)
  throw new Error('Failed to load the document from Swarm.')
}
