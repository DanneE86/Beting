import { createFileRoute } from "@tanstack/react-router";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-4")({
  component: Regel4Page,
});

function Regel4Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule4"
      title="Regel 4: djup loppbild"
      description="Regel 4 bygger tips på djupare loppbild: senaste loppscenarion, formcykel, klassnivå, tempo/trip, galopprisk och hållbarhet över uppehåll/starttyp."
      badgeText="Loppbildsprofil"
    />
  );
}
