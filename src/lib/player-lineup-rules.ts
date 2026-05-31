/**
 * Spelarsspecifika lineup-regler för BTTS och Ö2.5.
 *
 * Baserade på fullständig säsongsanalys av football_player_match_stats
 * (247k poster, 6 ligor, 2025-2026-säsongen).
 *
 * Regler uttrycks som delta (pp) som appliceras på BTTS% och Ö2.5%
 * BEROENDE PÅ om spelaren startar eller inte.
 *
 * Format:
 *   when: "starting"     → regeln triggar när spelaren är med i startelvan
 *   when: "not_starting" → regeln triggar när spelaren INTE är i startelvan
 *   bttsDeltaPp          → ändring i BTTS-sannolikhet (procentenheter)
 *   over25DeltaPp        → ändring i Ö2.5-sannolikhet (procentenheter)
 *
 * Capped globalt vid ±20pp per regel för att inte överanvända enskild signal.
 */

export type PlayerLineupRule = {
  id: string;
  /** Spelarnamn (används för normaliserad matchning) */
  playerName: string;
  /** Lagnnamn för tydlighet i logging */
  teamName: string;
  leagueId: string;
  /** Triggar när spelaren startar eller inte startar */
  when: "starting" | "not_starting";
  /** Delta på BTTS-% (pp). Negativt = sänker BTTS. */
  bttsDeltaPp: number;
  /** Delta på Ö2.5-% (pp). Negativt = sänker Ö2.5. */
  over25DeltaPp: number;
  /** Antal matcher analyserade MED spelaren */
  sampleWith: number;
  /** Antal matcher analyserade UTAN spelaren */
  sampleWithout: number;
  /** Kort förklaring som syns i bttsReason */
  note: string;
};

