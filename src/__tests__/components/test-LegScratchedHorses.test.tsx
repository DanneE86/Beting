import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LegScratchedHorses } from "@/components/LegScratchedHorses";

describe("LegScratchedHorses", () => {
  it("renderar inget när inga är strukna", () => {
    const { container } = render(
      <LegScratchedHorses
        starts={[
          { startId: "1", number: 1, postPosition: 1, scratched: false },
          { startId: "2", number: 2, postPosition: 2, scratched: false },
        ]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("visar strukna med nummer och namn", () => {
    render(
      <LegScratchedHorses
        starts={[
          {
            startId: "1",
            number: 4,
            postPosition: 4,
            scratched: true,
            horse: { id: 10, name: "Stjärnhästen" },
            driver: { shortName: "J. Kusk" },
          },
        ]}
      />,
    );
    expect(screen.getByText(/Strukna \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/4 Stjärnhästen/)).toBeInTheDocument();
    expect(screen.getByText(/J\. Kusk/)).toBeInTheDocument();
  });

  it("tar med scratchings-nummer som fallback", () => {
    render(
      <LegScratchedHorses starts={[]} scratchingNumbers={[7, 9]} />,
    );
    expect(screen.getByText(/Strukna \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/nr 7/)).toBeInTheDocument();
    expect(screen.getByText(/nr 9/)).toBeInTheDocument();
  });

  it("compact visar en rad under markeringar", () => {
    render(
      <LegScratchedHorses
        variant="compact"
        starts={[
          {
            startId: "1",
            number: 3,
            postPosition: 3,
            scratched: true,
            horse: { id: 1, name: "Bella" },
          },
        ]}
      />,
    );
    expect(screen.getByText(/Strukna:/)).toBeInTheDocument();
    expect(screen.getByText(/3 Bella/)).toBeInTheDocument();
    expect(screen.queryByText(/Strukna \(1\)/)).not.toBeInTheDocument();
  });
});
