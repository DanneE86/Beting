import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProbBar } from "@/components/ProbBar";

describe("ProbBar", () => {
  it("renderar procentlabels", () => {
    render(<ProbBar home={50} draw={25} away={25} />);
    expect(screen.getByText(/1 · 50%/)).toBeInTheDocument();
    expect(screen.getByText(/X · 25%/)).toBeInTheDocument();
    expect(screen.getByText(/2 · 25%/)).toBeInTheDocument();
  });

  it("kan dölja labels", () => {
    render(<ProbBar home={40} draw={30} away={30} showLabels={false} />);
    expect(screen.queryByText(/1 ·/)).not.toBeInTheDocument();
  });
});
