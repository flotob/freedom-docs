/**
 * exceljs served untouched.
 *
 * Vite's commonjs transform breaks exceljs's browserify bundle (its internal
 * shims get mangled and `workbook.xlsx.load()` hangs forever, silently). This
 * shim — wired via `resolve.alias` in vite.config.ts — sidesteps the problem:
 * the pristine `exceljs.min.js` is emitted as an asset (`?url`, no transform)
 * and loaded as a classic script, which sets `window.ExcelJS`. Top-level await
 * makes the named exports available to `await import('exceljs')` callers
 * (dsheet's xlsx importer destructures `{ Workbook }`).
 */
import exceljsUrl from 'exceljs/dist/exceljs.min.js?url'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ExcelJS?: any
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadScript = (): Promise<any> =>
  new Promise((resolve, reject) => {
    if (window.ExcelJS) return resolve(window.ExcelJS)
    const script = document.createElement('script')
    script.src = exceljsUrl
    script.onload = () => {
      if (window.ExcelJS) resolve(window.ExcelJS)
      else reject(new Error('exceljs loaded but window.ExcelJS is missing'))
    }
    script.onerror = () => reject(new Error('Failed to load exceljs'))
    document.head.appendChild(script)
  })

const ExcelJS = await loadScript()

export const Workbook = ExcelJS.Workbook
export default ExcelJS
