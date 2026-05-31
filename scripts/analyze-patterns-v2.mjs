import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

const LEAGUES = [
  ['eng.1','2025-2026'],
  ['esp.1','2025-2026'],
  ['ger.1','2025-2026'],
  ['ita.1','2025-2026'],
  ['fra.1','2025-2026'],
  ['swe.1','2026'],
  ['nor.1','2026'],
  ['sco.1','2025-2026'],
];

const allFindings = [];
const leagueMatchResults = [];

for (const [leagueId, season] of LEAGUES) {
  const { data: matchStats } = await sb.from('football_match_stats')
    .select('event_id, event_date, home_team_id, home_team_name, away_team_id, away_team_name')
    .eq('league_id', leagueId).eq('season', season)
    .order('event_date', { ascending: false }).limit(15);
  if (!matchStats?.length) continue;

  const eventIds = matchStats.map(m => m.event_id);

  const { data: pData } = await sb.from('football_player_match_stats')
    .select('event_id, athlete_id, athlete_name, team_id, team_name, position, starter, goals, goals_conceded, shots, shots_on_target, assists')
    .eq('league_id', leagueId).in('event_id', eventIds);
  if (!pData?.length) continue;

  // Rekonstruera matchresultat
  const matchScores = new Map();
  for (const p of pData) {
    if (!matchScores.has(p.event_id)) matchScores.set(p.event_id, new Map());
    const teamMap = matchScores.get(p.event_id);
    if (!teamMap.has(p.team_id)) teamMap.set(p.team_id, { scored: 0, conceded: 0 });
    const t = teamMap.get(p.team_id);
    t.scored += (p.goals ?? 0);
    if ((p.goals_conceded ?? 0) > t.conceded) t.conceded = p.goals_conceded;
  }

  // Spara matchresultat för listning
  const matchList = [];
  for (const m of matchStats.slice(0,10)) {
    const hScores = matchScores.get(m.event_id)?.get(m.home_team_id);
    const aScores = matchScores.get(m.event_id)?.get(m.away_team_id);
    if (!hScores || !aScores) continue;
    const hg = hScores.scored;
    const ag = aScores.scored;
    matchList.push({
      date: m.event_date?.slice(0,10) ?? '?',
      home: m.home_team_name,
      away: m.away_team_name,
      hg, ag,
      btts: hg > 0 && ag > 0,
      over25: hg + ag > 2,
    });
  }
  leagueMatchResults.push({ leagueId, season, matches: matchList });

  // Hämta top-spelare
  const { data: seasonStats } = await sb.from('football_player_season_stats')
    .select('athlete_id, athlete_name, team_id, team_name, starts, goals, assists, importance_score')
    .eq('league_id', leagueId).eq('season', season)
    .gte('starts', 4)
    .order('importance_score', { ascending: false }).limit(40);
  if (!seasonStats?.length) continue;

  for (const sp of seasonStats) {
    const withP = { matches:0, goals:[], conceded:[], wins:0, draws:0, losses:0, btts:0, over25:0 };
    const noP = { matches:0, goals:[], conceded:[], wins:0, draws:0, losses:0, btts:0, over25:0 };

    for (const m of matchStats) {
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
      const matchP = pData.find(p => p.event_id === m.event_id && p.athlete_id === sp.athlete_id);
      const started = matchP?.starter ?? null;
      if (started === null) continue;

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

    if (withP.matches < 2 || noP.matches < 1) continue;

    const goalDiff = avg(withP.goals) - avg(noP.goals);
    const winDiff = withP.wins/withP.matches - noP.wins/Math.max(noP.matches,1);
    const bttsDiff = withP.btts/withP.matches - noP.btts/Math.max(noP.matches,1);

    if (Math.abs(goalDiff) >= 0.4 || Math.abs(winDiff) >= 0.25) {
      allFindings.push({ league:leagueId, player:sp.athlete_name, team:sp.team_name,
        imp:sp.importance_score, seasonGoals:sp.goals, seasonAssists:sp.assists,
        withP, noP, goalDiff, winDiff, bttsDiff });
    }
  }
}

// ── Presentation ─────────────────────────────────────────────────────────────

allFindings.sort((a,b) => Math.abs(b.goalDiff) - Math.abs(a.goalDiff));

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' SPELARPÅVERKAN PÅ LAGETS RESULTAT (senaste ~15 matcher/liga)');
console.log('══════════════════════════════════════════════════════════════');
console.log('Format: MED spelaren | UTAN spelaren\n');

