import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { UploadPage } from './components/UploadPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { EditorPage } from './pages/EditorPage';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/analysis/:videoId" element={<AnalysisPage />} />
          <Route path="/editor/:videoId" element={<EditorPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
