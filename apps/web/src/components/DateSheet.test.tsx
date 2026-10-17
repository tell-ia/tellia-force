import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DateProvider } from "../app/DateContext";
import { localToday, formatDay } from "../lib/dates";
import { DATE_PRESETS, DateButton, DateSheet } from "./DateSheet";

// Server-side render: effects do not run, so the API state is not loaded yet (the offline case).

describe("DateSheet", () => {
  it("shows the presets, the date input and the offline message", () => {
    const html = renderToString(
      <DateProvider>
        <DateSheet onClose={() => {}} />
      </DateProvider>,
    );
    expect(html).toContain("Demo date");
    expect(html).toContain('type="date"');
    for (const p of DATE_PRESETS) {
      expect(html).toContain(p.title);
      expect(html).toContain(formatDay(p.date));
    }
    expect(html).toContain("Real date");
    expect(html).toContain("the date can&#x27;t change");
  });

  it("the date button shows the device date before the API answers", () => {
    const html = renderToString(
      <DateProvider>
        <DateButton />
      </DateProvider>,
    );
    expect(html).toContain(formatDay(localToday()));
  });

  it("presets are real days in the weather range", () => {
    for (const p of DATE_PRESETS) expect(p.date >= "2015-01-01").toBe(true);
  });
});
