/**
 * Lazy entry point for the spreadsheet editor.
 *
 * Importing dsheet's CSS here (not globally) means the whole spreadsheet
 * stack — heavy JS + its Tailwind reset — only loads when a sheet is
 * actually opened, keeping the doc list and rich-text editor unaffected.
 */
import { DSheetEditor } from '@fileverse-dev/dsheet'
import '@fileverse-dev/dsheet/styles'

export default DSheetEditor
