import type { OptaMatch } from "./opta.scraper";

export function normTeam(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function findOptaMatch(
  matches: OptaMatch[],
  homeName: string,
  awayName: string,
): OptaMatch | undefined {
  const h = normTeam(homeName);
  const a = normTeam(awayName);
  return matches.find((m) => {
    const mh = normTeam(m.homeName);
    const ma = normTeam(m.awayName);
    return (mh.includes(h) || h.includes(mh)) && (ma.includes(a) || a.includes(ma));
  });
}

function fmtScore(s: { home: number; away: number }) {
  return `${s.home}-${s.away}`;
}

/** Kort svensk sammanfattning för prediktioner och loggar. */
export function formatOptaMatchSummary(m: OptaMatch): string {
  const place = m.countryFullName || m.countryName;
  const placePart = place ? `${place} · ` : "";
  const display = m.scoreFt ?? m.scoreTotal;
  let scorePart = "";
  if (display) {
    scorePart = ` · ${fmtScore(display)}`;
    if (m.scoreHt && m.status !== "fixture") {
      scorePart += ` (HT ${fmtScore(m.scoreHt)})`;
    }
  }
  return `Opta: ${placePart}${m.leagueName} · ${m.status}${scorePart}`;
}
