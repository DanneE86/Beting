import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/v86/regel-4")({
  component: Regel4Page,
});

function Regel4Page() {
  return (
    <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
      <h2 className="text-lg font-semibold text-[#d4f5e2]">Regel 4 är inaktiverad</h2>
      <p className="mt-2 text-sm text-[#b8f0d0]">
        Den här profilen är bortplockad eftersom den presterat sämre. Använd Regel 1 eller Regel 2.
      </p>
      <div className="mt-3 flex gap-3 text-sm">
        <Link to="/v86" className="text-[#5ec98a] hover:underline">Gå till Regel 1</Link>
        <Link to="/v86/regel-2" className="text-[#5ec98a] hover:underline">Gå till Regel 2</Link>
      </div>
    </Card>
  );
}
