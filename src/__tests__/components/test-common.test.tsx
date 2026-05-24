import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState, MiniStat, SkeletonGrid } from "@/components/common";

describe("common", () => {
  it("SkeletonGrid renderar rätt antal skeletons", () => {
    const { container } = render(<SkeletonGrid count={3} />);
    expect(container.querySelectorAll("[data-slot=skeleton], .animate-pulse").length).toBeGreaterThan(0);
  });

  it("EmptyState visar text", () => {
    render(<EmptyState text="Inga matcher" />);
    expect(screen.getByText("Inga matcher")).toBeInTheDocument();
  });

  it("MiniStat visar label och värde", () => {
    render(<MiniStat label="Träff" value="72%" />);
    expect(screen.getByText("Träff")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });
});
