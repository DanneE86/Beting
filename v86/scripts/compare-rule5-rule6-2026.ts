import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../src/atg-api";
import { buildSnapshotFromGame, sanitizeHistoricalGameForPrematch } from "../src/pipeline";
import { fileCacheBackend } from "../src/travsport/file-cache";
import type { PoolGameType, TravRuleId } from "../src/types";
import { buildSystemHitSummary, extractTravResult } from "../../src/lib/trav-learning.server";

type RuleStats = {
  gameCount: number;
  totalCostKr: number;
  totalPayoutKr: number;
  totalNetKr: number;
  roi: number;
  hitRate: number;
  fullHitRate: number;
  monthsAt10kPlus: number;
  monthCount: number;
  monthlyNet: Record<string, number>;
  over100kHits: number;
  millionHits: number;
  maxSinglePayoutKr: number;
};

type ComparisonRow = {
  gameId: string;
  gameType: PoolGameType;
  gameDate: string;
  rule5NetKr: number;
  rule6NetKr: number;
  deltaKr: number;
  rule5CostKr: number;
  rule6CostKr: number;
  rule5PayoutKr: number;
  rule6PayoutKr: number;
};

function dateRange(fromDate: string, toDate: string) {
  const out: string[] = [];
  let cursor = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return out;
}

function monthKey(dateIso: string) {
  return dateIso.slice(0, 7);
}

function parseDateOnly(value?: string | null) {
  return (value ?? "").slice(0, 10);
}

function asCsv<T extends Record<string, unknown>>(rows: T[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (value: unknown) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [cols.join(","), ...rows.map((row) => cols.map((col) => esc(row[col])).join(","))].join("\n");
}

async function evaluateRuleForGame(gameId: string, ruleId: TravRuleId) {
  const game = await fetchGame(gameId);
  const gameDate =
    parseDateOnly(game.races[0]?.date) ||
    parseDateOnly(game.races[0]?.startTime) ||
    parseDateOnly(game.races[0]?.scheduledStartTime) ||
    new Date().toISOString().slice(0, 10);
  const prematch = sanitizeHistoricalGameForPrematch(game);
  const snapshot = await buildSnapshotFromGame(prematch, {
    ruleId,
    autoBudget: true,
    includeAndelsspel: false,
    includeTravsport: true,
    travsportDbCache: fileCacheBackend,
    travsportAllowStaleCache: true,
  });
  const resolved = extractTravResult(game);
  const hit = buildSystemHitSummary(snapshot.system, resolved);
  return {
    gameType: game.type,
    gameDate,
    costKr: snapshot.system.costKr,
    payoutKr: hit.payoutAmountKr ?? 0,
    netKr: (hit.payoutAmountKr ?? 0) - snapshot.system.costKr,
    fullHit: hit.fullHit,
  };
}

function buildStats(rows: Array<{ gameDate: string; costKr: number; payoutKr: number; netKr: number; fullHit: boolean }>): RuleStats {
  const monthly = new Map<string, number>();
  rows.forEach((row) => monthly.set(monthKey(row.gameDate), (monthly.get(monthKey(row.gameDate)) ?? 0) + row.netKr));
  const totalCostKr = rows.reduce((sum, row) => sum + row.costKr, 0);
  const totalPayoutKr = rows.reduce((sum, row) => sum + row.payoutKr, 0);
  const totalNetKr = totalPayoutKr - totalCostKr;
  const monthEntries = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    gameCount: rows.length,
    totalCostKr,
    totalPayoutKr,
    totalNetKr,
    roi: totalCostKr > 0 ? totalNetKr / totalCostKr : 0,
    hitRate: rows.filter((row) => row.payoutKr > 0).length / Math.max(1, rows.length),
    fullHitRate: rows.filter((row) => row.fullHit).length / Math.max(1, rows.length),
    monthsAt10kPlus: monthEntries.filter(([, net]) => net >= 10_000).length,
    monthCount: monthEntries.length,
    monthlyNet: Object.fromEntries(monthEntries),
    over100kHits: rows.filter((row) => row.payoutKr >= 100_000).length,
    millionHits: rows.filter((row) => row.payoutKr >= 1_000_000).length,
    maxSinglePayoutKr: Math.max(0, ...rows.map((row) => row.payoutKr)),
  };
}

