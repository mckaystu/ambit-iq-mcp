import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import AgentInteractionsPage from "./AgentInteractionsPage";
import AuditReportsPage from "./AuditReportsPage";
import ExecutiveDashboardPage from "./ExecutiveDashboardPage";
import IncidentsPage from "./IncidentsPage";
import ModelGovernancePage from "./ModelGovernancePage";
import PoliciesPage from "./PoliciesPage";
import ReplayPage from "./ReplayPage";
import SignalIntelligencePage from "./SignalIntelligencePage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/dashboard/executive" element={<ExecutiveDashboardPage />} />
        <Route path="/dashboard/model-governance" element={<ModelGovernancePage />} />
        <Route path="/dashboard/incidents" element={<IncidentsPage />} />
        <Route path="/dashboard/agent-interactions" element={<AgentInteractionsPage />} />
        <Route path="/dashboard/replay" element={<ReplayPage />} />
        <Route path="/dashboard/policies" element={<PoliciesPage />} />
        <Route path="/dashboard/signal-intelligence" element={<SignalIntelligencePage />} />
        <Route path="/dashboard/audit-reports" element={<AuditReportsPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
