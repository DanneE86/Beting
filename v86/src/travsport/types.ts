export interface TravsportStartRow {
  date: string;
  displayDate: string;
  trackCode: string;
  raceNumber: number;
  placement: number | null;
  placementDisplay: string;
  resultCode: string;
  kmTime: string | null;
  kmTimeSeconds: number | null;
  startPosition: number | null;
  distance: number | null;
  startMethod: string;
  trackCondition: string;
  driverId: number | null;
  driverName: string;
  trainerId: number | null;
  trainerName: string;
  odds: string;
  shoeCode: string;
  withdrawn: boolean;
  galloped: boolean;
  disqualified: boolean;
  tripComment?: string;
}

export interface TravsportTempoTripProfile {
  sampleSize: number;
  earlySpeedScore: number;
  closingSpeedScore: number;
  versatilityScore: number;
  profileScore: number;
  style: "front" | "closer" | "versatile" | "okänd";
  note: string;
}

export interface TravsportGallopProfile {
  sampleSize: number;
  gallopStarts: number;
  gallopRate: number;
  recentGallopRate: number;
  stabilityScore: number;
  riskLevel: "låg" | "medel" | "hög";
  note: string;
}

export interface TravsportSurfaceStat {
  condition: string;
  starts: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
}

export interface TravsportMethodBucket {
  starts: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
}

export interface TravsportMethodSplit {
  auto: TravsportMethodBucket;
  volt: TravsportMethodBucket;
}

export interface TravsportTrackStat {
  trackCode: string;
  starts: number;
  wins: number;
  top3: number;
  winRate: number;
  top3Rate: number;
}

export interface TravsportDriverTripProfile {
  /** Starter med denna kusk där hästen startade från spår ≥8 (bakspår) */
  backLaneStarts: number;
  backLaneWins: number;
  backLaneTop3: number;
  /** Starter med denna kusk där hästen startade från spår 1–4 (framspår) */
  frontLaneStarts: number;
  frontLaneWins: number;
  frontLaneTop3: number;
  /** "closer" = bättre bakifrån, "front" = bättre framme, "versatile" = jämnt, "okänd" = för lite data */
  driverStyle: "closer" | "front" | "versatile" | "okänd";
  /** Leverans som favorit (betDistribution-proxy via odds ≤ 2.5) */
  favoriteStarts: number;
  favoriteWins: number;
}

export interface TravsportHorseProfile {
  horseId: number;
  name?: string;
  fetchedAt: string;
  starts: TravsportStartRow[];
  /** Senaste 6 avslutade starter */
  recentStarts: TravsportStartRow[];
  formTrend: "stigande" | "toppad" | "nedåtgående" | "okänd";
  daysSinceLastStart: number | null;
  trackWins: number;
  trackStarts: number;
  driverPairStarts: number;
  driverPairWins: number;
  /** Kuskens trip-profil med denna häst (spurter vs framspårare) */
  driverTripProfile?: TravsportDriverTripProfile;
  tempoTripProfile: TravsportTempoTripProfile;
  gallopProfile: TravsportGallopProfile;
  /** Hästens historik per underlagstyp (light/normal/heavy/winter) */
  surfaceHistory: TravsportSurfaceStat[];
  /** Kusk+häst-parets prestanda uppdelat på volt vs auto */
  driverMethodSplit?: TravsportMethodSplit;
  /** Tränarens banspecifika statistik beräknad från hästens starter */
  trainerTrackStats: TravsportTrackStat[];
}

export type TravsportIndex = Record<number, TravsportHorseProfile>;
