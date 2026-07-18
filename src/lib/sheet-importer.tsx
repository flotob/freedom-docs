import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { handleCSVUpload } from '@fileverse-dev/dsheet'
import * as XLSX from 'xlsx'

/**
 * Headless xlsx/csv → dsheet conversion.
 *
 * We deliberately do NOT use dsheet's xlsx importer: it depends on exceljs,
 * whose browser build hangs forever in `workbook.xlsx.load()` (verified on a
 * clean page with exceljs's own output — upstream breakage, not our
 * bundling). Instead SheetJS parses the workbook and each worksheet is fed as
 * CSV through dsheet's own papaparse-based CSV importer, which writes into
 * the Y.Doc we supply. Cell DATA imports; cross-sheet formatting is lost —
 * acceptable for an "Open as Freedom Sheet" flow.
 *
 * The Y.Doc is keyed by the new sheet's dsheetId (dsheet keys its workbook
 * array by that id, so it MUST match the record's sheetId).
 *
 * This module statically imports @fileverse-dev/dsheet + xlsx, so it must
 * ONLY be loaded lazily (React.lazy) — otherwise the whole spreadsheet stack
 * lands in the main bundle. (dsheet's CSS is a separate export, not pulled.)
 */

const toB64 = (bytes: Uint8Array): string => {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const SheetImporter = ({
  file,
  dsheetId,
  onDone,
  onError,
}: {
  file: File
  dsheetId: string
  onDone: (contentB64: string) => void
  onError: (error: unknown) => void
}) => {
  const ydocRef = useRef<Y.Doc | null>(null)
  if (!ydocRef.current) ydocRef.current = new Y.Doc()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheetEditorRef = useRef<any>(null)
  const currentDataRef = useRef<object | null>(null)
  const [, setForceSheetRender] = useState(0)
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    ;(async () => {
      try {
        const ydoc = ydocRef.current!

        // Worksheets as { name, csv } — csv files pass through unchanged.
        let sheets: { name: string; csv: string }[]
        if (/\.csv$/i.test(file.name)) {
          sheets = [
            {
              name: file.name.replace(/\.csv$/i, '') || 'Sheet1',
              csv: await file.text(),
            },
          ]
        } else {
          const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
            type: 'array',
          })
          sheets = wb.SheetNames.map((name) => ({
            name,
            csv: XLSX.utils.sheet_to_csv(wb.Sheets[name]),
          }))
        }
        if (!sheets.length) throw new Error('No worksheets found in this file')

        // First sheet initialises the workbook; the rest append. The file
        // name becomes the sheet tab name verbatim, so no .csv suffix.
        for (let i = 0; i < sheets.length; i++) {
          const csvFile = new File([sheets[i].csv], sheets[i].name, {
            type: 'text/csv',
          })
          await handleCSVUpload(
            undefined,
            ydoc,
            setForceSheetRender,
            dsheetId,
            currentDataRef,
            sheetEditorRef,
            undefined,
            csvFile,
            i === 0 ? 'new-dsheet' : 'merge-current-dsheet'
          )
        }

        const update = Y.encodeStateAsUpdate(ydoc)
        if (update.length < 8) {
          throw new Error('Conversion produced an empty spreadsheet')
        }
        onDone(toB64(update))
      } catch (err) {
        onError(err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default SheetImporter
