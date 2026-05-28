import {
  getTravsportFromDb,
  getTravsportManyFromDb,
  saveTravsportToDb,
} from "@/lib/travsport-cache.server";
import { fileCacheBackend } from "../../v86/src/travsport/file-cache";
import type { FetchGameTravsportOptions } from "../../v86/src/travsport/fetch-game";
import type { TravsportHorseProfile } from "../../v86/src/travsport/types";

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const memoryCache = new Map<number, TravsportHorseProfile>();

/**
 * Föredrar DB-cache när Supabase finns, men använder alltid filcache som lokal backup.
 * Då tappar vi inte historik om DB saknas lokalt eller nätverket strular.
 */
export const hybridTravsportCache: NonNullable<FetchGameTravsportOptions["dbCache"]> = {
  async get(horseId, options) {
    const memHit = memoryCache.get(horseId);
    if (memHit) return memHit;

    if (hasSupabaseEnv()) {
      try {
        const dbHit = await getTravsportFromDb(horseId);
        if (dbHit) {
          memoryCache.set(horseId, dbHit);
          return dbHit;
        }
      } catch {
        // fallback till filcache nedan
      }
    }
    const fileHit = await fileCacheBackend.get(horseId, options);
    if (fileHit) memoryCache.set(horseId, fileHit);
    return fileHit;
  },
  async getMany(horseIds, options) {
    const result: Record<number, TravsportHorseProfile> = {};
    const missing = new Set<number>();

    for (const horseId of horseIds) {
      const memHit = memoryCache.get(horseId);
      if (memHit) {
        result[horseId] = memHit;
      } else {
        missing.add(horseId);
      }
    }

    if (missing.size > 0 && hasSupabaseEnv()) {
      try {
        const dbHits = await getTravsportManyFromDb([...missing]);
        for (const [horseIdText, profile] of Object.entries(dbHits)) {
          const horseId = Number(horseIdText);
          result[horseId] = profile;
          memoryCache.set(horseId, profile);
          missing.delete(horseId);
        }
      } catch {
        // fallback till filcache nedan
      }
    }

    if (missing.size > 0) {
      const fileHits = await fileCacheBackend.getMany?.([...missing], options);
      for (const [horseIdText, profile] of Object.entries(fileHits ?? {})) {
        const horseId = Number(horseIdText);
        result[horseId] = profile;
        memoryCache.set(horseId, profile);
      }
    }

    return result;
  },
  async set(profile) {
    memoryCache.set(profile.horseId, profile);
    if (hasSupabaseEnv()) {
      try {
        await saveTravsportToDb(profile);
      } catch {
        // skriv ändå lokalt
      }
    }
    try {
      await fileCacheBackend.set(profile);
    } catch {
      // Cloudflare Workers har read-only filsystem — minnescache räcker.
    }
  },
};

