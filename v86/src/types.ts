import type { TravsportHorseProfile } from "./travsport/types";

/** V85, V86 och Dagens Dubbel (ATG-nyckel `dd`). */
export type PoolGameType = "V85" | "V86" | "dd";
export type TravRuleId = "rule6";

export type TravCoverageGroupId =
  | "horseCore"
  | "technicalCore"
  | "expertConsensus"
  | "ratings"
  | "paceProfile";

export type TravCoverageStatus = "available" | "partial" | "missing";

export interface TravRuleCoverageGroup {
  id: TravCoverageGroupId;
  label: string;
  status: TravCoverageStatus;
  detail?: string;
  sourceCount?: number;
}

export interface AtgPayoutEntry {
  systems?: number | string;
  payout?: number;
  jackpot?: boolean;
}

export interface AtgPoolResult {
  payouts?: Record<string, AtgPayoutEntry>;
  winners?: number[] | { combination?: number[]; odds?: number }[];
  reserveOrder?: number[];
  systems?: number | string;
  value?: { amount?: number };
}

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
      result?: AtgPoolResult;
      payouts?: Record<string, number>;
      status?: string;
    }
  >;
  result?: {
    place?: number;
    finishOrder?: number;
    kmTime?: { minutes?: number; seconds?: number; tenths?: number };
    prizeMoney?: number;
    finalOdds?: number;
    startNumber?: number;
  };
}

export interface AtgRace {
  id: string;
  number: number;
  name?: string;
  distance?: number;
  startMethod?: string;
  startTime?: string;
  scheduledStartTime?: string;
  status?: string;
  date?: string;
  prize?: string;
  terms?: string[];
  track?: { id?: number; name?: string; condition?: string };
  starts: AtgStart[];
  result?: {
    victoryMargin?: string;
    scratchings?: number[];
  };
  pools?: Record<
    string,
    {
      result?: AtgPoolResult;
      status?: string;
      turnover?: number;
    }
  >;
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
      result?: AtgPoolResult;
      status?: string;
    }
  >;
}

export interface ChecklistItemView {
  id: string;
  category: "häst" | "kusk";
  label: string;
  score: number;
  weight: number;
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
  estimatedWinPct?: number;
  valueEdgePct?: number;
  marketRank?: number;
  projectedRank?: number;
  projectedFinishLabel?: string;
  confidencePct?: number;
  analystComment?: string;
  formTrend: "stigande" | "toppad" | "nedåtgående" | "okänd";
  tempoTripScore?: number;
  tempoTripStyle?: "front" | "closer" | "versatile" | "okänd";
  gallopRiskScore?: number;
  gallopRiskLevel?: "låg" | "medel" | "hög";
  highlights: string[];
  horseChecklist: ChecklistItemView[];
  driverChecklist: ChecklistItemView[];
  isSkrellCandidate: boolean;
  /** Senaste km-tider från Travsport, t.ex. ["1.14,3", "1.15,1", "1.16,0"] */
  recentKmTimes?: string[];
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
  bankabilityScore?: number;
  opennessScore?: number;
  tipNote?: string;
}

export interface SystemSelection {
  leg: number;
  picks: number[];
  type: "spik" | "skrell-spik" | "gardering";
  note?: string;
}

export interface SystemHitOutlook {
  fullRowHitPct: number;
  legs: Array<{
    leg: number;
    hitPct: number;
    picks: number[];
    selectionType: SystemSelection["type"];
  }>;
  biggestRisk: {
    leg: number;
    hitPct: number;
    reason: string;
  };
}

export interface BuiltSystem {
  gameId: string;
  gameType: PoolGameType;
  budgetKr: number;
  rows: number;
  costKr: number;
  estimatedPayoutNote: string;
  selections: SystemSelection[];
  skrellSpikeLeg: number | null;
  /** Modellens approximerade träffsannolikhet utifrån markeringarna */
  hitOutlook?: SystemHitOutlook;
}

export interface AndelsShareTip {
  name: string;
  costKr?: number;
  sharesLeft?: number;
  marks?: string;
  expert?: string;
  description?: string;
  url?: string;
}

export interface ExpertSignal {
  sourceId: string;
  sourceName: string;
  sourceType: "atg-share" | "news-tip" | "open-tip";
  sourceUrl?: string | null;
  publishedAt?: string | null;
  leg?: number | null;
  horseNumber?: number | null;
  horseName?: string | null;
  rankingLevel?: "top" | "contender" | "outsider" | "mention";
  consensusPoints: number;
  text: string;
}

export interface ExpertConsensusHorse {
  leg: number;
  horseNumber: number;
  horseName: string;
  sourceCount: number;
  consensusPoints: number;
  sourceNames: string[];
}

export interface SnapshotRaceStartData {
  startId: string;
  number: number;
  postPosition: number;
  scratched: boolean;
  distance?: number;
  horse?: AtgStart["horse"];
  driver?: AtgStart["driver"];
  pools?: AtgStart["pools"];
  result?: AtgStart["result"];
  travsportProfile?: TravsportHorseProfile | null;
  driverContext?: {
    driverId?: number | null;
    driverName: string;
    homeTrack?: string | null;
    pairedHorseStarts: number;
    pairedHorseWins: number;
  };
}

export interface SnapshotRaceData {
  leg: number;
  raceId: string;
  raceNumber: number;
  raceName?: string;
  status?: string;
  date?: string;
  startTime?: string;
  scheduledStartTime?: string;
  track?: AtgRace["track"];
  distance?: number;
  startMethod?: string;
  prize?: string;
  terms?: string[];
  result?: AtgRace["result"];
  scratchings?: number[];
  pools?: AtgRace["pools"];
  starts: SnapshotRaceStartData[];
}

export interface FetchSnapshot {
  fetchedAt: string;
  game: AtgGame;
  legs: LegAnalysis[];
  raceData?: SnapshotRaceData[];
  system: BuiltSystem;
  systemAlt?: BuiltSystem;
  andelsspel?: AndelsShareTip[];
  expertSignals?: ExpertSignal[];
  expertConsensus?: ExpertConsensusHorse[];
  travsportNotes?: string[];
  meta?: {
    poolStartLabel?: string;
    poolWeekday?: number | null;
    isSaturdayRound?: boolean;
    isWednesdayRound?: boolean;
    analysisModel?: string;
    travsportHorses?: number;
    predictionId?: string | null;
    analysisVersion?: number;
    analysisSavedAt?: string | null;
    learningPromptText?: string | null;
    historySaveError?: string | null;
    fullRaceDataStored?: boolean;
    fullRaceDataRaces?: number;
    fullRaceDataStarts?: number;
    recommendedPlay?: {
      mode: "auto-budget";
      budgetKr: number;
      opennessScore: number;
      reason: string;
    };
    source?: "live" | "historical-backtest";
    backtestDate?: string | null;
    rule?: {
      id: TravRuleId;
      label: string;
      version: string;
      usesMarketData: boolean;
      partialExpertMode?: boolean;
      expertSourceCount?: number;
      expertSignalCount?: number;
      expertSources?: Array<{
        id: string;
        name: string;
        status: TravCoverageStatus;
        signalCount: number;
        note: string;
      }>;
      coverage: TravRuleCoverageGroup[];
      missingDataNotes?: string[];
    };
  };
}
