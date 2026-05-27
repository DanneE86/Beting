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
  tempoTripProfile: TravsportTempoTripProfile;
  gallopProfile: TravsportGallopProfile;
}

export type TravsportIndex = Record<number, TravsportHorseProfile>;
