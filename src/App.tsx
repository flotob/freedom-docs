import { Routes, Route } from 'react-router-dom'
import { DocList } from './pages/doc-list'
import { EditorPage } from './pages/editor'
import { ViewerPage } from './pages/viewer'
import { JoinPage } from './pages/join'
import '@fileverse-dev/ddoc/styles'
import '@fileverse-dev/dsheet/styles'

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
