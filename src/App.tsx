import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/v2/SettingsPageNew";
import { BentoApp } from "./components/BentoApp";
import { ProfileSwitcher } from "./components/ProfileSwitcher";
import { authStore } from "./stores/authStore";

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

function App() {
  // On first launch, get a server-assigned userId if we don't have one yet
  useEffect(() => {
    if (authStore.userId) return;
    fetch(`${WORKER_URL}/api/v1/identity`, {
      method: 'POST',
      headers: { 'X-Device-ID': authStore.deviceId },
    })
      .then(r => r.json())
      .then((data: any) => {
        if (data.userId) authStore.setUserId(data.userId);
      })
      .catch(err => console.warn('[App] Failed to get userId:', err));
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* Default profile routes */}
        <Route path="/" element={<BentoApp />} />
        <Route path="/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />

        {/* Profile-specific routes: /u/{profileName} */}
        <Route path="/u/:profileName" element={<BentoApp />} />
        <Route path="/u/:profileName/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />
      </Routes>
      {/* Global components */}
      <ProfileSwitcher />
    </BrowserRouter>
  );
}

export default App;
