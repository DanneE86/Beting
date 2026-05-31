/**
 * Fotbollsanalys + Stryktipset — localhost:8080
 * Flikar: Alla dagens ligor + Stryktipset med garderingssystem
 *
 *   npx tsx scripts/stryktips-server.ts
 */
import { createServer } from "http";
import { loadEnv, createScriptSupabase, sleep } from "../src/lib/script-env";
import { getTeamStats, getPlayerStats, getSeasonContext } from "../src/lib/football-stats-query";
import { LEAGUES } from "../src/lib/leagues";

loadEnv();
const sb = createScriptSupabase();

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");

// ─── Stryktipset-definition (fasta 13 matcher) ────────────────────────────────

type StryktipsPick = { nr: number; pick: string; type: "spik" | "halvg" | "helg"; skrall?: string };

const STRYK_MATCHES = [
  { nr:1,  home:"Paris Saint-Germain", homeId:"160",  away:"Arsenal",        awayId:"359",  coupon:{h:47,x:26,a:27}, time:"18:00", league:"UCL-final" },
  { nr:2,  home:"Öster",               homeId:null,   away:"Norrby",         awayId:null,   coupon:{h:52,x:27,a:21}, time:"17:00", league:"Superettan" },
  { nr:3,  home:"Molde",               homeId:"2715", away:"Sandefjord",     awayId:"3279", coupon:{h:63,x:18,a:19}, time:"16:00", league:"Eliteserien" },
  { nr:4,  home:"IF Gnistan",          homeId:null,   away:"SJK",            awayId:null,   coupon:{h:42,x:26,a:32}, time:"16:00", league:"Veikkausliiga" },
  { nr:5,  home:"Lahti",               homeId:null,   away:"Ilves",          awayId:null,   coupon:{h:40,x:30,a:30}, time:"16:00", league:"Veikkausliiga" },
  { nr:6,  home:"KuPS",                homeId:null,   away:"Inter Åbo",      awayId:null,   coupon:{h:44,x:26,a:30}, time:"16:00", league:"Veikkausliiga" },
  { nr:7,  home:"TPS",                 homeId:null,   away:"VPS",            awayId:null,   coupon:{h:38,x:28,a:33}, time:"16:00", league:"Veikkausliiga" },
  { nr:8,  home:"Trollhättan",         homeId:null,   away:"Åtvidaberg",     awayId:null,   coupon:{h:37,x:27,a:36}, time:"16:00", league:"Superettan" },
  { nr:9,  home:"AFC Malmö",           homeId:null,   away:"Laholm",         awayId:null,   coupon:{h:70,x:15,a:15}, time:"16:00", league:"Superettan" },
  { nr:10, home:"Tvååker",             homeId:null,   away:"Kristianstad",   awayId:null,   coupon:{h:54,x:25,a:21}, time:"16:00", league:"Superettan" },
  { nr:11, home:"IF Karlstad",         homeId:null,   away:"Sollentuna",     awayId:null,   coupon:{h:67,x:18,a:15}, time:"16:00", league:"Superettan" },
  { nr:12, home:"Flamengo",            homeId:"819",  away:"Coritiba",       awayId:"3456", coupon:{h:62,x:21,a:17}, time:"21:00", league:"Brasileirao" },
  { nr:13, home:"Athletico-PR",        homeId:"3458", away:"Mirassol",       awayId:"9169", coupon:{h:57,x:25,a:17}, time:"21:00", league:"Brasileirao" },
];

const SYS4: StryktipsPick[] = [
  { nr:1,  pick:"1X",  type:"halvg" }, { nr:2,  pick:"12",  type:"halvg", skrall:"2" },
  { nr:3,  pick:"1X",  type:"halvg" }, { nr:4,  pick:"X2",  type:"halvg" },
  { nr:5,  pick:"1X2", type:"helg"  }, { nr:6,  pick:"1X",  type:"halvg" },
  { nr:7,  pick:"X2",  type:"halvg" }, { nr:8,  pick:"1X2", type:"helg"  },
  { nr:9,  pick:"1",   type:"spik"  }, { nr:10, pick:"12",  type:"halvg", skrall:"2" },
  { nr:11, pick:"1",   type:"spik"  }, { nr:12, pick:"1",   type:"spik"  },
  { nr:13, pick:"1",   type:"spik"  },
];
const SYS5: StryktipsPick[] = [
  { nr:1,  pick:"1X",  type:"halvg" }, { nr:2,  pick:"12",  type:"halvg", skrall:"2" },
  { nr:3,  pick:"1",   type:"spik"  }, { nr:4,  pick:"X2",  type:"halvg" },
  { nr:5,  pick:"1X2", type:"helg"  }, { nr:6,  pick:"1X",  type:"halvg" },
  { nr:7,  pick:"X2",  type:"halvg" }, { nr:8,  pick:"1X2", type:"helg"  },
  { nr:9,  pick:"1",   type:"spik"  }, { nr:10, pick:"12",  type:"halvg", skrall:"2" },
  { nr:11, pick:"1",   type:"spik"  }, { nr:12, pick:"1",   type:"spik"  },
  { nr:13, pick:"1",   type:"spik"  },
];

// ─── Poisson ──────────────────────────────────────────────────────────────────

