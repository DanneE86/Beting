import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TravsportCacheReadOptions } from "./fetch-game";
import type { TravsportHorseProfile, TravsportIndex } from "./types";

const CACHE_DIR = resolve("v86", "output", "travsport-cache");
const INDEX_FILE = resolve(CACHE_DIR, "index.json");
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
let memoryIndex: TravsportIndex | null = null;

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadTravsportIndex(): TravsportIndex {
  ensureDir();
  if (memoryIndex) return memoryIndex;
  if (!existsSync(INDEX_FILE)) return {};
  try {
    memoryIndex = JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as TravsportIndex;
    return memoryIndex;
  } catch {
    memoryIndex = {};
    return {};
  }
}

export function saveHorseProfile(profile: TravsportHorseProfile) {
  ensureDir();
  const index = loadTravsportIndex();
  writeFileSync(
    resolve(CACHE_DIR, `${profile.horseId}.json`),
    JSON.stringify(profile, null, 2),
    "utf-8",
  );
  index[profile.horseId] = profile;
  memoryIndex = index;
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

function isFresh(profile: { fetchedAt: string }) {
  return Date.now() - new Date(profile.fetchedAt).getTime() <= MAX_AGE_MS;
}

export function getCachedProfile(
  horseId: number,
  options: TravsportCacheReadOptions = {},
): TravsportHorseProfile | null {
  const hit = loadTravsportIndex()[horseId];
  if (!hit) return null;
  if (!options.allowStale && !isFresh(hit)) return null;
  return hit;
}

export function getManyCachedProfiles(
  horseIds: number[],
  options: TravsportCacheReadOptions = {},
): Record<number, TravsportHorseProfile> {
  const index = loadTravsportIndex();
  return Object.fromEntries(
    horseIds.flatMap((horseId) => {
      const hit = index[horseId];
      if (!hit) return [];
      if (!options.allowStale && !isFresh(hit)) return [];
      return [[horseId, hit] as const];
    }),
  );
}

export const fileCacheBackend = {
  get: async (horseId: number, options?: TravsportCacheReadOptions) =>
    getCachedProfile(horseId, options),
  getMany: async (horseIds: number[], options?: TravsportCacheReadOptions) =>
    getManyCachedProfiles(horseIds, options),
  set: async (profile: TravsportHorseProfile) => saveHorseProfile(profile),
};