export const PLAYER_LINEUP_RULES: PlayerLineupRule[] = [
  // ──────────────────────────────────────────────────────────────
  // BUNDESLIGA
  // ──────────────────────────────────────────────────────────────
  {
    id: "fuhrich-stuttgart-not-starting",
    playerName: "Chris Führich",
    teamName: "VfB Stuttgart",
    leagueId: "ger.1",
    when: "not_starting",
    // Med: 80% BTTS, 85% Ö2.5 → Utan: 33% BTTS, 50% Ö2.5
    bttsDeltaPp: -20,
    over25DeltaPp: -18,
    sampleWith: 20,
    sampleWithout: 12,
    note: "Führich ute → Stuttgart BTTS-maskin stängs av (80%→33% historiskt)",
  },
  {
    id: "kramaric-hoffenheim-not-starting",
    playerName: "Andrej Kramaric",
    teamName: "TSG Hoffenheim",
    leagueId: "ger.1",
    when: "not_starting",
    // Med: 66.7% BTTS, 70.8% Ö2.5 → Utan: 37.5% BTTS, 50% Ö2.5
    bttsDeltaPp: -18,
    over25DeltaPp: -15,
    sampleWith: 24,
    sampleWithout: 8,
    note: "Kramaric ute → Hoffenheim tappar angreppsmotor (1.25 mål/match gap)",
  },
  {
    id: "diaz-bayern-starting",
    playerName: "Luis Díaz",
    teamName: "Bayern Munich",
    leagueId: "ger.1",
    when: "starting",
    // Med: 96% Ö2.5, 72% BTTS → Utan: 60% Ö2.5, 40% BTTS
    bttsDeltaPp: 15,
    over25DeltaPp: 20,
    sampleWith: 25,
    sampleWithout: 5,
    note: "Luis Díaz i startelvan → Bayern uppnår 96% Ö2.5 historiskt (3.64 mål/match snitt)",
  },
  {
    id: "leweling-stuttgart-not-starting",
    playerName: "Jamie Leweling",
    teamName: "VfB Stuttgart",
    leagueId: "ger.1",
    when: "not_starting",
    // Med: 2.17 mål, W/D/L 14/7/3 → Utan: 1.33 mål, 1/1/4
    bttsDeltaPp: -12,
    over25DeltaPp: -16,
    sampleWith: 24,
    sampleWithout: 6,
    note: "Leweling ute → Stuttgart offensiv försvagas (2.17→1.33 mål/m)",
  },

  // ──────────────────────────────────────────────────────────────
  // LA LIGA
  // ──────────────────────────────────────────────────────────────
  {
    id: "guruzeta-athletic-not-starting",
    playerName: "Gorka Guruzeta",
    teamName: "Athletic Club",
    leagueId: "esp.1",
    when: "not_starting",
    // Med: 57.1% BTTS, 42.9% Ö2.5, 10/7/11 → Utan: 16.7% BTTS, 50% Ö2.5, 0/0/6
    bttsDeltaPp: -15,
    over25DeltaPp: -8,
    sampleWith: 28,
    sampleWithout: 6,
    note: "Guruzeta ute → Athletic vann 0/6 matcher utan honom (0.17 mål/match)",
  },
  {
    id: "vinicius-real-not-starting",
    playerName: "Vinícius Júnior",
    teamName: "Real Madrid",
    leagueId: "esp.1",
    when: "not_starting",
    // Med: 2.03 mål, 21/4/5 → Utan: 1.33 mål, 1/1/1
    bttsDeltaPp: -10,
    over25DeltaPp: -10,
    sampleWith: 30,
    sampleWithout: 3,
    note: "Vinícius ute → Real Madrids mål sjunker (2.03→1.33) och vinstfrekvens -37pp",
  },
  {
    id: "sorloth-atletico-not-starting",
    playerName: "Alexander Sørloth",
    teamName: "Atlético Madrid",
    leagueId: "esp.1",
    when: "not_starting",
    // Med: 1.89 mål, 13/2/3, 44.4% BTTS → Utan: 1.00 mål, 5/2/7, 42.9% BTTS
    bttsDeltaPp: -5,
    over25DeltaPp: -12,
    sampleWith: 18,
    sampleWithout: 14,
    note: "Sørloth ute → Atlético förenar mål (1.89→1.00) och tappar vinster -37pp",
  },
  {
    id: "moleiro-villarreal-not-starting",
    playerName: "Alberto Moleiro",
    teamName: "Villarreal",
    leagueId: "esp.1",
    when: "not_starting",
    // Med: 1.93 mål, 65.5% Ö2.5 → Utan: 1.17 mål, 33.3% Ö2.5
    bttsDeltaPp: -5,
    over25DeltaPp: -15,
    sampleWith: 29,
    sampleWithout: 6,
    note: "Moleiro ute → Villarreal Ö2.5 sjunker kraftigt (65%→33%)",
  },

  // ──────────────────────────────────────────────────────────────
  // LIGUE 1
  // ──────────────────────────────────────────────────────────────
  {
    id: "godo-strasbourg-not-starting",
    playerName: "Martial Godo",
    teamName: "Strasbourg",
    leagueId: "fra.1",
    when: "not_starting",
    // Med: 77.8% BTTS, 72.2% Ö2.5 → Utan: 50% BTTS, 50% Ö2.5
    bttsDeltaPp: -16,
    over25DeltaPp: -14,
    sampleWith: 18,
    sampleWithout: 12,
    note: "Godo ute → Strasbourg tappar attack (2.22→1.00 mål/m) och BTTS faller",
  },
  {
    id: "kvaratskhelia-psg-starting",
    playerName: "Khvicha Kvaratskhelia",
    teamName: "Paris Saint-Germain",
    leagueId: "fra.1",
    when: "starting",
    // Med: 27.8% BTTS → Utan: 54.5% BTTS (PSG dominerar mer med Kvara = färre BTTS)
    bttsDeltaPp: -15,
    over25DeltaPp: -10,
    sampleWith: 18,
    sampleWithout: 11,
    note: "Kvara i PSG-startlva → PSG dominerar och håller clean sheets (BTTS 27% vs 54%)",
  },
  {
    id: "said-lens-not-starting",
    playerName: "Wesley Saïd",
    teamName: "Lens",
    leagueId: "fra.1",
    when: "not_starting",
    // Med: 2.00 mål, 43.5% BTTS → Utan: 0.75 mål, 50% BTTS
    bttsDeltaPp: -5,
    over25DeltaPp: -14,
    sampleWith: 23,
    sampleWithout: 4,
    note: "Saïd ute → Lens tappar kraft (2.00→0.75 mål/match)",
  },
  {
    id: "altamari-rennais-not-starting",
    playerName: "Mousa Al-Tamari",
    teamName: "Stade Rennais",
    leagueId: "fra.1",
    when: "not_starting",
    // Med: 1.96 mål, 60.9% BTTS → Utan: 1.13 mål, 62.5% BTTS
    bttsDeltaPp: -5,
    over25DeltaPp: -12,
    sampleWith: 23,
    sampleWithout: 8,
    note: "Al-Tamari ute → Rennais tappar mål (1.96→1.13) och vinstfrekvens",
  },

  // ──────────────────────────────────────────────────────────────
  // PREMIER LEAGUE
  // ──────────────────────────────────────────────────────────────
  {
    id: "mbeumo-manutd-not-starting",
    playerName: "Bryan Mbeumo",
    teamName: "Manchester United",
    leagueId: "eng.1",
    when: "not_starting",
    // Med: 71.4% Ö2.5, 2.04 mål → Utan: 50% Ö2.5, 0.50 mål (2 matcher)
    bttsDeltaPp: -12,
    over25DeltaPp: -14,
    sampleWith: 28,
    sampleWithout: 2, // liten utan-sample — gäller vid hög konfidens
    note: "Mbeumo ute → Man Utd:s anfallsbild försvinner (2.04→0.50 mål/m)",
  },
  {
    id: "thiago-brentford-not-starting",
    playerName: "Igor Thiago",
    teamName: "Brentford",
    leagueId: "eng.1",
    when: "not_starting",
    // Med: 1.47 mål, 50% BTTS → Utan: 0 mål, 0% BTTS (1 match)
    bttsDeltaPp: -10,
    over25DeltaPp: -10,
    sampleWith: 34,
    sampleWithout: 1,
    note: "Igor Thiago ute → Brentfords anfallsmotor stoppas",
  },

  // ──────────────────────────────────────────────────────────────
  // SERIE A
  // ──────────────────────────────────────────────────────────────
  {
    id: "lautaro-inter-not-starting",
    playerName: "Lautaro Martínez",
    teamName: "Internazionale",
    leagueId: "ita.1",
    when: "not_starting",
    // Med: 2.40 mål, 44% BTTS → Utan: 1.67 mål, 50% BTTS
    bttsDeltaPp: -5,
    over25DeltaPp: -12,
    sampleWith: 25,
    sampleWithout: 6,
    note: "Lautaro ute → Inter tappar mål (2.40→1.67) och vinstfrekvens -22pp",
  },
  {
    id: "douvikas-como-not-starting",
    playerName: "Anastasios Douvikas",
    teamName: "Como",
    leagueId: "ita.1",
    when: "not_starting",
    // Med: 1.96 mål, 14/6/3 → Utan: 1.31 mål, 5/5/3
    bttsDeltaPp: -5,
    over25DeltaPp: -8,
    sampleWith: 23,
    sampleWithout: 13,
    note: "Douvikas ute → Como tappar anfallsstyrka (1.96→1.31 mål/m)",
  },
  {
    id: "yildiz-juventus-not-starting",
    playerName: "Kenan Yildiz",
    teamName: "Juventus",
    leagueId: "ita.1",
    when: "not_starting",
    // Med: 1.61 mål, 45.2% BTTS → Utan: 1.00 mål, 25% BTTS
    bttsDeltaPp: -12,
    over25DeltaPp: -8,
    sampleWith: 31,
    sampleWithout: 4,
    note: "Yildiz ute → Juventus tappar kreativitet (BTTS 45%→25%)",
  },
];

