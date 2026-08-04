import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, unwrap } from "../api/client";
import type { Role } from "../types";

export type SystemConfig = {
  appName: string;
  environment: "development" | "test" | "production";
  demoMode: boolean;
  demoAccounts: Array<{ role: Role; email: string; password: string }>;
  blockchain: {
    configured: boolean;
    networkName: string;
    chainId: number | null;
    rpcUrl: string | null;
    explorerUrl: string | null;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  access: {
    categories: string[];
    roleCategories: Partial<Record<Role, string[]>>;
    maxDurationHours: number;
  };
  uploads: { maxBytes: number; storage: string };
};

type SystemConfigContextValue = { config: SystemConfig | null; loading: boolean; error: string };
const SystemConfigContext = createContext<SystemConfigContextValue | null>(null);

export function SystemConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void unwrap<SystemConfig>(api.get("/config"))
      .then(setConfig)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "System configuration could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({ config, loading, error }), [config, loading, error]);
  return <SystemConfigContext.Provider value={value}>{children}</SystemConfigContext.Provider>;
}

export function useSystemConfig() {
  const value = useContext(SystemConfigContext);
  if (!value) throw new Error("useSystemConfig must be used inside SystemConfigProvider");
  return value;
}
