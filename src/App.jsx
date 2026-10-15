import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.jsx";
import { AuthPage } from "./components/AuthPage.jsx";
import { ConsoleShell } from "./components/ConsoleShell.jsx";
import { LandingPage } from "./components/LandingPage.jsx";
import { fallbackConfig, loadRuntimeConfig } from "./config.js";

export function App() {
  const [config, setConfig] = useState(fallbackConfig);
  const { user, loading, logout, updateUser } = useAuth();

  useEffect(() => {
    loadRuntimeConfig().then(setConfig);
  }, []);

  if (loading) {
    return <div className="app-boot">正在进入同道…</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage config={config} user={user} onLogout={logout} onUserUpdate={updateUser} />} />
      <Route path="/login" element={user ? <Navigate to="/console" replace /> : <AuthPage config={config} mode="login" />} />
      <Route path="/register" element={user ? <Navigate to="/console" replace /> : <AuthPage config={config} mode="register" />} />
      <Route
        path="/console"
        element={user ? <Navigate to="/console/create" replace /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/console/*"
        element={user
          ? <ConsoleShell config={config} user={user} onLogout={logout} onUserUpdate={updateUser} />
          : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