// ─── Hjälpfunktioner ─────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function nameMatchesLineup(playerName: string, lineupNames: string[]): boolean {
  const normPlayer = normalizeName(playerName);
  const playerParts = normPlayer.split(/\s+/).filter((p) => p.length >= 4);

  return lineupNames.some((n) => {
    const normN = normalizeName(n);
    // Exakt matchning eller partiell (minst ett namnled matchar)
    return normN === normPlayer || playerParts.some((part) => normN.includes(part));
  });
}

export type LineupRuleResult = {
  bttsDeltaTotal: number;
  over25DeltaTotal: number;
  appliedRules: Array<{ id: string; note: string; bttsDelta: number; over25Delta: number }>;
};

/**
 * Kör alla player-lineup-regler för en match.
 *
 * @param leagueId   - Liga-ID
 * @param homeXI     - Bekräftade hemmastarters (namn-lista)
 * @param awayXI     - Bekräftade bortastarters (namn-lista)
 * @param homeName   - Hemmalag (för att avgöra vilken sida en regel gäller)
 * @param awayName   - Bortalag
 */
export function applyPlayerLineupRules(
  leagueId: string,
  homeXI: string[],
  awayXI: string[],
  homeName: string,
  awayName: string,
): LineupRuleResult {
  if (!homeXI.length && !awayXI.length) {
    return { bttsDeltaTotal: 0, over25DeltaTotal: 0, appliedRules: [] };
  }

  const allXI = [...homeXI, ...awayXI];
  const leagueRules = PLAYER_LINEUP_RULES.filter((r) => r.leagueId === leagueId);

  let bttsDeltaTotal = 0;
  let over25DeltaTotal = 0;
  const appliedRules: LineupRuleResult["appliedRules"] = [];

  // Stopord som inte ska användas för lag-matchning
  const TEAM_STOPWORDS = new Set(["fc", "cf", "sc", "ac", "bv", "vfb", "rb", "sk", "if", "ik", "bk", "fk", "af", "afc", "de", "del", "van", "la", "le", "el"]);

  function teamKeywords(name: string): string[] {
    return normalizeName(name)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !TEAM_STOPWORDS.has(w));
  }

  function teamsMatch(a: string, b: string): boolean {
    const kA = teamKeywords(a);
    const kB = teamKeywords(b);
    // Minst ett gemensamt nyckelord, eller ett nyckelord som börjar med ett annat
    return kA.some((w) => kB.some((w2) => w.startsWith(w2) || w2.startsWith(w)));
  }

  for (const rule of leagueRules) {
    const isHomeTeam = teamsMatch(rule.teamName, homeName);
    const isAwayTeam = teamsMatch(rule.teamName, awayName);
    if (!isHomeTeam && !isAwayTeam) continue;

    // Relevant lineup = hemmalagets XI om det är homeTeam, annars bortalaget
    const relevantXI = isHomeTeam ? homeXI : awayXI;
    const isInStartingXI = nameMatchesLineup(rule.playerName, relevantXI);

    // Trigga regeln
    const shouldApply =
      (rule.when === "starting" && isInStartingXI) ||
      (rule.when === "not_starting" && !isInStartingXI && relevantXI.length > 0);

    if (!shouldApply) continue;

    // Skalning baserat på sample-storlek
    // Regler med under 4 "utan"-matcher ges 50% vikt
    const minSample = Math.min(rule.sampleWith, rule.sampleWithout);
    const scale = minSample < 4 ? 0.5 : minSample < 6 ? 0.75 : 1.0;

    const scaledBtts = Math.round(rule.bttsDeltaPp * scale);
    const scaledOver25 = Math.round(rule.over25DeltaPp * scale);

    bttsDeltaTotal += scaledBtts;
    over25DeltaTotal += scaledOver25;

    appliedRules.push({
      id: rule.id,
      note: rule.note,
      bttsDelta: scaledBtts,
      over25Delta: scaledOver25,
    });
  }

  // Global cap: max ±25pp total
  bttsDeltaTotal = Math.max(-25, Math.min(25, bttsDeltaTotal));
  over25DeltaTotal = Math.max(-25, Math.min(25, over25DeltaTotal));

  return { bttsDeltaTotal, over25DeltaTotal, appliedRules };
}
