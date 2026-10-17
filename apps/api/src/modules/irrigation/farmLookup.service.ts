// Farm data lookup: one generic, read-only tool over a fixed list of business tables (sales,
// market prices, subsidies, farm accounts, regional averages). FarmData is scoped to one farm:
// sale, subsidy and farm_economics are the caller's farm only, market_price is global and
// regional_benchmark is the farm's region. Every total is computed here, never by the LLM.
// Wired into the irrigation service, like farmInfo.service.ts.

import { HTTPException } from "hono/http-exception";
import {
  type FarmEconomicsRow,
  type FarmLookup,
  type FarmLookupQuery,
  FarmLookupQuerySchema,
  LOOKUP_DEFAULT_ROWS,
  type LookupTable,
  type MarketPriceRow,
  type RegionalBenchmarkRow,
  type SaleCropTotal,
  type SaleRow,
  type SaleSummary,
  type SubsidyRow,
  type SubsidySummary,
} from "@tellia/shared/farm";
import { cropNameIn, type CropRef, type FarmData } from "./data/farmData";
import { round1, round2 } from "./engine/util";

export interface FarmLookupService {
  /**
   * Rows of one table, newest first (at most `limit`, default LOOKUP_DEFAULT_ROWS), with
   * `count` and `summary` over every matching row. Bad input (unknown table, limit over
   * LOOKUP_MAX_ROWS, unknown crop) is a 400.
   */
  lookupFarmData(query: FarmLookupQuery): Promise<FarmLookup>;
}

/** Where each table's data comes from. */
export const LOOKUP_NOTES: Record<LookupTable, string> = {
  sale:
    "Synthetic demo data: grain sales generated from the farm's harvests at the synthetic monthly prices. year is the harvest year.",
  market_price:
    "Synthetic demo data: a monthly reference price per crop in EUR per tonne (a reference curve ±2.3 %), the same for every farm, not a real market quote. Rows with forecast true are after the current month.",
  subsidy: "Synthetic demo data: the farm's CAP payments per year and scheme.",
  farm_economics:
    "Synthetic demo data: the farm's yearly accounts in EUR. They stay about flat from year to year (no real trend).",
  regional_benchmark:
    "Real statistics: averages of the farm's region per crop group (yield t/ha, fertiliser N, P2O5 and K2O kg/ha, pesticides kg of active ingredient/ha). Yields are regional proxies; maize yields may include green maize, so compare with care.",
};

/** Tables with a crop column (regional_benchmark through the crop's group). */
const CROP_TABLES: ReadonlySet<LookupTable> = new Set([
  "sale",
  "market_price",
  "regional_benchmark",
]);

const bad = (message: string) => new HTTPException(400, { message });

/** Accent, case and punctuation insensitive text ("Blé tendre" -> "ble tendre"). */
const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const cropNames = (ref: CropRef) => [
  ...new Set([ref.nameFr, ref.nameEn, ...Object.values(ref.names)].filter(Boolean).map(normalize)),
];

/**
 * The crop of a code (any case) or a name in any language: an exact name first, else a name
 * that contains the words ("wheat" -> "Common winter wheat"). Several or no match is a 400.
 */
export function resolveCrop(query: string, refs: CropRef[]): CropRef {
  const q = normalize(query);
  const byCode = refs.find((r) => normalize(r.code) === q);
  if (byCode) return byCode;
  const exact = refs.filter((r) => cropNames(r).includes(q));
  const found = exact.length
    ? exact
    : q
    ? refs.filter((r) => cropNames(r).some((n) => ` ${n} `.includes(` ${q} `)))
    : [];
  if (found.length === 1) return found[0];
  const list = (rs: CropRef[]) => rs.map((r) => `${r.code} (${r.nameEn})`).join(", ");
  if (found.length > 1) {
    throw bad(`crop "${query}" matches several crops: ${list(found)}; give one code`);
  }
  throw bad(`unknown crop "${query}"; known crops: ${list(refs)}`);
}

/** Descending compare of numbers (newest year first). */
const desc = (a: number, b: number) => b - a;

