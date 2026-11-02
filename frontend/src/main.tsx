import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import AppShell from "@/components/AppShell";
import { Restricted } from "@/components/common";
import { Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import LoginPage from "@/features/auth/LoginPage";
import "./index.css";

const Dashboard = lazy(() => import("@/features/dashboard/DashboardPage"));
const PatientsPage = lazy(() => import("@/features/patients/PatientsPage"));
const PatientDetail = lazy(() => import("@/features/patients/PatientDetail"));
const PrescriptionsPage = lazy(() => import("@/features/prescriptions/PrescriptionsPage"));
const PrescriptionDetail = lazy(() => import("@/features/prescriptions/PrescriptionDetail"));
const TicketsPage = lazy(() => import("@/features/tickets/TicketsPage"));
const TicketDetail = lazy(() => import("@/features/tickets/TicketDetail"));
const QaPage = lazy(() => import("@/features/qa/QaPage"));
const TestCaseDetail = lazy(() => import("@/features/qa/TestCaseDetail"));
const TestRunDetail = lazy(() => import("@/features/qa/TestRunDetail"));
const BugDetail = lazy(() => import("@/features/qa/BugDetail"));
const AutomationRunDetail = lazy(() => import("@/features/qa/AutomationRunDetail"));
const ApiExplorer = lazy(() => import("@/features/api-explorer/ApiExplorerPage"));
const BugLab = lazy(() => import("@/features/bug-lab/BugLabPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Restoring your session" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

function Guard({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <Restricted />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="patients" element={<Guard permission="patients:read"><PatientsPage /></Guard>} />
        <Route path="patients/:id" element={<Guard permission="patients:read"><PatientDetail /></Guard>} />
        <Route path="prescriptions" element={<Guard permission="prescriptions:read"><PrescriptionsPage /></Guard>} />
        <Route path="prescriptions/:id" element={<Guard permission="prescriptions:read"><PrescriptionDetail /></Guard>} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="qa" element={<Guard permission="qa:read"><QaPage /></Guard>} />
        <Route path="qa/cases/:id" element={<Guard permission="qa:read"><TestCaseDetail /></Guard>} />
        <Route path="qa/runs/:id" element={<Guard permission="qa:read"><TestRunDetail /></Guard>} />
        <Route path="qa/bugs/:id" element={<Guard permission="qa:read"><BugDetail /></Guard>} />
        <Route path="qa/automation/:id" element={<Guard permission="qa:read"><AutomationRunDetail /></Guard>} />
        <Route path="api-explorer" element={<Guard permission="logs:read"><ApiExplorer /></Guard>} />
        <Route path="bug-lab" element={<Guard permission="qa:read"><BugLab /></Guard>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="card p-10 text-center"><p className="font-semibold">Page not found</p><p className="text-ink-3 text-sm mt-1">Check the address or use the navigation.</p></div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<Spinner />}>
            <App />
          </Suspense>
          <Toaster position="top-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
