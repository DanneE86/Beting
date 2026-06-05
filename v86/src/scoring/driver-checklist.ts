import type { AtgRace, AtgStart } from "../types";
import type { TravsportHorseProfile } from "../travsport/types";
import type { ChecklistItem } from "./types";
import { pctFromAtg, weightedAverage } from "./utils";

export function scoreDriverChecklist(
  start: AtgStart,
  race: AtgRace,
  betDistributionPct = 0,
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
  const place25 =
    starts25 > 0
      ? ((y2025?.placement?.["1"] ?? 0) +
          (y2025?.placement?.["2"] ?? 0) +
          (y2025?.placement?.["3"] ?? 0)) /
        starts25
      : 0;

  const formScore = Math.min(1, win26 / 20);
  const trendAvailable = win25 > 0 && win26 > 0 && starts26 >= 10;
  const trendScore = trendAvailable
    ? Math.min(1, Math.max(0.3, 0.5 + (win26 - win25) / 30 + (place26 - place25) * 0.3))
    : starts26 >= 5
      ? Math.min(0.75, win26 / 18)
      : 0.5;

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
  const isVoltRace = raceMethod.toLowerCase().includes("volt");
  const methodBucket = isVoltRace
    ? travsport?.driverMethodSplit?.volt
    : travsport?.driverMethodSplit?.auto;
  const methodScore =
    methodBucket && methodBucket.starts >= 3
      ? Math.min(1, 0.35 + methodBucket.winRate * 1.5)
      : 0.6;
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

  // --- Kusk trip-profil: spurter vs framspårare ---
  const dtp = travsport?.driverTripProfile;
  const currentPost = (race as { starts?: Array<{ postPosition?: number; number?: number }> })
    .starts?.find((s) => s.number === start.number)?.postPosition
    ?? (start.postPosition ?? start.number ?? 5);
  const isBackLane = currentPost >= 8;
  const isFrontLane = currentPost <= 4;

  // Spurter-poäng: hur bra klarar kusken bakspår med denna häst?
  let spurtScore = 0.5;
  if (dtp && dtp.backLaneStarts >= 2) {
    const backWinRate = dtp.backLaneWins / dtp.backLaneStarts;
    const backTop3Rate = dtp.backLaneTop3 / dtp.backLaneStarts;
    spurtScore = Math.min(1, 0.35 + backWinRate * 0.9 + backTop3Rate * 0.35);
  }

  // Framspår-poäng
  let frontScore = 0.5;
  if (dtp && dtp.frontLaneStarts >= 2) {
    const frontWinRate = dtp.frontLaneWins / dtp.frontLaneStarts;
    const frontTop3Rate = dtp.frontLaneTop3 / dtp.frontLaneStarts;
    frontScore = Math.min(1, 0.35 + frontWinRate * 0.9 + frontTop3Rate * 0.35);
  }

  // Stil-matchning: ger bonus/malus baserat på om hästens spår matchar kuskens starka sida
  let stylMatchScore = 0.55;
  if (dtp && dtp.driverStyle !== "okänd") {
    if (dtp.driverStyle === "closer" && isBackLane) stylMatchScore = Math.max(spurtScore, 0.70);
    else if (dtp.driverStyle === "closer" && isFrontLane) stylMatchScore = Math.min(spurtScore, 0.45);
    else if (dtp.driverStyle === "front" && isFrontLane) stylMatchScore = Math.max(frontScore, 0.70);
    else if (dtp.driverStyle === "front" && isBackLane) stylMatchScore = Math.min(frontScore, 0.40);
    else stylMatchScore = 0.62;
  }

  // Favoritlåverans: hur bra levererar kusken när hästen är hårt streckad?
  let favDeliveryScore = favScore;
  if (dtp && dtp.favoriteStarts >= 3) {
    const favDelivery = dtp.favoriteWins / dtp.favoriteStarts;
    // Blend: 50% historisk leverans med denna häst, 50% generell kusk-form
    favDeliveryScore = Math.min(1, favDelivery * 0.5 + favScore * 0.5);
  }

  if (win26 >= 18) highlights.push(`Kusk het (${win26.toFixed(0)}% vinst)`);
  if (sameTeam) highlights.push("Kusk/tränare samma team");
  if (betDistributionPct >= 20 && win26 >= 15) highlights.push("Levererar ofta som favorit");
  if (pairStarts >= 2 && pairWins >= 1)
    highlights.push(`Kusk+häst: ${pairWins}/${pairStarts} (Travsport)`);
  if (dtp?.driverStyle === "closer" && isBackLane && dtp.backLaneStarts >= 2)
    highlights.push(`Spurter bakifrån: ${dtp.backLaneWins}/${dtp.backLaneStarts} segrar (spår ${currentPost})`);
  if (dtp?.driverStyle === "front" && isBackLane && dtp.frontLaneStarts >= 2)
    highlights.push(`Framspårskusk i yttre spår — sämre matchning (spår ${currentPost})`);
  if (dtp && dtp.favoriteStarts >= 3 && dtp.favoriteWins / dtp.favoriteStarts >= 0.5 && betDistributionPct >= 30)
    highlights.push(`Levererar som favorit (${dtp.favoriteWins}/${dtp.favoriteStarts} odds ≤ 2.5)`);

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
      available: win25 > 0 && win26 > 0 && starts26 >= 5,
      note: trendAvailable
        ? `${win25.toFixed(1)}%→${win26.toFixed(1)}% vinst, plats ${(place25 * 100).toFixed(0)}%→${(place26 * 100).toFixed(0)}%`
        : starts26 >= 5
          ? `2026: ${win26.toFixed(1)}% vinst (för få starter för trend)`
          : "För få starter 2026",
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
      note: (() => {
        const methodPart = methodBucket && methodBucket.starts >= 3
          ? `${isVoltRace ? "volt" : "auto"} ${methodBucket.wins}/${methodBucket.starts} (${Math.round(methodBucket.winRate * 100)}%)`
          : `${raceMethod} (för lite data)`;
        return `${trackName} · ${methodPart}`;
      })(),
    },
    {
      id: "driving_style",
      category: "kusk",
      label: "Körstil (spår-matchning)",
      score: stylMatchScore,
      weight: dtp?.driverStyle !== "okänd" ? 1.1 : 0.3,
      available: dtp != null && dtp.driverStyle !== "okänd",
      note: dtp
        ? `${dtp.driverStyle} | spår ${currentPost} | bak ${dtp.backLaneTop3}/${dtp.backLaneStarts} t3, fram ${dtp.frontLaneTop3}/${dtp.frontLaneStarts} t3`
        : "Körstil ej beräknad (för lite data)",
    },
    {
      id: "spurt_ability",
      category: "kusk",
      label: "Spurter/bakifrånförmåga",
      score: isBackLane ? spurtScore : frontScore,
      weight: isBackLane ? 1.2 : 0.6,
      available: dtp != null && (isBackLane ? dtp.backLaneStarts >= 2 : dtp.frontLaneStarts >= 2),
      note: isBackLane
        ? `Bakspår (${currentPost}): ${dtp?.backLaneWins ?? 0}/${dtp?.backLaneStarts ?? 0} segrar med kusken`
        : `Framspår (${currentPost}): ${dtp?.frontLaneWins ?? 0}/${dtp?.frontLaneStarts ?? 0} segrar med kusken`,
    },
    {
      id: "favorite_delivery",
      category: "kusk",
      label: "Som favorit/streckad",
      score: favDeliveryScore,
      weight: betDistributionPct >= 30 ? 1.4 : betDistributionPct >= 15 ? 1.1 : 0.6,
      available: betDistributionPct > 0,
      note: dtp && dtp.favoriteStarts >= 2
        ? `${betDistributionPct.toFixed(1)}% streckning | odds≤2.5-hist: ${dtp.favoriteWins}/${dtp.favoriteStarts}`
        : `${betDistributionPct.toFixed(1)}% av spelet`,
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