export function createFarmLookupService(
  deps: { data: FarmData; today: () => string; language: string },
): FarmLookupService {
  const { data, language } = deps;

  function saleSummary(rows: SaleRow[], names: (code: string) => string): SaleSummary {
    const byCode = new Map<string, { volume: number; revenue: number }>();
    for (const r of rows) {
      const t = byCode.get(r.cropCode) ?? { volume: 0, revenue: 0 };
      t.volume += r.volumeT;
      t.revenue += r.volumeT * r.priceEurT;
      byCode.set(r.cropCode, t);
    }
    const average = (revenue: number, volume: number) =>
      volume > 0 ? round2(revenue / volume) : null;
    const byCrop: SaleCropTotal[] = [...byCode].map(([code, t]) => ({
      cropCode: code,
      cropName: names(code),
      volumeT: round1(t.volume),
      revenueEur: round2(t.revenue),
      averagePriceEurT: average(t.revenue, t.volume),
    })).sort((a, b) => desc(a.revenueEur, b.revenueEur) || a.cropCode.localeCompare(b.cropCode));
    const volume = [...byCode.values()].reduce((s, t) => s + t.volume, 0);
    const revenue = [...byCode.values()].reduce((s, t) => s + t.revenue, 0);
    return {
      volumeT: round1(volume),
      revenueEur: round2(revenue),
      // An average over several crops (wheat and rapeseed...) means nothing.
      averagePriceEurT: byCode.size === 1 ? average(revenue, volume) : null,
      byCrop,
    };
  }

  function subsidySummary(rows: SubsidyRow[]): SubsidySummary {
    const byYear = new Map<number, number>();
    for (const r of rows) byYear.set(r.year, (byYear.get(r.year) ?? 0) + r.amountEur);
    return {
      totalEur: round2(rows.reduce((s, r) => s + r.amountEur, 0)),
      byYear: [...byYear].sort((a, b) => desc(a[0], b[0])).map(([year, total]) => ({
        year,
        totalEur: round2(total),
      })),
    };
  }

  return {
    async lookupFarmData(input) {
      const parsed = FarmLookupQuerySchema.safeParse(input);
      if (!parsed.success) {
        throw bad(
          parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join(
            "; ",
          ),
        );
      }
      const { table, year, limit = LOOKUP_DEFAULT_ROWS } = parsed.data;
      const notes = [LOOKUP_NOTES[table]];

      let crop: CropRef | null = null;
      // Crops are only read for the tables that have one (names and the crop filter).
      const refs = CROP_TABLES.has(table) ? await data.listCropRefs() : [];
      if (parsed.data.cropCode !== undefined) {
        if (CROP_TABLES.has(table)) crop = resolveCrop(parsed.data.cropCode, refs);
        else notes.push(`cropCode does not apply to ${table}: ignored.`);
      }
      const byCode = new Map(refs.map((r) => [r.code, r]));
      const nameOf = (code: string) => {
        const ref = byCode.get(code);
        return ref ? cropNameIn(ref, language) : code;
      };
      const cropCode = crop?.code;
      const base = {
        synthetic: table !== "regional_benchmark",
        year: year ?? null,
        cropCode: cropCode ?? null,
      };
      /** The first `limit` rows, with the count and truncated flag. */
      const page = <T>(all: T[]) => ({
        rows: all.slice(0, limit),
        count: all.length,
        truncated: all.length > limit,
      });
      const note = () => notes.join(" ");

      switch (table) {
        case "sale": {
          const all: SaleRow[] = (await data.listSales({ year, cropCode }))
            .sort((a, b) =>
              b.date.localeCompare(a.date) || a.cropCode.localeCompare(b.cropCode) || a.id - b.id
            )
            .map((s) => ({
              saleDate: s.date,
              cropCode: s.cropCode,
              cropName: nameOf(s.cropCode),
              harvestYear: s.harvestYear,
              volumeT: s.volumeT,
              priceEurT: s.priceEurT,
              revenueEur: round2(s.volumeT * s.priceEurT),
              buyer: s.buyer,
              contractType: s.contractType,
              qualityGrade: s.qualityGrade,
            }));
          return {
            table,
            ...base,
            note: note(),
            ...page(all),
            summary: saleSummary(all, nameOf),
          };
        }
        case "market_price": {
          const currentMonth = deps.today().slice(0, 7);
          const all: MarketPriceRow[] = (await data.listMarketPrices({ year, cropCode }))
            .sort((a, b) =>
              desc(a.year, b.year) || desc(a.month, b.month) || a.cropCode.localeCompare(b.cropCode)
            )
            .map((p) => ({
              cropCode: p.cropCode,
              cropName: nameOf(p.cropCode),
              year: p.year,
              month: p.month,
              priceEurT: p.priceEurT,
              forecast: `${p.year}-${String(p.month).padStart(2, "0")}` > currentMonth,
            }));
          return { table, ...base, note: note(), ...page(all), summary: null };
        }
        case "subsidy": {
          const all: SubsidyRow[] = (await data.listSubsidies({ year }))
            .sort((a, b) => desc(a.year, b.year) || a.scheme.localeCompare(b.scheme) || a.id - b.id)
            .map(({ year, scheme, amountEur }) => ({ year, scheme, amountEur }));
          return {
            table,
            ...base,
            cropCode: null,
            note: note(),
            ...page(all),
            summary: subsidySummary(all),
          };
        }
        case "farm_economics": {
          const all: FarmEconomicsRow[] = (await data.listFarmEconomics({ year }))
            .sort((a, b) => desc(a.year, b.year));
          return { table, ...base, cropCode: null, note: note(), ...page(all), summary: null };
        }
        case "regional_benchmark": {
          const group = crop ? crop.cropGroupCode ?? null : undefined;
          if (crop && group === null) {
            notes.push(`${crop.code} has no crop group in the regional statistics.`);
          }
          const all: RegionalBenchmarkRow[] = group === null
            ? []
            : (await data.listRegionalBenchmarks({ year, cropGroupCode: group }))
              .sort((a, b) =>
                desc(a.year, b.year) || a.cropGroupCode.localeCompare(b.cropGroupCode)
              );
          return { table, ...base, note: note(), ...page(all), summary: null };
        }
      }
    },
  };
}
