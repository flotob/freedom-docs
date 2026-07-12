import { Routes, Route } from 'react-router-dom'
import { DocList } from './pages/doc-list'
import { EditorPage } from './pages/editor'
import { ViewerPage } from './pages/viewer'
import { JoinPage } from './pages/join'
import '@fileverse-dev/ddoc/styles'
// NOTE: dsheet's CSS is NOT imported globally — it ships a Tailwind reset
// that clobbers our app + ddoc styling. It loads lazily with the sheet
// editor chunk (see lib/sheet-editor.tsx) so docs never see it.

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<DocList />} />
      <Route path="/edit/:docId" element={<EditorPage />} />
      <Route path="/d/:reference" element={<ViewerPage />} />
      <Route path="/d/:reference/:docKey" element={<ViewerPage />} />
      <Route path="/e/:reference/:docKey" element={<JoinPage />} />
    </Routes>
  )
}

export default App
