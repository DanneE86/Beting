import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-2")({
  component: Regel2Page,
});

function Regel2Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule2"
      title="Regel 2: ordinarie regel"
      description="Detta är den tidigare standardregeln före den marknadsfria ändringen. Den väger åter in spelprocent och edge i analys och systembygge för att fungera som jämförelse mot Regel 1."
      badgeText="Referensregel"
      extraIntro={
        <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#d4f5e2]">Jämförelseprofil</h3>
              <p className="mt-2 text-sm text-[#b8f0d0]">
                Här kan du köra samma omgång med den gamla ordinarie logiken och direkt se
                skillnaden mot Regel 1. Historik, backtest och lärprompt hålls separata per regel.
              </p>
            </div>
            <Badge variant="outline" className="border-[#66522a] text-[#f0c674]">
              Marknadssignaler aktiva
            </Badge>
          </div>
        </Card>
      }
    />
  );
}
