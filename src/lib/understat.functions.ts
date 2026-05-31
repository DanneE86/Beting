/**
 * Understat xG-data för stora europeiska ligor.
 * Täcker: EPL, La Liga, Bundesliga, Serie A, Ligue 1.
 * För Allsvenskan används bolldata.se (se bolldata.functions.ts).
 */

export type XgRow = {
  name: string;
  xG: number;    // ackumulerade xG hela säsongen
  xGA: number;   // ackumulerade xGA hela säsongen
  xPts: number;  // ackumulerade xPts hela säsongen
  played: number;
  luck?: number; // pts − xPts (fylls i när standings är tillgängliga)
};

const UNDERSTAT_LEAGUE: Record<string, string> = {
  "eng.1": "EPL",
  "esp.1": "La_liga",
  "ger.1": "Bundesliga",
  "ita.1": "Serie_A",
  "fra.1": "Ligue_1",
};

/** Bestäm säsongsår: juli+ = ny säsong, jan–juni = föregående startår. */
function seasonYear(): number {
  const now = new Date();
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function unescapeUnderstat(raw: string): string {
  return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
}

export async function fetchLeagueXG(leagueId: string): Promise<XgRow[]> {
  const league = UNDERSTAT_LEAGUE[leagueId];
  if (!league) return [];

  try {
    const year = seasonYear();
    const url = `https://understat.com/league/${league}/${year}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const m = html.match(/var teamsData\s*=\s*JSON\.parse\('(.+?)'\)\s*;/);
    if (!m) return [];

    const decoded = unescapeUnderstat(m[1]);
    const teams = JSON.parse(decoded) as Record<
      string,
      { title: string; history: { xG: string; xGA: string; xpts: string }[] }
    >;

    return Object.values(teams).map((t) => {
      const h = t.history ?? [];
      const played = h.length;
      const xG = h.reduce((s, r) => s + Number(r.xG), 0);
      const xGA = h.reduce((s, r) => s + Number(r.xGA), 0);
      const xPts = h.reduce((s, r) => s + Number(r.xpts), 0);
      return {
        name: t.title,
        xG: Math.round(xG * 10) / 10,
        xGA: Math.round(xGA * 10) / 10,
        xPts: Math.round(xPts * 10) / 10,
        played,
      };
    });
  } catch {
    return [];
  }
}

const NORM_STOP_WORDS =
  /\b(fc|cf|sc|ac|as|ss|rc|rb|vfb|bvb|afc|bfc|real|atletico|athletic|sporting|bayer|borussia|paris|saint|germain|manchester|united|city|west|ham|crystal|palace|tottenham|hotspur|newcastle|wolverhampton|wanderers|nottingham|forest|leicester|brighton|hove|albion|luton|town|sheffield|aston|villa|ipswich)\b/gi;

function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NORM_STOP_WORDS, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function findXgRow(rows: XgRow[], espnName: string): XgRow | undefined {
  if (!rows.length) return undefined;
  const target = normName(espnName);
  if (!target) return undefined;
  // Exakt match först
  const exact = rows.find((r) => normName(r.name) === target);
  if (exact) return exact;
  // Substring-match (kortare sida)
  return rows.find((r) => {
    const n = normName(r.name);
    return n.includes(target) || target.includes(n);
  });
}
