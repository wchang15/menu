import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function buildMissingEnvError() {
  return new Error('Supabase environment variables are missing.');
}

function isNonEmptyEnv(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== 'undefined' && trimmed !== 'null';
}

function isValidSupabaseUrl(value) {
  if (!isNonEmptyEnv(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const stubAuth = {
  getSession: async () => ({ data: { session: null }, error: buildMissingEnvError() }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  signOut: async () => ({ error: buildMissingEnvError() }),
  signInWithPassword: async () => ({ data: null, error: buildMissingEnvError() }),
  updateUser: async () => ({ data: null, error: buildMissingEnvError() }),
  signInWithOtp: async () => ({ data: null, error: buildMissingEnvError() }),
  verifyOtp: async () => ({ data: null, error: buildMissingEnvError() }),
  resetPasswordForEmail: async () => ({ data: null, error: buildMissingEnvError() }),
  setSession: async () => ({ data: null, error: buildMissingEnvError() }),
};

const hasValidConfig = isValidSupabaseUrl(supabaseUrl) && isNonEmptyEnv(supabaseAnonKey);

export const supabase = hasValidConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : {
      auth: stubAuth,
    };