import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BttsDisplay } from "@/components/BttsDisplay";

describe("BttsDisplay", () => {
  it("visar streck utan call (badge)", () => {
    render(<BttsDisplay call={null} variant="badge" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("visar call som badge", () => {
    render(<BttsDisplay call="ja" variant="badge" />);
    expect(screen.getByText("ja")).toBeInTheDocument();
  });

  it("visar panel med reason", () => {
    render(<BttsDisplay call="nej" reason="Båda gör sällan mål" variant="panel" />);
    expect(screen.getByText(/Båda mål: NEJ/i)).toBeInTheDocument();
    expect(screen.getByText("Båda gör sällan mål")).toBeInTheDocument();
  });

  it("inline visar reason om den finns", () => {
    render(<BttsDisplay call="osäker" reason="Motstridiga signaler" variant="inline" />);
    expect(screen.getByText("Motstridiga signaler")).toBeInTheDocument();
  });
});
