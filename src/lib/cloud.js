// Supabase client. Without the two VITE_ variables the app runs as a browser-only demo with a role picker.
// With them, people sign in with Supabase Auth and row-level security decides what each of them can read and write.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloud = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'governai.auth' } })
  : null;
