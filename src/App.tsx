import { useRef, useCallback } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/v2/SettingsPageNew";
import { BentoApp } from "./components/BentoApp";
import { RestoreConfirmDialog } from "./components/RestoreConfirmDialog";
import { ProfileSwitcher, type ProfileSwitcherRef } from "./components/ProfileSwitcher";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";

function App() {
  const profileSwitcherRef = useRef<ProfileSwitcherRef>(null);

  const handleProfileSwitcherToggle = useCallback(() => {
    profileSwitcherRef.current?.toggle();
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
      <RestoreConfirmDialog />
      <ProfileSwitcher ref={profileSwitcherRef} />
      <KeyboardShortcuts onProfileSwitcher={handleProfileSwitcherToggle} />
    </BrowserRouter>
  );
}

export default App;
