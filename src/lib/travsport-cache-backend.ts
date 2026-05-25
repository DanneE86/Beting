import { getTravsportFromDb, saveTravsportToDb } from "@/lib/travsport-cache.server";
import { fileCacheBackend } from "../../v86/src/travsport/file-cache";
import type { FetchGameTravsportOptions } from "../../v86/src/travsport/fetch-game";

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Föredrar DB-cache när Supabase finns, men använder alltid filcache som lokal backup.
 * Då tappar vi inte historik om DB saknas lokalt eller nätverket strular.
 */
export const hybridTravsportCache: NonNullable<FetchGameTravsportOptions["dbCache"]> = {
  async get(horseId) {
    if (hasSupabaseEnv()) {
      try {
        const dbHit = await getTravsportFromDb(horseId);
        if (dbHit) return dbHit;
      } catch {
        // fallback till filcache nedan
      }
    }
    return fileCacheBackend.get(horseId);
  },
  async set(profile) {
    if (hasSupabaseEnv()) {
      try {
        await saveTravsportToDb(profile);
      } catch {
        // skriv ändå lokalt
      }
    }
    await fileCacheBackend.set(profile);
  },
};

