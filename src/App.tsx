import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/v2/SettingsPageNew";
import { BentoApp } from "./components/BentoApp";
import { ProfileSwitcher } from "./components/ProfileSwitcher";

function App() {
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
