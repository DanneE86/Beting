import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Server-side Supabase admin — kräver SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. */
export function isSupabaseAdminConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Kör admin-query om nycklar finns; annars null (ingen throw). */
export async function withSupabaseAdmin<T>(
  fn: (client: SupabaseClient<Database>) => Promise<T>,
): Promise<T | null> {
  if (!isSupabaseAdminConfigured()) {
    console.warn(
      "[Supabase] Admin ej konfigurerad — SUPABASE_URL och/eller SUPABASE_SERVICE_ROLE_KEY saknas.",
    );
    return null;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await fn(supabaseAdmin);
  } catch (err) {
    console.error("[Supabase] Admin-query misslyckades:", err);
    return null;
  }
}
