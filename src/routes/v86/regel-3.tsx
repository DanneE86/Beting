import { createFileRoute } from "@tanstack/react-router";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-3")({
  component: Regel3Page,
});

function Regel3Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule3"
      title="Regel 3: expert analys"
      description="Regel 3 bygger på samma kärndata som Regel 1 men lägger till teknisk tolkning, strukturerad expertdata och tydlig coverage-status när någon signalgrupp saknas."
      badgeText="Expertprofil"
    />
  );
}
