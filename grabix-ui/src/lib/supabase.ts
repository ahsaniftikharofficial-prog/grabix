// supabase.ts — Supabase is optional. When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// are not set, all auth features are disabled and this module returns safe no-ops.
// The @supabase/supabase-js package is NOT required unless you configure those env vars.

export interface CloudProfile {
  id: string;
  email: string;
  role: string;
  email_confirmed_at?: string;
  last_sign_in_at?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

// Minimal type stubs so AuthContext compiles without the supabase package installed.
export interface User {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface Session {
  access_token: string;
  refresh_token?: string;
  user: User;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    // Dynamic require so the package is only needed when actually configured.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require("@supabase/supabase-js");
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      });
    } catch {
      console.warn("[grabix] @supabase/supabase-js is not installed. Cloud auth is disabled.");
      return null;
    }
  }
  return client;
}
