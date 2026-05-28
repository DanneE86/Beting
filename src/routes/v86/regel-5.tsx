import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-5")({
  component: Regel5Page,
});

function Regel5Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule5"
      title="Regel 5: målstyrd plusstrategi"
      description="Regel 5 prioriterar månadsstabil plusprofil med målet minst +10 000 kr per månad, samtidigt som den bibehåller chans på stora utdelningar över 100 000 kr och miljonutfall."
      badgeText="Målstyrd regel"
      extraIntro={
        <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#d4f5e2]">Kravprofil i Regel 5</h3>
              <p className="mt-2 text-sm text-[#b8f0d0]">
                Den här profilen styrs mot positivt månadsnetto men tillater fortfarande hög
                varians där datan stödjer scenarion med mycket hög utdelning.
              </p>
            </div>
            <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
              +10k/månad + storvinstfokus
            </Badge>
          </div>
        </Card>
      }
    />
  );
}
