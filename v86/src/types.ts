/** V85 (lördag) + Dagens Dubbel (ATG-nyckel `dd`). */
export type PoolGameType = "V85" | "dd";

export interface AtgStart {
  id: string;
  number: number;
  postPosition: number;
  distance?: number;
  scratched: boolean;
  horse?: {
    id: number;
    name: string;
    age?: number;
    sex?: string;
    record?: {
      code?: string;
      startMethod?: string;
      distance?: string;
      time?: { minutes?: number; seconds?: number; tenths?: number };
    };
    trainer?: {
      id?: number;
      shortName?: string;
      firstName?: string;
      lastName?: string;
      statistics?: {
        years?: Record<
          string,
          { starts?: number; winPercentage?: number; placement?: Record<string, number> }
        >;
      };
    };
    shoes?: {
      reported?: boolean;
      front?: { hasShoe?: boolean; changed?: boolean };
      back?: { hasShoe?: boolean; changed?: boolean };
    };
    sulky?: {
      reported?: boolean;
      type?: { code?: string; text?: string; changed?: boolean };
      colour?: { code?: string; text?: string; changed?: boolean };
    };
    homeTrack?: { id?: number; name?: string };
    pedigree?: {
      father?: { name?: string };
      mother?: { name?: string };
    };
    statistics?: {
      years?: Record<
        string,
        {
          starts?: number;
          placement?: Record<string, number>;
          records?: {
            place?: number;
            startMethod?: string;
            distance?: string;
            time?: { minutes?: number; seconds?: number; tenths?: number };
          }[];
          winPercentage?: number;
        }
      >;
      life?: {
        winPercentage?: number;
        placePercentage?: number;
        earningsPerStart?: number;
        starts?: number;
        records?: {
          place?: number;
          startMethod?: string;
          distance?: string;
          time?: { minutes?: number; seconds?: number; tenths?: number };
          year?: string;
        }[];
      };
      lastFiveStarts?: { averageOdds?: number };
    };
  };
  driver?: {
    id?: number;
    shortName?: string;
    firstName?: string;
    lastName?: string;
    homeTrack?: { name?: string };
    statistics?: {
      years?: Record<
        string,
        {
          starts?: number;
          winPercentage?: number;
          placement?: Record<string, number>;
        }
      >;
    };
  };
  pools?: Record<
    string,
    {
      betDistribution?: number;
      odds?: number;
      minOdds?: number;
      maxOdds?: number;
      trend?: number;
    }
  >;
}

export interface AtgRace {
  id: string;
  number: number;
  name?: string;
  distance?: number;
  startMethod?: string;
  track?: { id?: number; name?: string; condition?: string };
  starts: AtgStart[];
}

export interface AtgGame {
  id: string;
  type: PoolGameType;
  status: string;
  races: AtgRace[];
  pools?: Record<
    string,
    {
      turnover?: number;
      systemCount?: number;
      payouts?: Record<string, number>;
      jackpotAmount?: number;
    }
  >;
}

export interface ChecklistItemView {
  id: string;
  category: "häst" | "kusk";
  label: string;
  score: number;
  available: boolean;
  note: string;
}

export interface ScoredHorse {
  number: number;
  name: string;
  driver: string;
  betDistribution: number;
  winOdds: number | null;
  winPct: number;
  earningsPerStart: number;
  formScore: number;
  valueScore: number;
  horseScore: number;
  driverScore: number;
  combinedScore: number;
  formTrend: "stigande" | "toppad" | "nedåtgående" | "okänd";
  highlights: string[];
  horseChecklist: ChecklistItemView[];
  driverChecklist: ChecklistItemView[];
  isSkrellCandidate: boolean;
}

export interface LegAnalysis {
  leg: number;
  raceId: string;
  track: string;
  raceName?: string;
  horses: ScoredHorse[];
  favorite: ScoredHorse;
  skrellSpike: ScoredHorse | null;
  recommendation: "spik" | "gardering" | "bred";
  tipNote?: string;
}

export interface SystemSelection {
  leg: number;
  picks: number[];
  type: "spik" | "skrell-spik" | "gardering";
  note?: string;
}

export interface BuiltSystem {
  gameId: string;
  gameType: PoolGameType;
  budgetKr: number;
  rows: number;
  costKr: number;
  targetMinPayoutKr: number;
  estimatedPayoutNote: string;
  selections: SystemSelection[];
  skrellSpikeLeg: number | null;
}

export interface AndelsShareTip {
  name: string;
  costKr?: number;
  sharesLeft?: number;
  marks?: string;
  expert?: string;
  url?: string;
}

export interface FetchSnapshot {
  fetchedAt: string;
  game: AtgGame;
  legs: LegAnalysis[];
  system: BuiltSystem;
  andelsspel?: AndelsShareTip[];
  travsportNotes?: string[];
  meta?: {
    poolStartLabel?: string;
    poolWeekday?: number | null;
    isSaturdayRound?: boolean;
    analysisModel?: string;
    travsportHorses?: number;
  };
}
