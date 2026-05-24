import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchDateTime } from "@/components/MatchDateTime";

describe("MatchDateTime", () => {
  it("returnerar null utan värde", () => {
    const { container } = render(<MatchDateTime value={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("visar tid och datum (sv-SE)", () => {
    render(<MatchDateTime value="2025-05-24T14:30:00Z" variant="time-date" />);
    const text = screen.getByText(/·/);
    expect(text.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("lägger till suffix", () => {
    render(
      <MatchDateTime
        value="2025-05-24T14:30:00Z"
        variant="date"
        suffix="Omg. 12"
      />,
    );
    expect(screen.getByText(/Omg\. 12/)).toBeInTheDocument();
  });
});
