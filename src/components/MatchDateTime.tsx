/**
 * Återanvändbar komponent som visar matchens tid och datum.
 * Används i "Dagens matcher", live-kort och alla andra ställen där en
 * matchtid behöver presenteras med tillhörande datum bredvid.
 */
type Props = {
  /** ISO-sträng eller annat Date-tolkbart värde */
  value?: string | number | Date | null;
  /** "time-date" (default): "10:10 · lör 23 maj" — tid först, datum efter */
  /** "date-time": "lör 23 maj · 10:10" */
  /** "date": bara datum */
  /** "time": bara tid */
  variant?: "time-date" | "date-time" | "date" | "time";
  /** Extra text efter datum/tid (t.ex. "Omg. 12") */
  suffix?: string | null;
  className?: string;
};

export function MatchDateTime({
  value,
  variant = "time-date",
  suffix,
  className,
}: Props) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;

  const time = d.toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  let text = "";
  switch (variant) {
    case "time":
      text = time;
      break;
    case "date":
      text = date;
      break;
    case "date-time":
      text = `${date} · ${time}`;
      break;
    case "time-date":
    default:
      text = `${time} · ${date}`;
  }
  if (suffix) text += ` · ${suffix}`;

  return <span className={className}>{text}</span>;
}
