// Fetch matchday squad ("truppen") announcements from Allsvenskan club websites.
// Best-effort: each club has its own CMS. We register URL builders per team
// that map (matchDate, opponentName) → candidate article URLs, then scrape
// player rows like "**N** Player Name".

type SquadCandidate = (date: Date, opponent: string) => string[];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const yymmdd = (d: Date) => {
  const y = String(d.getUTCFullYear() % 100).padStart(2, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

// Normalized team key → URL builder. Add more clubs as their patterns are confirmed.
const SQUAD_URLS: Record<string, SquadCandidate> = {
  aik: (date, opp) => {
    const slug = slugify(opp);
    // Try a few common opponent slug variants (with/without "if", "fc", "sk")
    const variants = new Set([
      slug,
      slug.replace(/-?(if|fc|bk|sk|aif)$/i, ""),
      slug.replace(/-?(if|fc|bk|sk|aif)-/i, "-"),
    ]);
    const base = `https://www.aikfotboll.se/artiklar-och-nyheter/${yymmdd(date)}-truppen-mot-`;
    return [...variants].filter(Boolean).map((v) => `${base}${v}`);
  },
};

const teamKey = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(fc|if|bk|sk|aif|sif)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

const TEAM_ALIASES: Record<string, string> = {
  aikstockholm: "aik",
  aik: "aik",
};

function parseSquadHtml(html: string): { number: number; name: string; gk: boolean }[] {
  // Match "<strong>N </strong>Name<br/>" or "<strong>N</strong> Name<br/>"
  const re = /<strong>\s*(\d{1,2})\s*<\/strong>\s*([^<]+?)(?=\s*(?:<br|<\/p|<strong))/gi;
  const players: { number: number; name: string; gk: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(re)) {
    const number = Number(m[1]);
    const raw = m[2].replace(/&nbsp;/g, " ").trim();
    if (!raw) continue;
    const gk = /\(mv\)|\(gk\)|\bm[åa]lvakt\b/i.test(raw);
    const name = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const key = `${number}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({ number, name, gk });
  }
  return players;
}

export type MatchdaySquad = {
  source: string;
  url: string | null;
  players: { number: number; name: string; gk: boolean }[];
};

export async function fetchMatchdaySquad(
  teamName: string,
  opponentName: string,
  matchDate: Date,
): Promise<MatchdaySquad> {
  const k = teamKey(teamName);
  const alias = TEAM_ALIASES[k] ?? k;
  const builder = SQUAD_URLS[alias];
  const empty: MatchdaySquad = { source: "club-site:unmapped", url: null, players: [] };
  if (!builder) return empty;

  // Try the configured date and ±1 day (announcements often posted day before).
  const dates = [matchDate, new Date(matchDate.getTime() - 86400000), new Date(matchDate.getTime() + 86400000)];
  for (const d of dates) {
    const urls = builder(d, opponentName);
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
          },
        });
        if (!res.ok) continue;
        const html = await res.text();
        // Bail early if page is a generic 404 / "hittades inte"
        if (/hittades inte|sidan kunde inte/i.test(html.slice(0, 4000))) continue;
        const players = parseSquadHtml(html);
        if (players.length >= 11) {
          return { source: "club-site", url, players };
        }
      } catch {
        // try next
      }
    }
  }
  return empty;
}