function poisson(l: number, k: number) { let p = Math.exp(-l); for (let i = 0; i < k; i++) p *= l / (i + 1); return p; }
function poisson1x2(hL: number, aL: number) {
  let h = 0, x = 0, a = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = poisson(hL, i) * poisson(aL, j);
    if (i > j) h += p; else if (i === j) x += p; else a += p;
  }
  return { h: Math.round(h * 100), x: Math.round(x * 100), a: Math.round(a * 100) };
}
function bttsPct(hL: number, aL: number) {
  return Math.round((1 - Math.exp(-hL)) * (1 - Math.exp(-aL)) * 100);
}

// ─── Data-typer ───────────────────────────────────────────────────────────────

type EspnMatch = {
  eventId: string; home: string; homeId: string;
  away: string; awayId: string; time: string; status: string;
  homeScore?: number; awayScore?: number;
};

type TeamStat = {
  possession: number | null; passes: number | null;
  yellow: number | null; shots: number | null;
  players: Array<{ name: string; goals: number; assists: number }>;
};

type FormData = { results: Array<"W"|"D"|"L">; avgGF: number; avgGA: number; bttsRate: number };

type MatchAnalysis = {
  home: string; homeId: string; away: string; awayId: string;
  time: string; status: string; homeScore?: number; awayScore?: number;
  model: { h: number; x: number; a: number };
  market?: { h: number; x: number; a: number };
  btts: number;
  tip1x2: string; tipBtts: "JA" | "NEJ";
  confidence: "HÖG" | "MEDEL" | "LÅG";
  value: string | null;
  hStat: TeamStat | null; aStat: TeamStat | null;
  hForm: FormData | null; aForm: FormData | null;
  hL: number; aL: number;
  reasoning: string[];
  hasData: boolean;
};

// ─── ESPN-hämtning ────────────────────────────────────────────────────────────

async function fetchTodayMatches(leagueId: string): Promise<EspnMatch[]> {
  const url = `${ESPN_BASE}/${leagueId}/scoreboard?dates=${TODAY}-${TODAY}&limit=30`;
  try {
    const d: any = await fetch(url, { headers: { Accept: "application/json" } }).then(r => r.json());
    return (d.events ?? []).map((e: any) => {
      const c = e.competitions?.[0];
      const h = c?.competitors?.find((x: any) => x.homeAway === "home");
      const a = c?.competitors?.find((x: any) => x.homeAway === "away");
      const state = e.status?.type?.state ?? "pre";
      return {
        eventId: String(e.id),
        home: h?.team?.displayName ?? "", homeId: String(h?.team?.id ?? ""),
        away: a?.team?.displayName ?? "", awayId: String(a?.team?.id ?? ""),
        time: new Date(e.date).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }),
        status: state,
        homeScore: state === "post" ? Number(h?.score ?? 0) : undefined,
        awayScore: state === "post" ? Number(a?.score ?? 0) : undefined,
      };
    }).filter((m: EspnMatch) => m.home && m.away);
  } catch { return []; }
}

// ─── DB-data ──────────────────────────────────────────────────────────────────

async function getTeamStat(leagueId: string, teamId: string): Promise<TeamStat | null> {
  try {
    const ctx = await getSeasonContext(sb, leagueId);
    const ts = await getTeamStats(sb, leagueId, { forceSeasons: ctx.seasons });
    const ps = await getPlayerStats(sb, leagueId, { forceSeasons: ctx.seasons, limit: 200 });
    const t = ts.find(x => x.teamId === teamId);
    if (!t) return null;
    return {
      possession: t.avgPossession, passes: t.avgPassesTotal,
      yellow: t.avgYellowCards, shots: t.avgShots,
      players: ps.filter(p => p.teamId === teamId).slice(0, 3)
        .map(p => ({ name: p.athleteName, goals: p.goals, assists: p.assists })),
    };
  } catch { return null; }
}

async function getForm(teamId: string, leagueIds: string[]): Promise<FormData | null> {
  const results: Array<"W"|"D"|"L"> = [];
  let gf = 0, ga = 0, bttsYes = 0, total = 0;
  for (const lg of leagueIds) {
    const { data } = await sb.from("archived_seasons")
      .select("home_id,away_id,home_score,away_score")
      .eq("league_id", lg)
      .or(`home_id.eq.${teamId},away_id.eq.${teamId}`)
      .not("home_score", "is", null)
      .order("event_date", { ascending: false }).limit(15);
    for (const m of data ?? []) {
      const isH = m.home_id === teamId;
      const myG = isH ? m.home_score : m.away_score;
      const thG = isH ? m.away_score : m.home_score;
      total++; if (myG > 0 && thG > 0) bttsYes++;
      if (results.length < 7) { gf += myG; ga += thG; results.push(myG > thG ? "W" : myG === thG ? "D" : "L"); }
    }
  }
  if (!results.length) return null;
  return { results, avgGF: gf / results.length, avgGA: ga / results.length, bttsRate: total > 0 ? bttsYes / total : 0.5 };
}

// ─── Analys ───────────────────────────────────────────────────────────────────

const statCache = new Map<string, TeamStat | null>();
const formCache = new Map<string, FormData | null>();

