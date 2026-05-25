#!/usr/bin/env npx tsx
import { fetchGame } from "../src/atg-api";
import { fetchTravsportForGame } from "../src/travsport/fetch-game";
import { hybridTravsportCache } from "../../src/lib/travsport-cache-backend";

const gameId = process.argv.find((a) => a.startsWith("V85_") || a.startsWith("dd_")) ?? "V85_2026-05-30_5_5";

const game = await fetchGame(gameId);
console.log(`Hämtar Travsport för ${game.type} ${game.id}…`);
const index = await fetchTravsportForGame(game, {
  useCache: true,
  dbCache: hybridTravsportCache,
});
console.log(`Klart: ${Object.keys(index).length} hästar i cache (DB + lokal fallback)`);
