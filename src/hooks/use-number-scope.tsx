"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface ScopeNumber {
  id: string;
  label: string | null;
  connection_state: string;
}

interface NumberScopeValue {
  /** 'all' or a whatsapp_config id. */
  scope: string;
  setScope: (s: string) => void;
  /** The connected numbers on the account (for the selector). */
  numbers: ScopeNumber[];
  /** The selected config id, or null when scope is 'all'. */
  configId: string | null;
  loading: boolean;
}

const Ctx = createContext<NumberScopeValue | null>(null);
const STORAGE_KEY = "wacrm.numberScope";

/**
 * Account-wide "which WhatsApp number am I looking at / acting as" scope.
 * An account can link several numbers (each an Evolution instance); this
 * lets the user view/act on one number or all of them, so the app never
 * silently guesses a default. Persisted per browser.
 */
export function NumberScopeProvider({ children }: { children: React.ReactNode }) {
  const { accountId } = useAuth();
  const [numbers, setNumbers] = useState<ScopeNumber[]>([]);
  const [scope, setScopeState] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  // Restore the saved scope after mount (an effect, not a lazy initializer,
  // to avoid an SSR/client hydration mismatch on the persisted value).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setScopeState(saved);
  }, []);

  const setScope = useCallback((s: string) => {
    setScopeState(s);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, s);
  }, []);

  // Load the account's linked numbers (direct query — fast, no provider call).
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let active = true;
    void supabase
      .from("whatsapp_config")
      .select("id, label, connection_state")
      .eq("account_id", accountId)
      .not("instance_name", "is", null)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        const nums = (data ?? []) as ScopeNumber[];
        setNumbers(nums);
        // If the saved scope points at a number that's gone, fall back to all.
        setScopeState((cur) =>
          cur !== "all" && !nums.some((n) => n.id === cur) ? "all" : cur,
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const value = useMemo<NumberScopeValue>(
    () => ({
      scope,
      setScope,
      numbers,
      configId: scope === "all" ? null : scope,
      loading,
    }),
    [scope, setScope, numbers, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNumberScope(): NumberScopeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNumberScope must be used within NumberScopeProvider");
  return v;
}
