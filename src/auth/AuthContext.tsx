// Contexto de autenticação. Mantém sessão, usuário, perfil e companyId.
// Modo "demo": quando não há sessão, o app continua usando dados mock locais.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export interface Profile {
  id: string;
  company_id: string;
  display_name: string | null;
  email: string | null;
}

export interface Company {
  id: string;
  name: string;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  company: Company | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: {
    email: string;
    password: string;
    displayName: string;
    companyName: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingRef = useRef(false);

  const fetchProfile = useCallback(async (uid: string) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, company_id, display_name, email")
        .eq("id", uid)
        .maybeSingle();
      if (prof) {
        setProfile(prof);
        const { data: comp } = await supabase
          .from("companies")
          .select("id, name")
          .eq("id", prof.company_id)
          .maybeSingle();
        if (comp) setCompany(comp);
      }
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Listener PRIMEIRO, depois getSession (recomendação Supabase).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        // defer pra evitar deadlock
        setTimeout(() => fetchProfile(sess.user.id), 0);
      } else {
        setProfile(null);
        setCompany(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) fetchProfile(sess.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(
    async ({
      email,
      password,
      displayName,
      companyName,
    }: {
      email: string;
      password: string;
      displayName: string;
      companyName: string;
    }) => {
      const redirectUrl =
        typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            display_name: displayName,
            company_name: companyName,
          },
        },
      });
      if (error) throw error;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setCompany(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id);
  }, [fetchProfile, user]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user,
      profile,
      company,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [loading, session, user, profile, company, signIn, signUp, signOut, refreshProfile],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
