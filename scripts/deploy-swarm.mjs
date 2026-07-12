// Publish the built Freedom Docs app (dist/) to Swarm as a content-addressed
// collection, so it can be served from a bzz:// origin.
//
// Usage:
//   node scripts/deploy-swarm.mjs [--bee <url>] [--batch <id>]
// Defaults: bee http://127.0.0.1:1633 (Freedom's default Ant port),
// longest-TTL usable batch auto-selected.
//
// Prints the collection reference. Load it at bzz://<ref>/ in Freedom Browser,
// or resolve http://<bee>/bzz/<ref>/ through any Swarm gateway. For a stable
// name, set an ENS contenthash to the reference (done outside this script).

import { Bee } from '@ethersphere/bee-js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const distDir = path.join(root, 'dist')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const beeUrl = arg('bee', process.env.BEE_URL || 'http://127.0.0.1:1633')

async function selectBatch(bee, explicit) {
  if (explicit) return explicit
  const batches = await bee.getAllPostageBatch()
  const usable = batches
    .filter((b) => b.usable && BigInt(b.amount ?? '0') > 0n)
    .sort((a, b) => (b.batchTTL ?? 0) - (a.batchTTL ?? 0))
  if (usable.length === 0) {
    throw new Error(
      'No usable, funded postage batch. Buy stamps on the node first.'
    )
  }
  return usable[0].batchID
}

async function main() {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`No build at ${distDir}. Run: npm run build`)
  }
  const bee = new Bee(beeUrl)
  const health = await bee.getHealth().catch(() => null)
  if (!health) throw new Error(`Bee not reachable at ${beeUrl}`)

  const batchId = await selectBatch(bee, arg('batch'))
  console.log(
    `[deploy] bee=${beeUrl} batch=${String(batchId).slice(0, 12)}… dir=${distDir}`
  )

  const result = await bee.uploadFilesFromDirectory(batchId, distDir, {
    indexDocument: 'index.html',
    pin: true,
  })

  const ref = result.reference.toString()
  console.log(`\n[deploy] published Freedom Docs to Swarm`)
  console.log(`  reference : ${ref}`)
  console.log(`  bzz URL   : bzz://${ref}/`)
  console.log(`  gateway   : ${beeUrl}/bzz/${ref}/`)
  console.log(`\nSet an ENS contenthash to bzz://${ref} for a stable name.`)
  return ref
}

main().catch((error) => {
  console.error(`[deploy] failed: ${error.message}`)
  process.exit(1)
})