for (const f of allFindings.slice(0,30)) {
  const { withP:w, noP:n } = f;
  const sign = f.goalDiff > 0 ? '▲' : '▼';
  console.log(`${f.player} (${f.team} | ${f.league})`);
  console.log(`  Säsong: ${f.seasonGoals}g ${f.seasonAssists}a | Importance: ${f.imp?.toFixed(1)}`);
  console.log(`  MED:  ${w.matches}m | Mål ${avg(w.goals).toFixed(2)} | Konc ${avg(w.conceded).toFixed(2)} | W/D/L ${w.wins}/${w.draws}/${w.losses} | BTTS ${pct(w.btts,w.matches)} | Ö2.5 ${pct(w.over25,w.matches)}`);
  console.log(`  UTAN: ${n.matches}m | Mål ${avg(n.goals).toFixed(2)} | Konc ${avg(n.conceded).toFixed(2)} | W/D/L ${n.wins}/${n.draws}/${n.losses} | BTTS ${pct(n.btts,n.matches)} | Ö2.5 ${pct(n.over25,n.matches)}`);
  console.log(`  ${sign} Goal-diff: ${f.goalDiff.toFixed(2)} | Vinst-diff: ${(f.winDiff*100).toFixed(0)}pp | BTTS-diff: ${(f.bttsDiff*100).toFixed(0)}pp`);
  console.log();
}

// ── Per-liga sammanfattning ───────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
console.log(' BETTING-LÄRDOMAR PER LIGA');
console.log('══════════════════════════════════════════════════════════════\n');

const byLeague = new Map();
for (const f of allFindings) {
  if (!byLeague.has(f.league)) byLeague.set(f.league, []);
  byLeague.get(f.league).push(f);
}

for (const [league, findings] of byLeague) {
  const avgGD = avg(findings.map(f=>f.goalDiff));
  const avgBtts = avg(findings.map(f=>f.bttsDiff));
  const avgWin = avg(findings.map(f=>f.winDiff));
  console.log(`${league} (${findings.length} spelare med mätbar påverkan):`);
  console.log(`  Genomsnittlig mål-diff med/utan: ${avgGD.toFixed(2)}`);
  console.log(`  BTTS-diff: ${(avgBtts*100).toFixed(1)}pp | Vinst-diff: ${(avgWin*100).toFixed(0)}pp`);
  const top = findings[0];
  console.log(`  Starkaste: ${top.player} (${top.team}) goal-diff ${top.goalDiff.toFixed(2)}`);
  console.log();
}

// ── Senaste matcherna per liga ─────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
console.log(' SENASTE 10 MATCHERNA PER LIGA');
console.log('══════════════════════════════════════════════════════════════');

for (const { leagueId, season, matches } of leagueMatchResults) {
  console.log(`\n${leagueId} (${season}):`);
  for (const m of matches) {
    const btts = m.btts ? 'BTTS' : 'ej BTTS';
    const ov = m.over25 ? 'Ö2.5' : 'U2.5';
    console.log(`  ${m.date} | ${m.home} ${m.hg}-${m.ag} ${m.away} | ${btts} | ${ov}`);
  }

  // Statistik för de 10 matcherna
  const bttsCount = matches.filter(m=>m.btts).length;
  const o25Count = matches.filter(m=>m.over25).length;
  const avgGoals = avg(matches.map(m=>m.hg+m.ag));
  console.log(`  → BTTS: ${pct(bttsCount,matches.length)} | Ö2.5: ${pct(o25Count,matches.length)} | Snittmål: ${avgGoals.toFixed(2)}`);
}
