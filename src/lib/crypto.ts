/**
 * Per-document end-to-end encryption.
 *
 * Every document gets a random AES-256-GCM key at creation. Published
 * snapshots are encrypted envelopes; the key never leaves the client
 * except inside share links (as a URL path segment under the hash router,
 * so it is never sent to any gateway or server — URL fragments stay local).
 *
 * Envelope (published to Swarm):
 *   { schema: 'freedom-docs/edoc/1', alg: 'A256GCM', iv: <b64url>, ct: <b64url> }
 * Plaintext inside: a DocSnapshot ({ schema: 'freedom-docs/doc/1', name, content, publishedAt }).
 */

export const ENCRYPTED_SCHEMA = 'freedom-docs/edoc/1'

export type EncryptedEnvelope = {
  schema: typeof ENCRYPTED_SCHEMA
  alg: 'A256GCM'
  iv: string
  ct: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// --- base64url helpers (no padding, URL-safe: fits in a route segment) ---

export const bytesToB64url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const b64urlToBytes = (value: string): Uint8Array => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const B64URL_KEY_REGEX = /^[A-Za-z0-9_-]{43}$/ // 32 bytes, unpadded

// --- key handling ---

export const generateDocKey = (): string => {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  return bytesToB64url(raw)
}

const importKey = (keyB64: string, usage: KeyUsage[]) =>
  crypto.subtle.importKey(
    'raw',
    b64urlToBytes(keyB64),
    { name: 'AES-GCM' },
    false,
    usage
  )

// --- envelope encrypt/decrypt ---

export const encryptJson = async (
  keyB64: string,
  value: unknown
): Promise<EncryptedEnvelope> => {
  const key = await importKey(keyB64, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )
  return {
    schema: ENCRYPTED_SCHEMA,
    alg: 'A256GCM',
    iv: bytesToB64url(iv),
    ct: bytesToB64url(new Uint8Array(ciphertext)),
  }
}

export const decryptJson = async (
  keyB64: string,
  envelope: EncryptedEnvelope
): Promise<unknown> => {
  if (envelope.schema !== ENCRYPTED_SCHEMA || envelope.alg !== 'A256GCM') {
    throw new Error('Unsupported envelope format')
  }
  const key = await importKey(keyB64, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlToBytes(envelope.iv) as BufferSource },
    key,
    b64urlToBytes(envelope.ct) as BufferSource
  )
  return JSON.parse(textDecoder.decode(plaintext))
}

export const isEncryptedEnvelope = (data: any): data is EncryptedEnvelope =>
  Boolean(data) && data.schema === ENCRYPTED_SCHEMA
