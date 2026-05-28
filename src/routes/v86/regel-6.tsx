import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-6")({
  component: Regel6Page,
});

function Regel6Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule6"
      title="Regel 6: förbättrad plusstrategi"
      description="Regel 6 är en förbättrad version av Regel 5, framtagen från 2026-loppen för bättre balans mellan månadsstabilitet och storvinstpotential."
      badgeText="Ny förbättrad regel"
      extraIntro={
        <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#d4f5e2]">Förbättrad från Regel 5</h3>
              <p className="mt-2 text-sm text-[#b8f0d0]">
                Regel 6 använder samma datagrund men med skarpare målprofil för jämnare
                månadsplus, samtidigt som hög utdelningsnivå fortsatt prioriteras.
              </p>
            </div>
            <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
              Regel 5 + optimering
            </Badge>
          </div>
        </Card>
      }
    />
  );
}