async function analyzeOne(
  home: string, homeId: string, away: string, awayId: string,
  leagueId: string, time: string, status: string, homeScore?: number, awayScore?: number,
  market?: { h: number; x: number; a: number },
): Promise<MatchAnalysis> {

  const leagueFallbacks: Record<string, string[]> = {
    "eng.1": ["eng.1", "uefa.champions"],
    "fra.1": ["fra.1", "uefa.champions"],
    "nor.1": ["nor.1"],
    "swe.1": ["swe.1"],
    "bra.1": ["bra.1", "conmebol.libertadores"],
    "chi.1": ["chi.1", "conmebol.libertadores"],
    "jpn.1": ["jpn.1"],
    "kor.1": ["kor.1"],
    "ksa.1": ["ksa.1"],
    "usa.1": ["usa.1"],
    "mex.1": ["mex.1"],
    "arg.1": ["arg.1", "conmebol.libertadores"],
    "conmebol.libertadores": ["conmebol.libertadores", "bra.1", "arg.1"],
    "conmebol.sudamericana": ["conmebol.sudamericana", "bra.1"],
    "uefa.champions": ["uefa.champions", "eng.1", "fra.1"],
    "uefa.europa": ["uefa.europa", "eng.1"],
    "uefa.europa.conf": ["uefa.europa.conf"],
  };
  const fallbacks = leagueFallbacks[leagueId] ?? [leagueId];

  // Team stats
  const hKey = `${leagueId}:${homeId}`;
  const aKey = `${leagueId}:${awayId}`;
  if (!statCache.has(hKey)) statCache.set(hKey, homeId ? await getTeamStat(leagueId, homeId) : null);
  if (!statCache.has(aKey)) statCache.set(aKey, awayId ? await getTeamStat(leagueId, awayId) : null);
  const hStat = statCache.get(hKey) ?? null;
  const aStat = statCache.get(aKey) ?? null;

  // Form
  if (!formCache.has(homeId) && homeId) formCache.set(homeId, await getForm(homeId, fallbacks));
  if (!formCache.has(awayId) && awayId) formCache.set(awayId, await getForm(awayId, fallbacks));
  const hForm = homeId ? (formCache.get(homeId) ?? null) : null;
  const aForm = awayId ? (formCache.get(awayId) ?? null) : null;
  const hasData = !!(hStat || aStat || hForm || aForm);

  // Lambdas
  const HOME_ADV = leagueId === "uefa.champions" ? 1.0 : 1.12;
  let hL: number, aL: number;
  if (hForm && aForm && hForm.results.length >= 3 && aForm.results.length >= 3) {
    hL = Math.max(0.4, (hForm.avgGF + aForm.avgGA) / 2 * HOME_ADV);
    aL = Math.max(0.4, (aForm.avgGF + hForm.avgGA) / 2 / HOME_ADV);
  } else if (market) {
    const favF = market.h / 50;
    const undF = market.a / 28;
    hL = Math.max(0.55, 1.25 * favF);
    aL = Math.max(0.4,  1.0  * undF);
  } else {
    hL = 1.3; aL = 1.0;
  }

  const model = poisson1x2(hL, aL);
  let btts = bttsPct(hL, aL);
  if (hForm && aForm) btts = Math.round(btts * 0.6 + ((hForm.bttsRate + aForm.bttsRate) / 2 * 100) * 0.4);

  const tip1x2 = model.h >= model.a && model.h >= model.x ? "1" : model.a >= model.h && model.a >= model.x ? "2" : "X";
  const tipBtts: "JA" | "NEJ" = btts >= 50 ? "JA" : "NEJ";
  const conf: "HÖG"|"MEDEL"|"LÅG" = !hasData ? "LÅG" : Math.max(model.h, model.x, model.a) >= 50 ? "HÖG" : "MEDEL";

  let value: string | null = null;
  if (market) {
    if (model.h - market.h >= 7) value = `1 +${model.h - market.h}pp`;
    else if (model.a - market.a >= 7) value = `2 +${model.a - market.a}pp`;
  }

  // Reasoning
  const lines: string[] = [];
  if (!hasData && market) {
    lines.push(`Begränsad data — analys från kupong-odds. ${market.h >= 60 ? home + " klar favorit." : "Jämn match."}`);
  } else {
    if (hStat?.possession && aStat?.possession && Math.abs(hStat.possession - aStat.possession) >= 8) {
      const dom = hStat.possession > aStat.possession ? home : away;
      lines.push(`${dom} dominerar boll (${Math.max(hStat.possession, aStat.possession)}% vs ${Math.min(hStat.possession, aStat.possession)}%).`);
    }
    if (hForm) {
      const w = hForm.results.filter(r => r === "W").length;
      const str = hForm.results.join("");
      if (w >= 5) lines.push(`${home} i toppform: ${str} — ${w}/7 vinster.`);
      else if (w <= 1) lines.push(`${home} svag form: ${str} — bara ${w}/7 vinster.`);
      else lines.push(`${home} form: ${str} (GF ${hForm.avgGF.toFixed(1)}, GA ${hForm.avgGA.toFixed(1)}/match).`);
    }
    if (aForm) {
      const w = aForm.results.filter(r => r === "W").length;
      if (w >= 5) lines.push(`${away} i lysande form: ${aForm.results.join("")}.`);
      else if (w <= 1) lines.push(`${away} svag borta-form: ${aForm.results.join("")}.`);
    }
    if (value) lines.push(`⚡ VÄRDE: Modellen ${value} jämfört med marknaden.`);
    if (btts >= 62) lines.push(`Hög BTTS-sannolikhet (${btts}%) — båda lagen målfarliga (λ ${hL.toFixed(1)}/${aL.toFixed(1)}).`);
    else if (btts <= 35) lines.push(`Låg BTTS (${btts}%) — defensiv match, kan bli 1-0.`);
    const king = hStat?.players?.[0];
    if (king && king.goals >= 5) lines.push(`${king.name} (${king.goals}m/${king.assists}a) är ${home}s nyckelspelare.`);
  }

  return {
    home, homeId, away, awayId, time, status, homeScore, awayScore,
    model, market, btts, tip1x2, tipBtts, confidence: conf,
    value, hStat, aStat, hForm, aForm,
    hL: Math.round(hL * 100) / 100, aL: Math.round(aL * 100) / 100,
    reasoning: lines.slice(0, 4), hasData,
  };
}

