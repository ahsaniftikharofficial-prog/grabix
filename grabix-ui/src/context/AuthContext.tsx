import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "../lib/supabase";
import { getSupabaseClient, isSupabaseConfigured, type CloudProfile } from "../lib/supabase";
import { backendJson, setCloudAccessTokenResolver } from "../lib/api";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: CloudProfile | null;
  backendReady: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(): Promise<CloudProfile | null> {
  try {
    const payload = await backendJson<{ user?: CloudProfile }>("/auth/me");
    return payload.user || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setCloudAccessTokenResolver(null);
      setLoading(false);
      return;
    }

    const applySession = async (nextSession: Session | null) => {
      if (!alive) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setCloudAccessTokenResolver(async () => nextSession?.access_token || null);
      if (nextSession?.access_token) {
        const nextProfile = await fetchProfile();
        if (!alive) return;
        setProfile(nextProfile);
      } else {
        setProfile(null);
      }
      setLoading(false);
    };

    void supabase.auth.getSession()
      .then(({ data }) => applySession(data.session ?? null))
      .catch(() => {
        if (!alive) return;
        setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    loading,
    session,
    user,
    profile,
    backendReady: Boolean(profile?.id),
    error,
    signIn: async (email: string, password: string) => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Supabase is not configured for this app.");
        return;
      }
      setError("");
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }
    },
    signUp: async (email: string, password: string) => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Supabase is not configured for this app.");
        return;
      }
      setError("");
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
        throw signUpError;
      }
    },
    signOut: async () => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      setError("");
      await supabase.auth.signOut();
      setProfile(null);
      setCloudAccessTokenResolver(null);
    },
    refreshProfile: async () => {
      setError("");
      const nextProfile = await fetchProfile();
      setProfile(nextProfile);
    },
  }), [configured, error, loading, profile, session, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
