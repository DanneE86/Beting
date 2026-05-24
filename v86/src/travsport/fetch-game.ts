import type { AtgGame } from "../types";
import { fetchHorseResultsRaw } from "./api";
import { buildHorseProfile, trackNameToCode } from "./parse";
import type { TravsportHorseProfile, TravsportIndex } from "./types";

const CONCURRENCY = 6;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type TravsportCacheBackend = {
  get: (horseId: number) => Promise<TravsportHorseProfile | null>;
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

export interface FetchGameTravsportOptions {
  useCache?: boolean;
  trackName?: string;
  dbCache?: TravsportCacheBackend;
}

export async function fetchTravsportForGame(
  game: AtgGame,
  options: FetchGameTravsportOptions = {},
): Promise<TravsportIndex> {
  const useCache = options.useCache !== false;
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

  await mapPool([...unique.values()], CONCURRENCY, async (task) => {
    if (useCache && db) {
      const cached = await db.get(task.horseId);
      if (cached && isFresh(cached)) {
        index[task.horseId] = cached;
        return;
      }
    }

    try {
      const raw = await fetchHorseResultsRaw(task.horseId);
      const profile = buildHorseProfile(task.horseId, raw, {
        trackCode: task.trackCode,
        driverId: task.driverId,
      });
      index[task.horseId] = profile;
      if (db) await db.set(profile);
    } catch (e) {
      console.warn(`Travsport häst ${task.horseId}:`, e);
    }
  });

  return index;
}
