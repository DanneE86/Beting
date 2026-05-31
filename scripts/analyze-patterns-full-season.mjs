/**
 * Full-säsongsanalys: spelare med/utan-start på hela säsongen
 * Fokus på de 5 stora ligorna + Allsvenskan
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rawEnv = readFileSync(resolve(__dirname, '../.env'), 'utf8');
for (const line of rawEnv.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  process.env[t.slice(0,i).trim()] = process.env[t.slice(0,i).trim()] ?? t.slice(i+1).trim();
}
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
const pct = (n,d) => d===0 ? '–' : ((n/d)*100).toFixed(1)+'%';

// De ligor vi vill djupanalysera
const LEAGUES = [
  ['eng.1','2025-2026'],
  ['esp.1','2025-2026'],
  ['ger.1','2025-2026'],
  ['ita.1','2025-2026'],
  ['fra.1','2025-2026'],
  ['swe.1','2026'],
];

for (const [leagueId, season] of LEAGUES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(` ${leagueId.toUpperCase()} (${season})`);
  console.log(`${'═'.repeat(60)}`);

  // Hämta ALLA matcher i ligan den här säsongen
  const { data: allMatches } = await sb.from('football_match_stats')
    .select('event_id, event_date, home_team_id, home_team_name, away_team_id, away_team_name')
    .eq('league_id', leagueId).eq('season', season)
    .order('event_date', { ascending: false });
  if (!allMatches?.length) { console.log('Inga matcher'); continue; }

  console.log(`Totalt ${allMatches.length} matcher i databasen`);

  // Hämta top-spelare (de 30 viktigaste)
  const { data: seasonStats } = await sb.from('football_player_season_stats')
    .select('athlete_id, athlete_name, team_id, team_name, starts, goals, assists, importance_score, appearances')
    .eq('league_id', leagueId).eq('season', season)
    .gte('starts', 8)
    .order('importance_score', { ascending: false }).limit(30);
  if (!seasonStats?.length) { console.log('Inga säsongsstats'); continue; }

  // Hämta spelarposter för ALLA matcher (pagination i batcher om 1000)
  const allPlayerStats = [];
  const allEventIds = allMatches.map(m => m.event_id);

  // Batcha event_ids i grupper om 100
  for (let i = 0; i < allEventIds.length; i += 100) {
    const batch = allEventIds.slice(i, i+100);
    const { data: batchData } = await sb.from('football_player_match_stats')
      .select('event_id, athlete_id, team_id, starter, goals, goals_conceded')
      .eq('league_id', leagueId).in('event_id', batch);
    if (batchData) allPlayerStats.push(...batchData);
  }
  console.log(`${allPlayerStats.length} spelarstatsposter hämtade`);

  // Rekonstruera scores: event_id -> teamId -> { scored, conceded }
  const matchScores = new Map();
  for (const p of allPlayerStats) {
    if (!matchScores.has(p.event_id)) matchScores.set(p.event_id, new Map());
    const tm = matchScores.get(p.event_id);
    if (!tm.has(p.team_id)) tm.set(p.team_id, { scored: 0, conceded: 0 });
    const t = tm.get(p.team_id);
    t.scored += (p.goals ?? 0);
    if ((p.goals_conceded ?? 0) > t.conceded) t.conceded = p.goals_conceded;
  }

  // Bygg lookup: event_id -> athlete_id -> starter
  const starterLookup = new Map();
  for (const p of allPlayerStats) {
    const key = `${p.event_id}::${p.athlete_id}`;
    starterLookup.set(key, p.starter);
  }

  // Analysera varje nyckelspelare
  const findings = [];
  for (const sp of seasonStats) {
    const withP = { matches:0, goals:[], conceded:[], wins:0, draws:0, losses:0, btts:0, over25:0 };
    const noP = { matches:0, goals:[], conceded:[], wins:0, draws:0, losses:0, btts:0, over25:0 };

    for (const m of allMatches) {
      const isHome = m.home_team_id === sp.team_id;
      const isAway = m.away_team_id === sp.team_id;
      if (!isHome && !isAway) continue;

      const teamScores = matchScores.get(m.event_id)?.get(sp.team_id);
      if (!teamScores) continue;
      const oppId = isHome ? m.away_team_id : m.home_team_id;
      const oppScores = matchScores.get(m.event_id)?.get(oppId);
      if (!oppScores) continue;

      const scored = teamScores.scored;
      const conceded = oppScores.scored;
      const started = starterLookup.get(`${m.event_id}::${sp.athlete_id}`);
      if (started === undefined) continue;

      const target = started ? withP : noP;
      target.matches++;
      target.goals.push(scored);
      target.conceded.push(conceded);
      if (scored > 0 && conceded > 0) target.btts++;
      if (scored + conceded > 2) target.over25++;
      const res = scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
      if (res==='W') target.wins++;
      else if (res==='D') target.draws++;
      else target.losses++;
    }

    if (withP.matches < 3) continue; // Behöver minimum 3 matcher med spelaren

    const goalDiff = avg(withP.goals) - avg(noP.goals);
    const winDiff = withP.wins/withP.matches - (noP.matches > 0 ? noP.wins/noP.matches : 0);
    const bttsDiff = withP.btts/withP.matches - (noP.matches > 0 ? noP.btts/noP.matches : 0);

    findings.push({
      player: sp.athlete_name,
      team: sp.team_name,
      imp: sp.importance_score,
      sg: sp.goals, sa: sp.assists, starts: sp.starts,
      withP, noP, goalDiff, winDiff, bttsDiff
    });
  }

  // Sortera efter goal-diff
  findings.sort((a,b) => Math.abs(b.goalDiff) - Math.abs(a.goalDiff));

  // Skriv ut de 15 mest intressanta
  console.log('\n── TOPP-SPELARE MED MÄTBAR IMPACT ──────────────────────────\n');
  for (const f of findings.slice(0, 15)) {
    const { withP:w, noP:n } = f;
    if (n.matches === 0) {
      // Spelaren har alltid startat - skriv ändå ut som referens
      console.log(`${f.player} (${f.team}) ${f.sg}g ${f.sa}a imp:${f.imp?.toFixed(0)} | Alltid start: ${w.matches}m Mål ${avg(w.goals).toFixed(2)} W/D/L ${w.wins}/${w.draws}/${w.losses} BTTS ${pct(w.btts,w.matches)} Ö2.5 ${pct(w.over25,w.matches)}`);
    } else {
      const sign = f.goalDiff >= 0 ? '▲' : '▼';
      console.log(`${f.player} (${f.team}) ${f.sg}g ${f.sa}a imp:${f.imp?.toFixed(0)}`);
      console.log(`  MED  [${w.matches}m]: Mål ${avg(w.goals).toFixed(2)} | Konc ${avg(w.conceded).toFixed(2)} | W/D/L ${w.wins}/${w.draws}/${w.losses} | BTTS ${pct(w.btts,w.matches)} | Ö2.5 ${pct(w.over25,w.matches)}`);
      console.log(`  UTAN [${n.matches}m]: Mål ${avg(n.goals).toFixed(2)} | Konc ${avg(n.conceded).toFixed(2)} | W/D/L ${n.wins}/${n.draws}/${n.losses} | BTTS ${pct(n.btts,n.matches)} | Ö2.5 ${pct(n.over25,n.matches)}`);
      console.log(`  ${sign} Mål-diff: ${f.goalDiff.toFixed(2)} | Vinst-diff: ${(f.winDiff*100).toFixed(0)}pp | BTTS-diff: ${(f.bttsDiff*100).toFixed(0)}pp`);
    }
    console.log();
  }

  // Liga-aggregat
  const withData = findings.filter(f => f.noP.matches >= 2);
  if (withData.length > 0) {
    const avgGD = avg(withData.map(f=>f.goalDiff));
    const avgBD = avg(withData.map(f=>f.bttsDiff));
    const avgWD = avg(withData.map(f=>f.winDiff));
    console.log(`── LIGA-AGGREGAT (${withData.length} spelare med min 2 matcher utan start) ──`);
    console.log(`  Genomsnittlig goal-drop utan nyckelspelaren: ${avgGD.toFixed(2)} mål/match`);
    console.log(`  Genomsnittlig BTTS-drop: ${(avgBD*100).toFixed(1)}pp`);
    console.log(`  Genomsnittlig vinstsannolikhet-drop: ${(avgWD*100).toFixed(0)}pp`);
  }

  // Liga-övergripande mål-statistik (hela säsongen)
  let totalBtts = 0, totalOver25 = 0, totalGoals = 0, matchCount = 0;
  for (const m of allMatches) {
    const hId = m.home_team_id;
    const aId = m.away_team_id;
    const ht = matchScores.get(m.event_id)?.get(hId);
    const at = matchScores.get(m.event_id)?.get(aId);
    if (!ht || !at) continue;
    const hg = ht.scored, ag = at.scored;
    totalGoals += hg + ag;
    if (hg > 0 && ag > 0) totalBtts++;
    if (hg + ag > 2) totalOver25++;
    matchCount++;
  }
  console.log(`\n── LIGASTATISTIK HELA SÄSONGEN (${matchCount} matcher) ──`);
  console.log(`  BTTS-rate: ${pct(totalBtts, matchCount)}`);
  console.log(`  Ö2.5-rate: ${pct(totalOver25, matchCount)}`);
  console.log(`  Snittmål per match: ${(totalGoals/matchCount).toFixed(2)}`);
}
