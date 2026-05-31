import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FootballSimpleTip } from "@/components/FootballSimpleTip";

describe("FootballSimpleTip", () => {
  // ─── Grundläggande rendering ──────────────────────────────────────────────

  it("renderar utan props utöver tip", () => {
    render(<FootballSimpleTip tip="1" />);
    // Fallback-layout visas när inga probs skickas
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("visar alla tre sannolikheter när homeWinPct/drawPct/awayWinPct finns", () => {
    render(
      <FootballSimpleTip
        tip="1"
        homeWinPct={55}
        drawPct={25}
        awayWinPct={20}
      />,
    );
    expect(screen.getByText("55%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("markerar rätt tecken med TIPS-etikett", () => {
    render(
      <FootballSimpleTip
        tip="2"
        homeWinPct={30}
        drawPct={25}
        awayWinPct={45}
      />,
    );
    expect(screen.getByText("▲ TIPS")).toBeInTheDocument();
  });

  it("visar lagnamn när de skickas med", () => {
    render(
      <FootballSimpleTip
        tip="1"
        homeWinPct={60}
        drawPct={25}
        awayWinPct={15}
        homeName="Manchester City"
        awayName="Arsenal"
      />,
    );
    // Visar sista ordet av lagnamnet
    expect(screen.getByText(/City/)).toBeInTheDocument();
    expect(screen.getByText(/Arsenal/)).toBeInTheDocument();
  });

  // ─── BTTS ─────────────────────────────────────────────────────────────────

  it("visar BTTS JA-label för call=ja", () => {
    render(<FootballSimpleTip tip="1" bttsCall="ja" />);
    expect(screen.getByText(/Båda lagen gör mål/i)).toBeInTheDocument();
  });

  it("visar BTTS NEJ-label för call=nej", () => {
    render(<FootballSimpleTip tip="X" bttsCall="nej" />);
    expect(screen.getByText(/Båda lagen gör mål/i)).toBeInTheDocument();
  });

  it("visar BTTS-procent bredvid label", () => {
    render(<FootballSimpleTip tip="1" bttsCall="ja" bttsPct={68} />);
    expect(screen.getByText(/68%/)).toBeInTheDocument();
  });

  it("visar bttsReason-text", () => {
    render(
      <FootballSimpleTip
        tip="1"
        bttsCall="ja"
        bttsReason="Poisson/DC 65% · form 70%."
      />,
    );
    expect(screen.getByText(/Poisson\/DC 65%/)).toBeInTheDocument();
  });

  // ─── xG / Lambda ──────────────────────────────────────────────────────────

  it("visar xG-lambdas när de finns", () => {
    render(<FootballSimpleTip tip="1" lamH={1.85} lamA={0.92} />);
    expect(screen.getByText(/xG-hem/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.85/)).toBeInTheDocument();
    expect(screen.getByText(/xG-bort/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.92/)).toBeInTheDocument();
  });

  it("döljer xG-sektion om lambdas saknas", () => {
    render(<FootballSimpleTip tip="1" />);
    expect(screen.queryByText(/xG-hem/i)).not.toBeInTheDocument();
  });

  // ─── Förklaringar / keyFactors ────────────────────────────────────────────

  it('visar "Varför detta tips?" med keyFactors', () => {
    render(
      <FootballSimpleTip
        tip="1"
        keyFactors={[
          "Form: WWDWW",
          "Hemma-fördel 1.22",
          "Marknad: 1=55% X=25% 2=20%",
        ]}
      />,
    );
    expect(screen.getByText(/Varför detta tips\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Form: WWDWW/)).toBeInTheDocument();
    expect(screen.getByText(/Hemma-fördel/)).toBeInTheDocument();
  });

  it("döljer keyFactors-sektion om array är tom", () => {
    render(<FootballSimpleTip tip="1" keyFactors={[]} />);
    expect(screen.queryByText(/Varför detta tips\?/i)).not.toBeInTheDocument();
  });

  it("visar max 5 keyFactors", () => {
    const factors = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"];
    render(<FootballSimpleTip tip="1" keyFactors={factors} />);
    expect(screen.queryByText("f6")).not.toBeInTheDocument();
    expect(screen.queryByText("f7")).not.toBeInTheDocument();
  });

  // ─── Konfidens ────────────────────────────────────────────────────────────

  it("visar konfidens när den finns", () => {
    render(
      <FootballSimpleTip
        tip="1"
        homeWinPct={60}
        drawPct={25}
        awayWinPct={15}
        confidence="hög"
      />,
    );
    expect(screen.getByText(/hög konfidens/i)).toBeInTheDocument();
  });

  it("visar medel-konfidens korrekt", () => {
    render(
      <FootballSimpleTip
        tip="X"
        homeWinPct={35}
        drawPct={35}
        awayWinPct={30}
        confidence="medel"
      />,
    );
    expect(screen.getByText(/medel konfidens/i)).toBeInTheDocument();
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it("kraschar inte med null/undefined bttsCall", () => {
    expect(() =>
      render(<FootballSimpleTip tip="1" bttsCall={null} />),
    ).not.toThrow();
  });

  it("kraschar inte med undefined bttsReason", () => {
    expect(() =>
      render(<FootballSimpleTip tip="2" bttsCall="ja" bttsReason={undefined} />),
    ).not.toThrow();
  });

  it("kraschar inte med 0-värden för probs", () => {
    expect(() =>
      render(<FootballSimpleTip tip="X" homeWinPct={0} drawPct={100} awayWinPct={0} />),
    ).not.toThrow();
  });

  it("hanterar X-tips korrekt", () => {
    render(
      <FootballSimpleTip
        tip="X"
        homeWinPct={30}
        drawPct={40}
        awayWinPct={30}
      />,
    );
    expect(screen.getByText("▲ TIPS")).toBeInTheDocument();
    // X-segmentet ska vara highlighted
    expect(screen.getByText("40%")).toBeInTheDocument();
  });
});