async function main() {
  const fromDate = "2026-01-01";
  const toDate = new Date().toISOString().slice(0, 10);
  const dates = dateRange(fromDate, toDate);
  const seen = new Set<string>();
  const gameIds: string[] = [];

  for (const date of dates) {
    const cal = await fetchCalendarDay(date).catch(() => null);
    if (!cal?.games) continue;
    for (const { entries } of listAllowedGamesFromCalendar(cal.games)) {
      for (const entry of entries) {
        if (!entry.id || seen.has(entry.id)) continue;
        seen.add(entry.id);
        gameIds.push(entry.id);
      }
    }
  }

  const comparisonRows: ComparisonRow[] = [];
  const rule5Rows: Array<{ gameDate: string; costKr: number; payoutKr: number; netKr: number; fullHit: boolean }> = [];
  const rule6Rows: Array<{ gameDate: string; costKr: number; payoutKr: number; netKr: number; fullHit: boolean }> = [];

  for (const gameId of gameIds) {
    const game = await fetchGame(gameId).catch(() => null);
    if (!game || game.status !== "results") continue;
    const gameDate =
      parseDateOnly(game.races[0]?.date) ||
      parseDateOnly(game.races[0]?.startTime) ||
      parseDateOnly(game.races[0]?.scheduledStartTime) ||
      "";
    if (!gameDate.startsWith("2026")) continue;

    const [r5, r6] = await Promise.all([evaluateRuleForGame(gameId, "rule5"), evaluateRuleForGame(gameId, "rule6")]);

    rule5Rows.push({ gameDate: r5.gameDate, costKr: r5.costKr, payoutKr: r5.payoutKr, netKr: r5.netKr, fullHit: r5.fullHit });
    rule6Rows.push({ gameDate: r6.gameDate, costKr: r6.costKr, payoutKr: r6.payoutKr, netKr: r6.netKr, fullHit: r6.fullHit });
    comparisonRows.push({
      gameId,
      gameType: r5.gameType,
      gameDate: r5.gameDate,
      rule5NetKr: r5.netKr,
      rule6NetKr: r6.netKr,
      deltaKr: r6.netKr - r5.netKr,
      rule5CostKr: r5.costKr,
      rule6CostKr: r6.costKr,
      rule5PayoutKr: r5.payoutKr,
      rule6PayoutKr: r6.payoutKr,
    });
  }

  comparisonRows.sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.gameId.localeCompare(b.gameId));
  const rule5 = buildStats(rule5Rows);
  const rule6 = buildStats(rule6Rows);

  const summary = {
    generatedAt: new Date().toISOString(),
    range: { fromDate, toDate },
    rule5,
    rule6,
    betterRuleByTotalNet: rule6.totalNetKr > rule5.totalNetKr ? "rule6" : rule5.totalNetKr > rule6.totalNetKr ? "rule5" : "equal",
    deltaNetKr: rule6.totalNetKr - rule5.totalNetKr,
    deltaMonthsAt10kPlus: rule6.monthsAt10kPlus - rule5.monthsAt10kPlus,
    deltaOver100kHits: rule6.over100kHits - rule5.over100kHits,
    deltaMillionHits: rule6.millionHits - rule5.millionHits,
  };

  const outDir = resolve("v86", "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "rule5-vs-rule6-2026.json"), JSON.stringify({ summary, comparisonRows }, null, 2), "utf-8");
  writeFileSync(resolve(outDir, "rule5-vs-rule6-2026.csv"), asCsv(comparisonRows), "utf-8");

  console.log(`Analyserade omgångar: ${comparisonRows.length}`);
  console.log(`Rule5 netto: ${Math.round(rule5.totalNetKr).toLocaleString("sv-SE")} kr`);
  console.log(`Rule6 netto: ${Math.round(rule6.totalNetKr).toLocaleString("sv-SE")} kr`);
  console.log(`Skillnad (rule6-rule5): ${Math.round(summary.deltaNetKr).toLocaleString("sv-SE")} kr`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
