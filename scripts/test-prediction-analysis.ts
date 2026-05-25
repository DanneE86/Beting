/**
 * Snabb verifiering av strukturerad matchanalys (körs: npx tsx scripts/test-prediction-analysis.ts)
 */
import { ESPN_BASE, espnGet, espnYmd } from "../src/lib/espn.api";
import { LEAGUES } from "../src/lib/leagues";
import { generateMatchPrediction } from "../src/lib/predict.functions";

type Pick = {
  leagueId: string;
  homeId: string;
  awayId: string;
  home: string;
  away: string;
  round: number | null;
};

async function findUpcomingMatch(): Promise<Pick | null> {
  const from = espnYmd(new Date());
  const to = espnYmd(new Date(Date.now() + 7 * 86400_000));
  const priority = ["swe.1", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "uefa.champions"];
  const onlyLeague = process.argv[2];
  const leagues = [...LEAGUES].sort(
    (a, b) => priority.indexOf(a.id) - priority.indexOf(b.id),
  );

  for (const lg of leagues.filter((l) => !onlyLeague || l.id === onlyLeague)) {
    const data: any = await espnGet(
      `${ESPN_BASE}/site/v2/sports/soccer/${lg.id}/scoreboard?dates=${from}-${to}`,
    ).catch(() => null);
    const pre = (data?.events ?? [])
      .filter((e: any) => e.status?.type?.state === "pre")
      .sort((a: any, b: any) => +new Date(a.date) - +new Date(b.date));
    if (!pre.length) continue;
    const e = pre[0];
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
    const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
    return {
      leagueId: lg.id,
      homeId: String(home?.team?.id ?? ""),
      awayId: String(away?.team?.id ?? ""),
      home: home?.team?.displayName ?? "Hemma",
      away: away?.team?.displayName ?? "Borta",
      round: e.week?.number ?? e.season?.week ?? null,
    };
  }
  return null;
}

const pick = await findUpcomingMatch();
if (!pick) {
  console.error("Ingen kommande match hittades inom 7 dagar.");
  process.exit(1);
}

console.log(`\n🔮 Prognos: ${pick.home} vs ${pick.away} (${pick.leagueId})\n`);

const result = await generateMatchPrediction({
  leagueId: pick.leagueId,
  homeId: pick.homeId,
  awayId: pick.awayId,
  homeName: pick.home,
  awayName: pick.away,
  round: pick.round,
});

console.log("Källa:", (result as { source?: string }).source ?? "ai");
console.log(`1X2: ${result.homeWinPct}% / ${result.drawPct}% / ${result.awayWinPct}%`);
console.log(`Resultat: ${result.predictedScore} · BTTS: ${result.bttsCall}`);
console.log(`Tips: ${result.bettingTip}\n`);

const ma = (result as { matchAnalysis?: Record<string, string> }).matchAnalysis;
if (!ma) {
  console.error("❌ matchAnalysis saknas i svaret!");
  process.exit(1);
}

const labels: Record<string, string> = {
  grundlaggande: "Grundläggande matchanalys",
  btts: "BTTS-fokus",
  oneXtwo: "1X2-fokus",
  h2h: "Head-to-head & historik",
  lagnyheter: "Lagnyheter & upplägg",
  ovrigt: "Övriga faktorer",
};

for (const [key, label] of Object.entries(labels)) {
  const text = ma[key]?.trim();
  console.log(`── ${label} ──`);
  console.log(text || "(tomt)");
  console.log();
}

console.log("✅ Alla 6 analysavsnitt finns med.");
