export interface TravsportStartRow {
  date: string;
  displayDate: string;
  trackCode: string;
  raceNumber: number;
  placement: number | null;
  placementDisplay: string;
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
}

export type TravsportIndex = Record<number, TravsportHorseProfile>;
