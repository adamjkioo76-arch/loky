import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "../../config.js";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
