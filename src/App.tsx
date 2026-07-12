import { Routes, Route } from 'react-router-dom'
import { DocList } from './pages/doc-list'
import { EditorPage } from './pages/editor'
import { ViewerPage } from './pages/viewer'
import '@fileverse-dev/ddoc/styles'

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<DocList />} />
      <Route path="/edit/:docId" element={<EditorPage />} />
      <Route path="/d/:reference" element={<ViewerPage />} />
    </Routes>
  )
}

export default App
