import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/SettingsPageNew";
import { MainPage } from "./components/MainPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainPage />} />
        <Route path="/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
