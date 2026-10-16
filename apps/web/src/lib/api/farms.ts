import { z } from "zod";
import { FarmSummarySchema, type FarmSummary } from "@tellia/shared";
import { mock } from "./core";
import { list } from "./data";
import farmsFixture from "../../fixtures/farms.json";

const FarmListSchema = z.array(FarmSummarySchema);

// Readable region names for the demo NUTS3 codes (fallback = the raw code).
const REGION: Record<string, string> = {
  FRB06: "Loiret",
  ES418: "Valladolid",
  ITH55: "Bologna",
};

/** "Trois Chênes" → "TC". Skips legal-form acronyms (GAEC, SAT, SA…). */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-ZÀ-Ý]/.test(w) && w !== w.toUpperCase());
  const picked = words.slice(0, 2).map((w) => w[0]).join("");
  return (picked || name.replace(/[^A-Za-z]/g, "").slice(0, 2)).toUpperCase();
}

const firstName = (full: string): string => full.split(/\s+/)[0] ?? full;

// The persona list comes from the API (so a farm Vincent adds shows up with no
// code change). The member read has no farm_id, so each farm's holder is its
// main-contact member, paired by order. Falls back to the fixture when the API
// is unreachable (offline demo).
//
// MOCK fallback only: the source of truth is GET /data/farm + /data/member.
export async function listFarms(): Promise<FarmSummary[]> {
  try {
    const [farms, members] = await Promise.all([
      list("farm", { limit: 100 }),
      list("member", { limit: 200 }),
    ]);
    const holders = members.data.filter((m) => m.main_contact).sort((a, b) => a.id - b.id);
    const sorted = [...farms.data].sort((a, b) => a.id - b.id);
    const list_ = sorted.map((f, i) => {
      const holder = holders[i];
      return FarmSummarySchema.parse({
        id: f.id,
        code: f.source_holding_id ?? `FARM-${f.id}`,
        name: f.name,
        region: (f.nuts3_id && REGION[f.nuts3_id]) || f.nuts3_id || "",
        initials: initials(f.name),
        parcelCount: 0, // not exposed per farm by /data; shown only if > 0
        featured: true,
        live: true,
        farmerName: holder ? firstName(holder.full_name) : "",
        memberId: holder ? holder.id : f.id,
      });
    });
    if (list_.length > 0) return list_;
    throw new Error("no farms from API");
  } catch {
    return mock(FarmListSchema, farmsFixture);
  }
}
