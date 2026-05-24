import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  btts_reason:
    "BTTS Nej (båda gör mål 27%, hög säkerhet): Poisson/DC 48% · form 43% · ligasnitt 52%.",
};

const pendingRow: PredictionRow = {
  ...row,
  id: "p2",
  predicted_outcome: null,
  predicted_score: null,
  confidence: null,
  actual_outcome: null,
  actual_home_score: null,
  actual_away_score: null,
  btts_call: null,
  btts_reason: null,
  betting_tip: null,
  key_factors: null,
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

  it("visar Ja/Nej-% i expanderad BTTS-analys", async () => {
    const user = userEvent.setup();
    render(
      <PredictionResultsTable
        rows={[{ ...row, actual_outcome: null, actual_home_score: null, actual_away_score: null, btts_call: "nej" }]}
        showBtts
        allowPending
      />,
    );
    await user.click(screen.getByText(/Analys:/i));
    expect(screen.getAllByText(/Ja 27%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Nej 73%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Poisson\/DC 48%/)).toBeInTheDocument();
  });

  it("visar väntande match utan tips som —", () => {
    render(<PredictionResultsTable rows={[pendingRow]} showBtts allowPending />);
    expect(screen.getByText("Väntar")).toBeInTheDocument();
    expect(screen.getByText("Ingen analys sparad för detta tips ännu.")).toBeInTheDocument();
  });
});
