import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { Flag } from "lucide-react";

export const Route = createFileRoute("/v86")({
  component: V86Layout,
});

function V86Layout() {
  return (
    <div className="min-h-screen bg-[#0c1410] text-[#e8f0ea]">
      <header className="sticky top-0 z-10 border-b border-[#1e3d2a]/80 bg-[#0f1a14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a5c38] text-[#b8f0d0]">
              <Flag className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-semibold tracking-tight text-[#d4f5e2]">
                Travsystem & hästar
              </h1>
              <p className="text-xs text-[#7fa892]">
                V85, V86 och travregler
              </p>
            </div>
          </div>
          <Link to="/" className="text-sm text-[#7fa892] transition-colors hover:text-[#b8f0d0]">
            ← Tillbaka till PitchData
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <Toaster richColors position="top-center" />
    </div>
  );
}
