import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabaseAdminEnvironment } from "@/lib/env";
import type { Database } from "@/types/database";

export function createAdminClient() {
  const { url, secretKey } = getSupabaseAdminEnvironment();

  return createClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

