import type * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LandingPage } from "./pages/public/LandingPage";
import { AuthPage } from "./pages/auth/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { useAuth } from "./contexts/AuthContext";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center bg-medical-50 text-medical-700">Loading MediChain...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/dashboard/:section" element={<Protected><DashboardPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
