import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TravRuleDashboardPage } from "./index";

export const Route = createFileRoute("/v86/regel-1")({
  component: Regel1Page,
});

function Regel1Page() {
  return (
    <TravRuleDashboardPage
      ruleId="rule1"
      title="Regel 1: ej marknad"
      description="Den marknadsfria regeln bygger rank och system utan att luta sig mot spelprocent. Analysen styrs av hästdata, kuskdata, form, spår, bana, distans och Travsport-signaler."
      badgeText="Alternativ regel"
      extraIntro={
        <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-[#d4f5e2]">Marknadsfri profil</h3>
              <p className="mt-2 text-sm text-[#b8f0d0]">
                Använd den här sidan när du vill jämföra mot en ren dataprofil utan marknadsviktning.
              </p>
            </div>
            <Badge variant="outline" className="border-[#66522a] text-[#f0c674]">
              Ingen marknadsvikt
            </Badge>
          </div>
        </Card>
      }
    />
  );
}
