import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/v2/SettingsPageNew";
import { BentoApp } from "./components/BentoApp";
import { RestoreConfirmDialog } from "./components/RestoreConfirmDialog";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BentoApp />} />
        <Route path="/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />
      </Routes>
      {/* Global dialogs */}
      <RestoreConfirmDialog />
    </BrowserRouter>
  );
}

export default App;
