import { z } from "zod";
import { FarmSummarySchema, type FarmSummary } from "@tellia/shared";
import { mock } from "./core";
import farmsFixture from "../../fixtures/farms.json";

const FarmListSchema = z.array(FarmSummarySchema);

// MOCK: the persona list is curated app config (which farms to feature, their
// member id / avatar), enriched from GET /data/farm — not a pure backend read,
// so it stays app-owned even in live mode.
export async function listFarms(): Promise<FarmSummary[]> {
  return mock(FarmListSchema, farmsFixture);
}