// ─── HTML-komponenter ─────────────────────────────────────────────────────────

function matchCardHtml(a: MatchAnalysis, nr?: number): string {
  const tipCls = a.tip1x2 === "1" ? "t1" : a.tip1x2 === "2" ? "t2" : "tX";
  const confCls = a.confidence === "HÖG" ? "cH" : a.confidence === "MEDEL" ? "cM" : "cL";
  const bttsColor = a.btts >= 60 ? "#16a34a" : a.btts >= 45 ? "#d97706" : "#dc2626";

  const fDots = (form: FormData | null) => (form?.results ?? []).map(r =>
    `<span class="dot d${r}">${r}</span>`).join("");

  const playerChips = [...(a.hStat?.players ?? []).slice(0, 2), ...(a.aStat?.players ?? []).slice(0, 2)]
    .filter(p => p.goals >= 3 || p.assists >= 3)
    .map(p => `<span class="pc">⚽ ${p.name} <b>${p.goals}m/${p.assists}a</b></span>`).join("");

  const statsRow = (a.hStat || a.aStat) ? `<div class="srow">
    ${a.hStat ? `<span>${a.home.split(" ")[0]}: boll ${a.hStat.possession}% · pass ${a.hStat.passes} · 🟨${a.hStat.yellow}/mch</span>` : ""}
    ${a.aStat ? `<span>${a.away.split(" ")[0]}: boll ${a.aStat.possession}% · pass ${a.aStat.passes} · 🟨${a.aStat.yellow}/mch</span>` : ""}
  </div>` : "";

  const score = a.status === "post" && a.homeScore !== undefined
    ? `<span class="score">${a.homeScore}–${a.awayScore}</span>` : "";

  const mkH = a.market?.h, mkX = a.market?.x, mkA = a.market?.a;
  const mkRow = mkH ? `<div class="mkrow"><span>Kupong: 1:${mkH}% X:${mkX}% 2:${mkA}%</span></div>` : "";

  return `<div class="mc">
    <div class="mhdr">
      ${nr !== undefined ? `<span class="mnr">${nr}</span>` : ""}
      <div class="mteams">
        <span class="mname">${a.home} <em>vs</em> ${a.away}</span>
        <span class="mmeta">${a.time}${score ? " · " + score : ""}</span>
      </div>
      <div class="mbadges">
        <span class="conf ${confCls}">${a.confidence}</span>
        ${a.value ? `<span class="vbadge">⚡ VÄRDE ${a.value}</span>` : ""}
        ${!a.hasData ? `<span class="nd">Begr. data</span>` : ""}
      </div>
    </div>
    <div class="mbody">
      <div class="prow">
        <div class="psec">
          <div class="ptitle">1X2 PROGNOS ${mkRow}</div>
          ${["1","X","2"].map((sign, i) => {
            const pct = [a.model.h, a.model.x, a.model.a][i];
            const mkt = mkH ? [mkH, mkX ?? 0, mkA ?? 0][i] : null;
            const col = sign === "1" ? "#22c55e" : sign === "X" ? "#93c5fd" : "#f87171";
            const isVal = mkt && (pct - mkt) >= 7;
            return `<div class="pbar-row">
              <span class="pl" style="color:${col}">${sign}</span>
              <div class="pbw"><div class="pbf" style="width:${pct}%;background:${col}"></div>${mkt ? `<div class="pmk" style="left:${mkt}%"></div>` : ""}</div>
              <span class="pp" style="color:${col}">${pct}%</span>
              ${mkt ? `<span class="pm">kp:${mkt}%</span>` : ""}
              ${isVal ? `<span class="vb">VÄRDE</span>` : ""}
            </div>`;
          }).join("")}
        </div>
        <div class="psec">
          <div class="ptitle">BTTS — Båda lag gör mål</div>
          <div class="bbar"><div style="width:${a.btts}%;background:${bttsColor};height:100%;border-radius:4px"></div></div>
          <div class="bnrs"><span style="color:${bttsColor};font-weight:800">JA ${a.btts}%</span><span style="color:#4a2a2a">NEJ ${100-a.btts}%</span></div>
          ${statsRow}
        </div>
      </div>
      <div class="tiprow">
        <span class="tl">Tips:</span>
        <span class="ts ${tipCls}">${a.tip1x2}</span>
        <span class="tl">BTTS:</span>
        <span class="ts ${a.tipBtts==="JA"?"tja":"tne"}">${a.tipBtts} ${a.btts}%</span>
        <span class="lam">λh=${a.hL} λa=${a.aL}</span>
      </div>
      ${a.hForm || a.aForm ? `<div class="formrow">
        <span class="fl">${a.home.split(" ")[0]}:</span><div class="dots">${fDots(a.hForm)}</div>
        <span class="fl" style="margin-left:10px">${a.away.split(" ")[0]}:</span><div class="dots">${fDots(a.aForm)}</div>
      </div>` : ""}
      ${playerChips ? `<div class="chips">${playerChips}</div>` : ""}
      ${a.reasoning.length ? `<div class="reason"><ul>${a.reasoning.map(r=>`<li>${r}</li>`).join("")}</ul></div>` : ""}
    </div>
  </div>`;
}

