import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Delade UI-atomer som används på flera flikar.
 * Hålls här så de kan återanvändas över hela appen.
 */

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <Card className="p-10 text-center text-muted-foreground">{text}</Card>
  );
}

export function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-secondary/40 rounded px-2 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-display text-base mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}
