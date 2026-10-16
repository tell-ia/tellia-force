import { describe, expect, it } from "vitest";
import {
  PARCEL_REPORT_VERSION,
  parseParcelReport,
  widgetJsonSchemas,
  widgetSchemas,
} from "./app";

describe("widget JSON schemas", () => {
  it("emits one JSON Schema per widget", () => {
    const schemas = widgetJsonSchemas();
    expect(Object.keys(schemas).sort()).toEqual(Object.keys(widgetSchemas).sort());
    for (const s of Object.values(schemas)) {
      expect(s).toBeTypeOf("object");
    }
  });
});

describe("parseParcelReport version tolerance", () => {
  it("rejects a mismatched schemaVersion instead of throwing", () => {
    expect(parseParcelReport({ schemaVersion: "v999" })).toBeNull();
    expect(parseParcelReport(null)).toBeNull();
    expect(parseParcelReport({ schemaVersion: PARCEL_REPORT_VERSION })).toBeNull(); // right version, invalid body
  });
});
