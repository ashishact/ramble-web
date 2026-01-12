import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/v2/SettingsPageNew";
import { MainPage } from "./components/v2/MainPage";
import { BentoApp } from "./components/BentoApp";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BentoApp />} />
        <Route path="/v2" element={<MainPage />} />
        <Route path="/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
