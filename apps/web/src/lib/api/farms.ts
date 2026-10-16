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

// The persona list comes from the API (a farm Vincent adds to the DB shows up
// with no code change). Each farm's holder is its main-contact member, and the
// parcel count is its field count — both resolved by farm_id. Falls back to the
// fixture when the API is unreachable (offline demo).
//
// Source of truth: GET /data/farm + /data/member + /data/field.
export async function listFarms(): Promise<FarmSummary[]> {
  try {
    const [farms, members, fields] = await Promise.all([
      list("farm", { limit: 100 }),
      list("member", { limit: 300 }),
      list("field", { limit: 1000 }),
    ]);
    const built = [...farms.data]
      .sort((a, b) => a.id - b.id)
      .map((f) => {
        const holder =
          members.data.find((m) => m.farm_id === f.id && m.main_contact) ??
          members.data.find((m) => m.farm_id === f.id);
        const parcelCount = fields.data.filter((fl) => fl.farm_id === f.id).length;
        return FarmSummarySchema.parse({
          id: f.id,
          code: f.source_holding_id ?? `FARM-${f.id}`,
          name: f.name,
          region: (f.nuts3_id && REGION[f.nuts3_id]) || f.nuts3_id || "",
          initials: initials(f.name),
          parcelCount,
          featured: true,
          live: true,
          farmerName: holder ? firstName(holder.full_name) : "",
          memberId: holder ? holder.id : f.id,
        });
      });
    if (built.length > 0) return built;
    throw new Error("no farms from API");
  } catch {
    return mock(FarmListSchema, farmsFixture);
  }
}
