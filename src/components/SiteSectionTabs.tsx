import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const linkClass =
  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors";

export function SiteSectionTabs({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-background/70 p-1",
        className,
      )}
    >
      <Link
        to="/"
        activeOptions={{ exact: true }}
        activeProps={{
          className: cn(linkClass, "bg-primary text-primary-foreground"),
        }}
        inactiveProps={{
          className: cn(linkClass, "text-muted-foreground hover:bg-secondary hover:text-foreground"),
        }}
      >
        <Activity className="size-4" />
        Fotboll
      </Link>
    </div>
  );
}
