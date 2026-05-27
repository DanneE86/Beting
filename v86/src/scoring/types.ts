export interface ChecklistItem {
  id: string;
  category: "häst" | "kusk";
  label: string;
  /** 0–1, högre = bättre för vinstchans */
  score: number;
  weight: number;
  available: boolean;
  note: string;
}

export interface HorseDriverScores {
  horseItems: ChecklistItem[];
  driverItems: ChecklistItem[];
  horseScore: number;
  driverScore: number;
  combinedScore: number;
  formTrend: "stigande" | "toppad" | "nedåtgående" | "okänd";
  highlights: string[];
  tempoTripScore?: number;
  tempoTripStyle?: "front" | "closer" | "versatile" | "okänd";
  gallopRiskScore?: number;
  gallopRiskLevel?: "låg" | "medel" | "hög";
}
