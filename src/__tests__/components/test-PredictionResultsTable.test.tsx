import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PredictionResultsTable } from "@/components/PredictionResultsTable";
import type { PredictionRow } from "@/components/PredictionResultsTable";

const row: PredictionRow = {
  id: "p1",
  home_name: "AIK",
  away_name: "Djurgården",
  predicted_outcome: "H",
  predicted_score: "2-1",
  confidence: "medel",
  actual_outcome: "H",
  actual_home_score: 2,
  actual_away_score: 1,
  event_date: "2025-05-24T18:00:00Z",
  created_at: "2025-05-24T10:00:00Z",
  league_id: "swe.1",
  round: 10,
  btts_call: "ja",
  btts_reason: "Hög BTTS-form",
};

describe("PredictionResultsTable", () => {
  it("renderar tabellhuvud och matchrad", () => {
    render(<PredictionResultsTable rows={[row]} showBtts allowPending />);
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByText(/AIK/)).toBeInTheDocument();
    expect(screen.getByText(/Djurgården/)).toBeInTheDocument();
    expect(screen.getByText("ja")).toBeInTheDocument();
  });

  it("visar liga-kolumn när showLeague=true", () => {
    render(
      <PredictionResultsTable
        rows={[row]}
        showLeague
        leagueNameOf={(id) => (id === "swe.1" ? "Allsvenskan" : id)}
      />,
    );
    expect(screen.getByText("Allsvenskan")).toBeInTheDocument();
  });
});
