import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Återanvändbar liga-väljare med "Alla ligor" som default-värde ("all").
 * Används på Lärdomar, Historik och Idag-tipsen där samma dropdown återkommer.
 */
export type LeagueOption = { id: string; label: string };

type Props = {
  value: string;
  onChange: (id: string) => void;
  options: LeagueOption[];
  allLabel?: string;
  placeholder?: string;
  className?: string;
  /** Dölj komponenten helt om det bara finns en liga (default false) */
  hideIfSingle?: boolean;
};

export function LeagueSelect({
  value,
  onChange,
  options,
  allLabel = "Alla ligor",
  placeholder = "Välj liga",
  className = "w-[240px]",
  hideIfSingle = false,
}: Props) {
  if (hideIfSingle && options.length <= 1) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
