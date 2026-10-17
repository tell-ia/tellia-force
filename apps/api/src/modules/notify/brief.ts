// Today's brief as an SMS: the same advice and words as the app's Today screen. Pure.
import type { FieldReport } from "@tellia/shared/irrigation";

const day = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

/** "Wed 15 Jul" */
const shortDate = (iso: string) => `${day(iso, { weekday: "short" })} ${day(iso, { day: "numeric", month: "short" })}`;

/** Fields to water: equipped, and the advice says today or by a date (the Today screen's "action"). */
const toWater = (r: FieldReport) =>
  r.irrigable && (r.decision === "irrigate_today" || r.decision === "plan_irrigation");

export function briefText(
  input: { farmName: string; firstName: string; asOf: string; reports: FieldReport[] },
): string {
  const act = input.reports.filter(toWater);
  const greeting = `Good morning, ${input.firstName || "there"}. ` +
    (act.length === 0
      ? "Nothing urgent today: all fields on track."
      : act.length === 1
      ? "One field needs water:"
      : `${act.length} fields need water:`);
  const lines = act.map((r) => {
    const when = r.decision === "irrigate_today" || !r.irrigateBy ? "today" : `by ${shortDate(r.irrigateBy)}`;
    return `- ${r.fieldName}: ${r.irrigateGrossMm} mm ${when}`;
  });
  return [
    `Tellia · ${input.farmName} · ${shortDate(input.asOf)}`,
    greeting,
    ...lines,
    "Reply here to log a watering or ask a question.",
  ].join("\n");
}
