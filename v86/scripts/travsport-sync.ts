#!/usr/bin/env npx tsx
import { fetchGame } from "../src/atg-api";
import { fetchTravsportForGame } from "../src/travsport/fetch-game";
import { fileCacheBackend } from "../src/travsport/file-cache";

const gameId = process.argv.find((a) => a.startsWith("V85_") || a.startsWith("dd_")) ?? "V85_2026-05-30_5_5";

const game = await fetchGame(gameId);
console.log(`Hämtar Travsport för ${game.type} ${game.id}…`);
const index = await fetchTravsportForGame(game, {
  useCache: true,
  dbCache: fileCacheBackend,
});
console.log(`Klart: ${Object.keys(index).length} hästar i cache (v86/output/travsport-cache/)`);
