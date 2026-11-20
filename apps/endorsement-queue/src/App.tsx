import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@x10/shared/runtime';

import { SealDefs } from './hall/Seal';
import { AboutPage } from './pages/AboutPage';
import { HallPage } from './pages/HallPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { QueuePage } from './pages/QueuePage';
import { RegisterPage } from './pages/RegisterPage';
import { RenewalsPage } from './pages/RenewalsPage';
import { RequestPage } from './pages/RequestPage';
import { SubmitPage } from './pages/SubmitPage';

export function App() {
  return (
    <>
      <SealDefs />
      <Routes>
        <Route path="/" element={<AppShell immersive><HallPage /></AppShell>} />
        <Route path="/mine" element={<AppShell><MyRequestsPage /></AppShell>} />
        <Route path="/submit" element={<AppShell wide><SubmitPage /></AppShell>} />
        <Route path="/queue" element={<AppShell wide><QueuePage /></AppShell>} />
        <Route path="/requests/:id" element={<AppShell wide><RequestPage /></AppShell>} />
        <Route path="/register" element={<AppShell wide><RegisterPage /></AppShell>} />
        <Route path="/renewals" element={<AppShell><RenewalsPage /></AppShell>} />
        <Route path="/about" element={<AppShell><AboutPage /></AppShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
