import type { AtgRace, AtgStart } from "../types";
import type { TravsportHorseProfile } from "../travsport/types";
import type { ChecklistItem } from "./types";
import { pctFromAtg, weightedAverage } from "./utils";

export function scoreDriverChecklist(
  start: AtgStart,
  race: AtgRace,
  betDistributionPct: number,
  travsport?: TravsportHorseProfile | null,
): { items: ChecklistItem[]; highlights: string[] } {
  const d = start.driver;
  const h = start.horse;
  const highlights: string[] = [];
  const y2025 = d?.statistics?.years?.["2025"];
  const y2026 = d?.statistics?.years?.["2026"];

  const win26 = pctFromAtg(y2026?.winPercentage);
  const win25 = pctFromAtg(y2025?.winPercentage);
  const starts26 = y2026?.starts ?? 0;
  const starts25 = y2025?.starts ?? 0;
  const place26 =
    starts26 > 0
      ? ((y2026?.placement?.["1"] ?? 0) +
          (y2026?.placement?.["2"] ?? 0) +
          (y2026?.placement?.["3"] ?? 0)) /
        starts26
      : 0;

  const formScore = Math.min(1, win26 / 20);
  const trendScore =
    win25 > 0 ? Math.min(1, Math.max(0.3, 0.5 + (win26 - win25) / 30)) : 0.5;

  const trainer = h?.trainer;
  const sameTeam =
    trainer &&
    d &&
    (trainer.id === d.id ||
      `${trainer.lastName}`.toLowerCase() === `${d.lastName}`.toLowerCase());
  const teamScore = sameTeam ? 0.9 : 0.6;

  const trackName = race.track?.name ?? "";
  const driverHome = d?.homeTrack?.name ?? "";
  const trackScore =
    driverHome && trackName && driverHome.includes(trackName.slice(0, 4))
      ? 0.8
      : 0.55;

  const raceMethod = (race as { startMethod?: string }).startMethod ?? "auto";
  const methodScore = 0.6;

  const favScore =
    betDistributionPct >= 25
      ? Math.min(1, win26 / 22)
      : betDistributionPct >= 12
        ? Math.min(1, win26 / 18) * 0.9
        : 0.55;

  const pairStarts = travsport?.driverPairStarts ?? 0;
  const pairWins = travsport?.driverPairWins ?? 0;
  const pairScore =
    pairStarts > 0 ? Math.min(1, 0.4 + (pairWins / pairStarts) * 1.2) : 0.5;

  if (win26 >= 18) highlights.push(`Kusk het (${win26.toFixed(0)}% vinst)`);
  if (sameTeam) highlights.push("Kusk/tränare samma team");
  if (betDistributionPct >= 20 && win26 >= 15)
    highlights.push("Levererar ofta som favorit");
  if (pairStarts >= 2 && pairWins >= 1)
    highlights.push(`Kusk+häst: ${pairWins}/${pairStarts} (Travsport)`);

  const items: ChecklistItem[] = [
    {
      id: "driver_form",
      category: "kusk",
      label: "Aktuell form (vinst/plac % 2026)",
      score: formScore * 0.6 + place26 * 0.4,
      weight: 1.2,
      available: starts26 > 5,
      note: `${d?.shortName ?? "?"}: ${win26.toFixed(1)}% vinst, ${(place26 * 100).toFixed(0)}% plats`,
    },
    {
      id: "driver_trend",
      category: "kusk",
      label: "Formtrend 2025→2026",
      score: trendScore,
      weight: 0.8,
      available: win25 > 0 && win26 > 0,
      note: `${win25.toFixed(1)}% → ${win26.toFixed(1)}%`,
    },
    {
      id: "horse_pair",
      category: "kusk",
      label: "Form med denna häst",
      score: pairScore,
      weight: 1,
      available: pairStarts > 0,
      note:
        pairStarts > 0
          ? `Travsport: ${pairWins} segrar på ${pairStarts} starter`
          : "Ingen gemensam historik hittad",
    },
    {
      id: "big_pool",
      category: "kusk",
      label: "Storseger i stora pooler",
      score: Math.min(1, win26 / 16),
      weight: 0.7,
      available: starts26 > 20,
      note: "Proxy: vinst% i större startfält 2026",
    },
    {
      id: "driver_track",
      category: "kusk",
      label: "Bana & starttyp",
      score: (trackScore + methodScore) / 2,
      weight: 0.7,
      available: !!trackName,
      note: `${trackName}, ${raceMethod}`,
    },
    {
      id: "driving_style",
      category: "kusk",
      label: "Körstil",
      score: 0.5,
      weight: 0.4,
      available: false,
      note: "Ej tillgänglig via API",
    },
    {
      id: "favorite_delivery",
      category: "kusk",
      label: "Som favorit/streckad",
      score: favScore,
      weight: betDistributionPct >= 15 ? 1.1 : 0.6,
      available: betDistributionPct > 0,
      note: `${betDistributionPct.toFixed(1)}% av spelet`,
    },
    {
      id: "trainer_pair",
      category: "kusk",
      label: "Samarbete tränare",
      score: teamScore,
      weight: 0.8,
      available: !!trainer && !!d,
      note: sameTeam
        ? `${trainer?.shortName} + ${d?.shortName}`
        : `${trainer?.shortName ?? "?"} / ${d?.shortName ?? "?"}`,
    },
  ];

  return { items, highlights };
}

export function driverScoreFromItems(items: ChecklistItem[]): number {
  return weightedAverage(items);
}
