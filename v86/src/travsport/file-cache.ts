import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TravsportHorseProfile, TravsportIndex } from "./types";

const CACHE_DIR = resolve("v86", "output", "travsport-cache");
const INDEX_FILE = resolve(CACHE_DIR, "index.json");
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function loadTravsportIndex(): TravsportIndex {
  ensureDir();
  if (!existsSync(INDEX_FILE)) return {};
  try {
    return JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as TravsportIndex;
  } catch {
    return {};
  }
}

export function saveHorseProfile(profile: TravsportHorseProfile) {
  ensureDir();
  writeFileSync(
    resolve(CACHE_DIR, `${profile.horseId}.json`),
    JSON.stringify(profile, null, 2),
    "utf-8",
  );
  const index = loadTravsportIndex();
  index[profile.horseId] = profile;
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

export function getCachedProfile(horseId: number): TravsportHorseProfile | null {
  const hit = loadTravsportIndex()[horseId];
  if (!hit) return null;
  if (Date.now() - new Date(hit.fetchedAt).getTime() > MAX_AGE_MS) return null;
  return hit;
}

export const fileCacheBackend = {
  get: async (horseId: number) => getCachedProfile(horseId),
  set: async (profile: TravsportHorseProfile) => saveHorseProfile(profile),
};
