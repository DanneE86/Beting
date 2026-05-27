import type { AtgGame } from "../types";
import { fetchHorseResultsRaw } from "./api";
import { buildHorseProfile, hydrateHorseProfile, trackNameToCode } from "./parse";
import type { TravsportHorseProfile, TravsportIndex } from "./types";

const CONCURRENCY = 6;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type TravsportCacheBackend = {
  get: (
    horseId: number,
    options?: TravsportCacheReadOptions,
  ) => Promise<TravsportHorseProfile | null>;
  getMany?: (
    horseIds: number[],
    options?: TravsportCacheReadOptions,
  ) => Promise<Record<number, TravsportHorseProfile>>;
  set: (profile: TravsportHorseProfile) => Promise<void>;
};

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

function isFresh(profile: { fetchedAt: string }): boolean {
  return Date.now() - new Date(profile.fetchedAt).getTime() <= MAX_AGE_MS;
}

export type TravsportCacheReadOptions = {
  allowStale?: boolean;
};

export interface FetchGameTravsportOptions {
  useCache?: boolean;
  trackName?: string;
  dbCache?: TravsportCacheBackend;
  allowStaleCache?: boolean;
}

export async function fetchTravsportForGame(
  game: AtgGame,
  options: FetchGameTravsportOptions = {},
): Promise<TravsportIndex> {
  const useCache = options.useCache !== false;
  const allowStaleCache = options.allowStaleCache === true;
  const index: TravsportIndex = {};
  const db = options.dbCache;

  const tasks: { horseId: number; driverId?: number; trackCode?: string }[] = [];

  for (const race of game.races) {
    const trackCode = trackNameToCode(race.track?.name ?? options.trackName);
    for (const start of race.starts ?? []) {
      if (start.scratched || !start.horse?.id) continue;
      tasks.push({
        horseId: start.horse.id,
        driverId: start.driver?.id,
        trackCode,
      });
    }
  }

  const unique = new Map<number, (typeof tasks)[0]>();
  for (const t of tasks) unique.set(t.horseId, t);

  const cachedProfiles = useCache && db ? await loadCachedProfiles([...unique.keys()], db) : {};

  await mapPool([...unique.values()], CONCURRENCY, async (task) => {
    const cachedProfile = cachedProfiles[task.horseId] ?? null;
    if (cachedProfile && (allowStaleCache || isFresh(cachedProfile))) {
      index[task.horseId] = hydrateHorseProfile(cachedProfile);
      return;
    }

    try {
      const raw = await fetchHorseResultsRaw(task.horseId);
      const profile = buildHorseProfile(task.horseId, raw, {
        trackCode: task.trackCode,
        driverId: task.driverId,
      });
      index[task.horseId] = profile;
      cachedProfiles[task.horseId] = profile;
      if (db) await db.set(profile);
    } catch (e) {
      if (cachedProfile) {
        index[task.horseId] = hydrateHorseProfile(cachedProfile);
        console.warn(`Travsport häst ${task.horseId}: använder cache efter fetch-fel`);
        return;
      }
      console.warn(`Travsport häst ${task.horseId}:`, e);
    }
  });

  return index;
}

async function loadCachedProfiles(
  horseIds: number[],
  db: TravsportCacheBackend,
): Promise<Record<number, TravsportHorseProfile>> {
  if (horseIds.length === 0) return {};
  if (db.getMany) {
    return db.getMany(horseIds, { allowStale: true });
  }

  const entries = await Promise.all(
    horseIds.map(async (horseId) => {
      const profile = await db.get(horseId, { allowStale: true });
      return profile ? ([horseId, profile] as const) : null;
    }),
  );

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [number, TravsportHorseProfile] => entry != null),
  );
}