// ─── Full HTML ────────────────────────────────────────────────────────────────

function buildHTML(
  leagueData: Array<{ id: string; name: string; analyses: MatchAnalysis[] }>,
  strykAnalyses: MatchAnalysis[],
): string {
  const costOf = (s: StryktipsPick[]) => s.reduce((a, m) => a * m.pick.length, 1);
  const cost4 = costOf(SYS4), cost5 = costOf(SYS5);

  const strykJs = JSON.stringify(STRYK_MATCHES);
  const strykAnalysesJs = JSON.stringify(strykAnalyses);
  const sys4Js = JSON.stringify(SYS4);
  const sys5Js = JSON.stringify(SYS5);

  const tabs = [
    { id: "stryk", label: "🎯 Stryktipset" },
    ...leagueData.map(l => ({ id: l.id, label: l.name })),
  ];

  const leagueCards = leagueData.map(l => `
    <div id="tab-${l.id}" class="tabpanel" style="display:none">
      <div class="lghead"><span class="lgname">${l.name}</span><span class="lgcount">${l.analyses.length} matcher idag</span></div>
      <div class="lgrid">${l.analyses.map(a => matchCardHtml(a)).join("")}</div>
    </div>`).join("");

  const strykCards = STRYK_MATCHES.map((m, i) => {
    const a = strykAnalyses.find(x => x.home === m.home && x.away === m.away);
    if (!a) return "";
    const aWithMkt = { ...a, market: m.coupon };
    return matchCardHtml(aWithMkt, m.nr);
  }).join("");

  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fotbollsanalys — ${new Date().toLocaleDateString("sv-SE")}</title>
<style>
:root{--bg:#080f1c;--bg2:#0d1829;--bg3:#111f35;--bd:#1c3050;--tx:#d8e8ff;--mu:#4a6a90}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--tx);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
.hdr{background:linear-gradient(120deg,#0a1f3d,#0d3060);padding:14px 20px;border-bottom:2px solid #1c3a6a;display:flex;align-items:center;gap:12px}
.hdr h1{font-size:1.2rem;font-weight:800}.hdr p{font-size:.75rem;color:#5a8fc0;margin-top:2px}
.tabbar{display:flex;gap:4px;padding:10px 16px;background:#0a1525;border-bottom:1px solid var(--bd);overflow-x:auto;flex-wrap:nowrap}
.tabbtn{padding:8px 16px;border-radius:7px;border:1px solid var(--bd);cursor:pointer;font-size:.82rem;font-weight:700;white-space:nowrap;color:var(--mu);background:transparent;transition:all .15s}
.tabbtn:hover{border-color:#2a5080;color:#90b4d8}
.tabbtn.active{background:#1d4ed8;border-color:#3b82f6;color:#fff}
.tabbtn.stryk-btn.active{background:#7c3aed;border-color:#a855f7}
.content{padding:14px 16px}
/* League section */
.lghead{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.lgname{font-size:1rem;font-weight:800;color:#e0f0ff}
.lgcount{font-size:.75rem;color:var(--mu);background:#0f2040;border:1px solid var(--bd);border-radius:10px;padding:3px 10px}
.lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(500px,1fr));gap:12px}
/* Match card */
.mc{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.mc:hover{border-color:#2a5080}
.mhdr{background:var(--bg3);padding:10px 14px;display:flex;align-items:flex-start;gap:8px;border-bottom:1px solid var(--bd)}
.mnr{width:26px;height:26px;background:#0f2040;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;color:#4a7ab0;flex-shrink:0}
.mteams{flex:1}.mname{font-size:.95rem;font-weight:700;color:#e0f0ff}.mname em{color:var(--mu);font-style:normal;font-weight:400;font-size:.82rem}
.mmeta{font-size:.72rem;color:var(--mu);margin-top:2px;display:block}
.score{font-weight:800;color:#fbbf24;margin-left:6px}
.mbadges{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0}
.conf{padding:3px 8px;border-radius:8px;font-size:.68rem;font-weight:800}
.cH{background:#052e16;color:#4ade80;border:1px solid #166534}
.cM{background:#1c1100;color:#fbbf24;border:1px solid #92400e}
.cL{background:#1f0a0a;color:#f87171;border:1px solid #7f1d1d}
.vbadge{background:#1a0800;color:#fb923c;border:1px solid #92400e;padding:2px 6px;border-radius:6px;font-size:.65rem;font-weight:800}
.nd{background:#0f172a;color:#4a6a90;border:1px solid #1e3a50;padding:2px 7px;border-radius:6px;font-size:.65rem}
.mbody{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
/* Probability bars */
.prow{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.psec{background:var(--bg3);border-radius:7px;padding:10px;border:1px solid var(--bd)}
.ptitle{font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:var(--mu);margin-bottom:7px}
.pbar-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.pl{width:14px;font-size:.8rem;font-weight:800}
.pbw{flex:1;height:7px;background:#0a1525;border-radius:3px;overflow:visible;position:relative}
.pbf{height:100%;border-radius:3px}
.pmk{position:absolute;top:-2px;height:11px;border-right:2px solid rgba(255,255,255,.4)}
.pp{width:34px;text-align:right;font-size:.8rem;font-weight:800}
.pm{width:46px;text-align:right;font-size:.7rem;color:var(--mu)}
.vb{font-size:.62rem;font-weight:800;padding:1px 4px;border-radius:3px;background:#1a0800;color:#fb923c;border:1px solid #92400e;white-space:nowrap}
.mkrow{font-size:.68rem;color:#3a5a70;margin-top:2px;margin-bottom:4px}
.bbar{height:9px;background:#0a1525;border-radius:4px;overflow:hidden;margin:6px 0}
.bnrs{display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:6px}
.srow{font-size:.72rem;color:#3a5a70;display:flex;flex-direction:column;gap:2px}
/* Tips row */
.tiprow{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.tl{font-size:.75rem;color:var(--mu)}.lam{font-size:.68rem;color:#2a3a50;margin-left:auto}
.ts{padding:5px 14px;border-radius:6px;font-size:.88rem;font-weight:800}
.t1{background:#052e16;border:1px solid #166534;color:#4ade80}
.tX{background:#0f2040;border:1px solid #1d4ed8;color:#93c5fd}
.t2{background:#2c0a0a;border:1px solid #991b1b;color:#f87171}
.tja{background:#052e16;border:1px solid #166534;color:#4ade80;padding:5px 12px;border-radius:6px;font-size:.8rem;font-weight:700}
.tne{background:#1f0a0a;border:1px solid #7f1d1d;color:#fca5a5;padding:5px 12px;border-radius:6px;font-size:.8rem;font-weight:700}
/* Form */
.formrow{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.fl{font-size:.7rem;color:var(--mu)}
.dots{display:flex;gap:2px}
.dot{width:20px;height:20px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800}
.dW{background:#052e16;color:#4ade80;border:1px solid #166534}
.dD{background:#1c1100;color:#fbbf24;border:1px solid #92400e}
.dL{background:#1f0a0a;color:#f87171;border:1px solid #7f1d1d}
/* Players */
.chips{display:flex;flex-wrap:wrap;gap:5px}
.pc{background:#0a1830;border:1px solid #1c3050;border-radius:5px;padding:3px 8px;font-size:.7rem;color:#90b4d8}
.pc b{color:#4ade80}
.reason{background:#060e1a;border-radius:5px;padding:8px 10px;border-left:2px solid #1d4ed8}
.reason ul{list-style:none;font-size:.75rem;color:#6a8fa8;line-height:1.7}
.reason li::before{content:"› ";color:#2563eb;font-weight:700}
/* Stryktipset system */
.sbox{background:var(--bg2);border:1px solid var(--bd);border-radius:10px;margin-top:16px;overflow:hidden}
.sbhdr{background:var(--bg3);padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.sbhdr h2{font-size:.95rem;font-weight:800}
.stabs{display:flex;gap:8px}
.stab{padding:7px 20px;border-radius:7px;border:2px solid;cursor:pointer;font-size:.85rem;font-weight:700}
.s4{border-color:#1d4ed8;background:#1d4ed8;color:#fff}
.s4o{border-color:#1c3050;background:transparent;color:#4a6a90}
.s5{border-color:#b45309;background:#b45309;color:#fff}
.s5o{border-color:#3b1f00;background:transparent;color:#7a4a20}
.scost{font-size:.8rem;color:#60a5fa;background:#0f2040;border:1px solid #1d4ed8;border-radius:6px;padding:4px 12px}
.diff-note{font-size:.74rem;color:#fb923c;background:#150a00;border:1px solid #92400e;border-radius:6px;padding:4px 10px;display:none}
.stbl{width:100%;border-collapse:collapse;font-size:.8rem}
.stbl th{background:#0a1525;color:var(--mu);padding:7px 10px;text-align:left;font-weight:600;font-size:.7rem;text-transform:uppercase;border-bottom:1px solid var(--bd)}
.stbl tr{border-bottom:1px solid #0f1e30}.stbl tr:hover{background:#0d1a2d}
.stbl td{padding:8px 10px;vertical-align:middle}
.sgns{display:flex;gap:3px}
.sg{width:28px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.82rem;border:1px solid transparent}
.sg-on{background:#1d4ed8;border-color:#3b82f6;color:#fff}
.sg-spik{background:linear-gradient(135deg,#052e16,#166534);border-color:#22c55e;color:#86efac}
.sg-skr{background:#7f1d1d;border-color:#ef4444;color:#fecaca}
.sg-off{background:#0a1525;border-color:#1c3050;color:#1e3a50}
.pill{padding:2px 7px;border-radius:8px;font-size:.65rem;font-weight:700}
.pspik{background:#052e16;color:#4ade80;border:1px solid #166534}
.phalvg{background:#0f2040;color:#93c5fd;border:1px solid #1d4ed8}
.phelg{background:#1e0a3c;color:#c4b5fd;border:1px solid #7c3aed}
.drow-sys{background:#150e00!important;border-left:3px solid #fb923c}
.sftr{padding:10px 16px;border-top:1px solid var(--bd);font-size:.76rem;color:var(--mu);display:flex;gap:20px;flex-wrap:wrap}
.sftr strong{color:var(--tx)}
.skbox{background:#1a0800;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin-top:12px}
.skbox h3{color:#f87171;font-size:.8rem;font-weight:800;margin-bottom:8px;text-transform:uppercase}
.skitems{display:flex;gap:8px;flex-wrap:wrap}
.ski{background:#2a0e0e;border:1px solid #991b1b;border-radius:5px;padding:6px 12px;font-size:.75rem}
.ski strong{color:#f87171}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <h1>⚽ Fotbollsanalys — ${new Date().toLocaleDateString("sv-SE", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}</h1>
    <p>1X2 + BTTS · Poisson-modell + träningsdata från databasen</p>
  </div>
</div>

<div class="tabbar" id="tabbar">
  ${tabs.map((t, i) => `<button class="tabbtn${t.id==="stryk"?" stryk-btn":""}${i===0?" active":""}" onclick="showTab('${t.id}')" id="btn-${t.id}">${t.label}</button>`).join("")}
</div>

<div class="content">
  <!-- Stryktipset-fliken -->
  <div id="tab-stryk" class="tabpanel">
    <div class="lghead">
      <span class="lgname">🎯 Stryktipset — 30 maj 2026</span>
      <span class="lgcount">13 matcher · garderingssystem</span>
    </div>
    <div class="lgrid" id="stryk-cards">${strykCards}</div>

    <div class="sbox">
      <div class="sbhdr">
        <h2>📋 Garderingssystem</h2>
        <div class="stabs">
          <button class="stab s4" onclick="setSys(4)" id="s4btn">★★★★ 4 SPIKAR — ${cost4} SEK</button>
          <button class="stab s5o" onclick="setSys(5)" id="s5btn">★★★★★ 5 SPIKAR — ${cost5} SEK</button>
        </div>
        <span class="scost" id="scost">${cost4} rader</span>
        <span class="diff-note" id="diffnote">⚠ Match [3] Molde → SPIK i 5-systemet</span>
      </div>
      <table class="stbl">
        <thead><tr><th>#</th><th>Match</th><th>1</th><th>X</th><th>2</th><th>Typ</th><th>Tips</th></tr></thead>
        <tbody id="stbl"></tbody>
      </table>
      <div class="sftr" id="sftr"></div>
      <div class="skbox">
        <h3>🔴 Skräll-nycklarna till hög utdelning</h3>
        <div class="skitems">
          <div class="ski"><strong>[2] Norrby borta (2) — 21%</strong> · "12"-gardering · Få delar potten om den faller in</div>
          <div class="ski"><strong>[10] Kristianstad borta (2) — 21%</strong> · Båda rätt → est. 50k–500k kr</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Ligor -->
  ${leagueCards}
</div>

<script>
const STRYK   = ${strykJs};
const SANA    = ${strykAnalysesJs};
const SYS4    = ${sys4Js};
const SYS5    = ${sys5Js};
let sysMode   = 4;

function showTab(id){
  document.querySelectorAll('.tabpanel').forEach(p=>p.style.display='none');
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+id).style.display='block';
  document.getElementById('btn-'+id).classList.add('active');
}

function setSys(m){
  sysMode=m;
  document.getElementById('s4btn').className='stab '+(m===4?'s4':'s4o');
  document.getElementById('s5btn').className='stab '+(m===5?'s5':'s5o');
  document.getElementById('diffnote').style.display=m===5?'inline':'none';
  renderSys();
}

function renderSys(){
  const sys=sysMode===4?SYS4:SYS5;
  const smap=Object.fromEntries(sys.map(s=>[s.nr,s]));
  const diffs=SYS4.filter((_,i)=>SYS4[i].pick!==SYS5[i].pick||SYS4[i].type!==SYS5[i].type).map(m=>m.nr);
  const cost=sys.reduce((a,m)=>a*m.pick.length,1);

  const sg=(sp,l)=>{
    const on=sp.pick.includes(l);
    const isSp=sp.type==='spik'&&on, isSk=sp.skrall===l&&on;
    const c=on?(isSp?'sg-spik':isSk?'sg-skr':'sg-on'):'sg-off';
    return '<div class="sg '+c+'">'+(isSp?'★':l)+'</div>';
  };

  const tbody=document.getElementById('stbl');
  tbody.innerHTML=STRYK.map(m=>{
    const sp=smap[m.nr];
    const a=SANA.find(x=>x.home===m.home&&x.away===m.away)||{};
    const isDiff=diffs.includes(m.nr);
    const pill=sp.type==='spik'?'pspik':sp.type==='halvg'?'phalvg':'phelg';
    const pt=sp.type==='spik'?'★ SPIK':sp.type==='halvg'?'½ HALVG':'● HELG';
    const tipStr=(a.tip1x2||'?')+' · BTTS '+(a.btts>=50?'JA':'NEJ')+' '+(a.btts||'?')+'%';
    return '<tr class="'+(isDiff?'drow-sys':'')+'">'
      +'<td style="color:var(--mu);font-weight:700">'+m.nr+'</td>'
      +'<td><strong>'+m.home+'</strong> vs '+m.away+'<br><span style="font-size:.68rem;color:var(--mu)">'+m.league+' · '+m.time+'</span></td>'
      +'<td><div class="sgns">'+sg(sp,'1')+'</div></td>'
      +'<td><div class="sgns">'+sg(sp,'X')+'</div></td>'
      +'<td><div class="sgns">'+sg(sp,'2')+'</div></td>'
      +'<td><span class="pill '+pill+'">'+pt+'</span></td>'
      +'<td style="font-size:.74rem;color:var(--mu)">'+tipStr+'</td>'
      +'</tr>';
  }).join('');

  document.getElementById('scost').textContent=cost+' rader = '+cost+' SEK'+(sysMode===4?' (red. ~600kr)':'');
  const spikar=sys.filter(s=>s.type==='spik');
  const halvg=sys.filter(s=>s.type==='halvg');
  const helg=sys.filter(s=>s.type==='helg');
  document.getElementById('sftr').innerHTML=
    '<span><strong>Spikar ('+spikar.length+'):</strong> '+spikar.map(s=>STRYK.find(x=>x.nr===s.nr)?.home).join(', ')+'</span>'
    +'<span><strong>Halvg ('+halvg.length+'):</strong> '+halvg.map(s=>'['+s.nr+']'+s.pick).join(' ')+'</span>'
    +'<span><strong>Helg ('+helg.length+'):</strong> '+helg.map(s=>'['+s.nr+']1X2').join(' ')+'</span>';
}

showTab('stryk');
renderSys();
</script>
</body>
</html>`;
}

// ─── Startprocess ─────────────────────────────────────────────────────────────

async function start() {
  console.log(`⏳ Hämtar dagens matcher och analyserar...`);
  const date = new Date().toLocaleDateString("sv-SE");

  // 1) Hämta alla liga-stats från DB en gång
  console.log("   Laddar lagstatistik från DB...");
  for (const lg of LEAGUES) {
    try {
      const ctx = await getSeasonContext(sb, lg.id);
      const ts  = await getTeamStats(sb, lg.id, { forceSeasons: ctx.seasons });
      const ps  = await getPlayerStats(sb, lg.id, { forceSeasons: ctx.seasons, limit: 300 });
      for (const t of ts) {
        statCache.set(`${lg.id}:${t.teamId}`, {
          possession: t.avgPossession, passes: t.avgPassesTotal,
          yellow: t.avgYellowCards, shots: t.avgShots,
          players: ps.filter(p => p.teamId === t.teamId).slice(0, 3)
            .map(p => ({ name: p.athleteName, goals: p.goals, assists: p.assists })),
        });
      }
    } catch { /* ingen data för ligan */ }
  }
  console.log(`   ${statCache.size} lagposter laddade`);

  // 2) Hämta dagens matcher per liga
  const leagueData: Array<{ id: string; name: string; analyses: MatchAnalysis[] }> = [];
  for (const lg of LEAGUES) {
    const matches = await fetchTodayMatches(lg.id);
    if (!matches.length) continue;
    process.stdout.write(`   ${lg.name} (${matches.length} matcher)... `);
    const analyses: MatchAnalysis[] = [];
    for (const m of matches) {
      const a = await analyzeOne(m.home, m.homeId, m.away, m.awayId, lg.id, m.time, m.status, m.homeScore, m.awayScore);
      analyses.push(a);
    }
    console.log("✓");
    leagueData.push({ id: lg.id, name: lg.name, analyses });
    await sleep(200);
  }

  // 3) Analysera Stryktipset-matcherna
  console.log("   Analyserar Stryktipset...");
  const strykAnalyses: MatchAnalysis[] = [];
  for (const m of STRYK_MATCHES) {
    const a = await analyzeOne(
      m.home, m.homeId ?? "", m.away, m.awayId ?? "",
      m.league === "UCL-final" ? "uefa.champions" : m.league === "Eliteserien" ? "nor.1" : m.league === "Brasileirao" ? "bra.1" : "swe.1",
      m.time, "pre", undefined, undefined, m.coupon,
    );
    strykAnalyses.push(a);
    process.stdout.write(`[${m.nr}]${a.tip1x2}/${a.btts}% `);
  }
  console.log("\n");

  const html = buildHTML(leagueData, strykAnalyses);

  // 4) Starta servern
  const PORT = 8080;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`✗ Port ${PORT} är upptagen.`); process.exit(1);
    }
    throw e;
  });
  server.listen(PORT, () => {
    console.log(`✅ http://localhost:${PORT}/`);
    console.log(`   Ligor med matcher idag: ${leagueData.map(l=>l.name).join(", ")}`);
    console.log("   Ctrl+C för att stänga");
  });
}

start().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
