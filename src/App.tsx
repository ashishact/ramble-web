import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SettingsPageNew } from "./components/SettingsPageNew";
import { CloudflareAIGatewayTest } from "./components/CloudflareAIGatewayTest";
import { SpeechToTextTest } from "./components/SpeechToTextTest";
import { ProgramPage } from "./components/ProgramPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProgramPage />} />
        <Route path="/settings" element={<SettingsPageNew onBack={() => window.history.back()} />} />
        <Route path="/cf-gateway-test" element={<CloudflareAIGatewayTest />} />
        <Route path="/stt-test" element={<SpeechToTextTest />} />
        <Route path="/program" element={<ProgramPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
