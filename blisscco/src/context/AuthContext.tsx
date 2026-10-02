import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthError, Session } from '@supabase/supabase-js';
import { forgetPushOnThisDevice } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { Lang } from '../i18n';

export type Role = 'customer' | 'owner' | 'admin';
export interface Profile { id: string; role: Role; full_name: string | null; language: Lang; is_suspended: boolean; phone_verified: boolean }

interface SignUpArgs { email: string; password: string; fullName: string; role: 'customer' | 'owner'; language: Lang }
interface AuthCtx {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (a: SignUpArgs) => Promise<{ error: AuthError | null; needsVerification: boolean; alreadyRegistered: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (password: string) => Promise<{ error: AuthError | null }>;
  updateLanguage: (lang: Lang) => Promise<void>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [profileUid, setProfileUid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (alive) setSession(data.session); })
      .catch(() => { /* offline or misconfigured: treat as signed out */ })
      .finally(() => { if (alive) setInitialized(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) { setProfile(null); setProfileUid(null); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const uid = session?.user.id ?? null;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    supabase.from('profiles').select('id, role, full_name, language, is_suspended, phone_verified').eq('id', uid).maybeSingle()
      .then(({ data }) => { if (alive) { setProfile((data as Profile | null) ?? null); setProfileUid(uid); } })
      .then(undefined, () => { if (alive) setProfileUid(uid); });
    return () => { alive = false; };
  }, [uid]);

  const loading = !initialized || (uid !== null && profileUid !== uid);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUp = useCallback(async (a: SignUpArgs) => {
    const { data, error } = await supabase.auth.signUp({
      email: a.email,
      password: a.password,
      options: {
        data: { signup_role: a.role, full_name: a.fullName, language: a.language },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    return {
      error,
      needsVerification: !error && !data.session,
      alreadyRegistered: !error && (data.user?.identities?.length ?? 1) === 0,
    };
  }, []);

  const signOut = useCallback(async () => {
    await forgetPushOnThisDevice();                          // this phone stops receiving the account's push before the session ends
    await supabase.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    return { error };
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  }, []);

  const updateLanguage = useCallback(async (language: Lang) => {
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ language }).eq('id', uid);
    if (!error) setProfile((p) => (p ? { ...p, language } : p));
  }, [uid]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });
    return { error };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('id, role, full_name, language, is_suspended, phone_verified').eq('id', uid).maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }, [uid]);

  const value = useMemo(
    () => ({ session, profile, loading, signIn, signUp, signOut, requestPasswordReset, updatePassword, updateLanguage, signInWithGoogle, refreshProfile }),
    [session, profile, loading, signIn, signUp, signOut, requestPasswordReset, updatePassword, updateLanguage, signInWithGoogle, refreshProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
