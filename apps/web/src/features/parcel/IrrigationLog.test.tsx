import { describe, expect, it } from "vitest";
import { renderToString as ssr } from "react-dom/server";
import type { ReactElement } from "react";
import type { IrrigationRecord, ParcelSummary } from "@tellia/shared";
import { parseRoute } from "../../app/router";
import { FieldChips, LogDateRow } from "../log/LogScreen";
import { MonthCalendar } from "../../components/ui/DateField";
import { IrrigationLog } from "./IrrigationLog";

/** Server render without React's text separators ("<!-- -->"). */
const renderToString = (el: ReactElement): string => ssr(el).replace(/<!-- -->/g, "");

const rec = (operationId: number, date: string, mm: number): IrrigationRecord =>
  ({ operationId, fieldId: 10, date, mm, status: "confirmed" });

describe("IrrigationLog", () => {
  it("lists the saved waterings, newest first as given, with the date and mm", () => {
    const html = renderToString(
      <IrrigationLog records={[rec(2, "2026-07-14", 30), rec(1, "2026-06-21", 25)]} loading={false} error={null} onLog={() => {}} />,
    );
    expect(html).toContain("Irrigation log");
    expect(html).toContain("2 waterings");
    expect(html.indexOf("Tue 14 Jul 2026")).toBeLessThan(html.indexOf("Sun 21 Jun 2026"));
    expect(html).toContain("30 mm");
    expect(html).toContain("Log watering");
    expect(html).not.toContain("Show all");
  });

  it("shows the first 5 and a Show all button when there are more", () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((i) => rec(i, `2026-07-0${i}`, 10 + i));
    const html = renderToString(<IrrigationLog records={many} loading={false} error={null} onLog={() => {}} />);
    expect(html).toContain("Show all (7)");
    expect(html).toContain("Wed 1 Jul 2026");
    expect(html).not.toContain("Mon 6 Jul 2026");
  });

  it("says when nothing is logged, and shows load errors", () => {
    expect(renderToString(<IrrigationLog records={[]} loading={false} error={null} onLog={() => {}} />))
      .toContain("No watering logged on this field yet.");
    expect(renderToString(<IrrigationLog records={null} loading={false} error="HTTP 500" onLog={() => {}} />))
      .toContain("Couldn&#x27;t load the log: HTTP 500");
  });
});

describe("Log screen field chips", () => {
  const parcel = (id: number, name: string, status: ParcelSummary["status"]): ParcelSummary =>
    ({ id, name, cropName: "Maize", areaHa: 5, stageLabel: null, status, badgeLabel: "", netMm: null, reservePct: null, thresholdLabel: null });

  it("one chip per field, the picked one pressed, urgent fields marked", () => {
    const html = renderToString(
      <FieldChips parcels={[parcel(10, "La Vallée", "action"), parcel(11, "Le Puits", "ok")]} selected={11} disabled={false} onPick={() => {}} />,
    );
    expect(html).toContain("La Vallée");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Le Puits/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>La Vallée/);
    expect(html.match(/●/g)?.length).toBe(1);
  });
});

describe("routes", () => {
  it("#/log/:id opens the Log screen on a field; #/parcel/:id#log lands on its log", () => {
    expect(parseRoute("#/log/10")).toEqual({ name: "log", params: { id: "10" }, anchor: "" });
    expect(parseRoute("#/log")).toEqual({ name: "log", params: {}, anchor: "" });
    expect(parseRoute("#/parcel/10#log")).toEqual({ name: "parcel", params: { id: "10" }, anchor: "log" });
  });
});

describe("Log screen day of the watering", () => {
  it("the Date row is a date field showing the day (and says today)", () => {
    const today = renderToString(<LogDateRow day="2026-07-15" today="2026-07-15" min="2026-04-16" disabled={false} onChange={() => {}} />);
    expect(today).toContain("Wed 15 Jul 2026");
    expect(today).toContain(">today<");
    expect(today).toContain('aria-label="Day of the watering: Wed 15 Jul 2026"');
    const past = renderToString(<LogDateRow day="2026-07-14" today="2026-07-15" min="2026-04-16" disabled={false} onChange={() => {}} />);
    expect(past).toContain("Tue 14 Jul 2026");
    expect(past).not.toContain(">today<");
  });

  it("the popup calendar: Monday first, the day pressed, nothing after today, a Today button", () => {
    const html = renderToString(<MonthCalendar value="2026-07-14" min="2026-04-16" max="2026-07-15" today="2026-07-15" onPick={() => {}} />);
    expect(html).toContain("July 2026");
    // 1 July 2026 is a Wednesday: two empty cells before it.
    expect(html.match(/<span><\/span>/g)?.length).toBe(2);
    expect(html).toMatch(/aria-pressed="true" aria-label="Tue 14 Jul 2026"/);
    expect(html).toMatch(/disabled="" aria-pressed="false" aria-label="Thu 16 Jul 2026"/);
    expect(html).toContain(">Today<");
    // Next month is after today: its arrow is off.
    expect(html).toMatch(/aria-label="Next month" disabled=""/);
  });
});
