// Product check: can this crop protection product go on this field's crop on this day?
// Read-only. The rules come from E-Phy (`product`, `product_use`, French register, shared by
// every farm); the times used come from the caller's own farm journal. Every number is computed
// here, never by the LLM, and no rule is ever made up: a product without E-Phy data gets no
// verdict. Wired into the irrigation service, like farmInfo.service.ts.

import { HTTPException } from "hono/http-exception";
import { IsoDateSchema } from "@tellia/shared/irrigation";
import {
  PRODUCT_MATCHES_MAX,
  type ProductApplication,
  type ProductCheck,
  type ProductMatch,
  type ProductUseRule,
} from "@tellia/shared/farm";
import {
  cropNameIn,
  type CropSeason,
  type FarmData,
  type FarmOperation,
  type Field,
  type OperationProduct,
  type ProductUse,
} from "./data/farmData";
import { addDays, daysBetween } from "./engine/util";

export interface ProductCheckQuery {
  /** Product name or AMM number, as the farmer said it. */
  product: string;
  fieldId: number;
  /** Day of the planned spray. Default: today. */
  date?: string;
}

export interface ProductCheckService {
  /**
   * Finds the product (name, accent and case insensitive, or AMM number) and checks it against
   * the E-Phy uses for the field's crop on the date, with the times it was used this season.
   */
  checkProductUse(query: ProductCheckQuery): Promise<ProductCheck>;
}

/** At most this many past applications come back (newest first). */
export const PRODUCT_APPLICATIONS_MAX = 10;

/** E-Phy is the French register: its rules are only a verdict for farms in France. */
const EPHY_COUNTRY = "FR";

export const NO_EPHY_DATA = "No authorisation data for this product (E-Phy covers France only).";

const bad = (message: string) => new HTTPException(400, { message });

/** Accent, case and punctuation insensitive text ("Karaté-Zéon" -> "karate zeon"). */
const normalize = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "from BBCH 12 to 19", "up to BBCH 61", "from BBCH 30". */
export function bbchRange(min: number | null, max: number | null): string {
  if (min != null && max != null) return `from BBCH ${min} to ${max}`;
  if (max != null) return `up to BBCH ${max}`;
  return `from BBCH ${min}`;
}

/**
 * The best matches of a query among the candidates: an AMM number, else the exact name, else
 * names that contain the query (or its words). Empty when nothing matches.
 */
export function matchProducts(query: string, candidates: ProductMatch[]): ProductMatch[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = new Set(q.split(" "));
  const qWords = words(query);

  const byAmm = candidates.filter((c) => c.ammNumber != null && tokens.has(normalize(c.ammNumber)));
  if (byAmm.length) return byAmm;

  const exact = candidates.filter((c) => normalize(c.name) === q);
  if (exact.length) return exact;

  return candidates.filter((c) => {
    const name = normalize(c.name);
    if (q.length >= 3 && name.includes(q)) return true;
    // "callisto on the maize" contains the whole name.
    if (name.length >= 3 && ` ${q} `.includes(` ${name} `)) return true;
    const nameWords = new Set(words(c.name));
    return qWords.length > 0 && qWords.every((w) => nameWords.has(w));
  });
}

export function createProductCheckService(
  deps: { data: FarmData; today: () => string; language: string },
): ProductCheckService {
  const { data, language } = deps;

  async function getField(fieldId: number): Promise<Field> {
    const field = (await data.listFields()).find((f) => f.id === fieldId);
    if (!field) throw new HTTPException(404, { message: `field ${fieldId} not found` });
    return field;
  }

  /** The E-Phy catalogue plus this farm's journal products that are not in it (synthetic). */
  async function candidates(): Promise<ProductMatch[]> {
    const [products, journalNames] = await Promise.all([
      data.listProducts(),
      data.listJournalProductNames(),
    ]);
    const catalogue: ProductMatch[] = products.map((p) => ({
      productId: p.id,
      name: p.name,
      ammNumber: p.ammNumber,
      kind: p.kind,
      activeSubstances: p.activeSubstances,
      synthetic: false,
    }));
    const known = new Set(catalogue.map((c) => normalize(c.name)));
    const seen = new Set<string>();
    const synthetic: ProductMatch[] = [];
    for (const name of journalNames) {
      const key = normalize(name);
      if (!key || known.has(key) || seen.has(key)) continue;
      seen.add(key);
      synthetic.push({
        productId: null,
        name,
        ammNumber: null,
        kind: null,
        activeSubstances: null,
        synthetic: true,
      });
    }
    return [...catalogue, ...synthetic];
  }

  /** Confirmed uses of the product on the field during the season, up to the date. */
  async function usageOf(product: ProductMatch, field: Field, season: CropSeason, date: string) {
    const isProduct = (p: OperationProduct) =>
      product.productId != null
        ? p.productId === product.productId
        : p.productId == null && normalize(p.productName) === normalize(product.name);
    const ops = await data.listOperations({ from: season.sowingDate, to: date, fieldId: field.id });
    const used = ops
      .filter((o) =>
        o.fieldId === field.id && o.status === "confirmed" && o.date <= date &&
        (o.seasonId == null || o.seasonId === season.id)
      )
      .map((o) => ({ o, p: o.products.find(isProduct) }))
      .filter((x): x is { o: FarmOperation; p: OperationProduct } => x.p !== undefined)
      .sort((a, b) => b.o.date.localeCompare(a.o.date) || b.o.operationId - a.o.operationId);
    const applications: ProductApplication[] = used.slice(0, PRODUCT_APPLICATIONS_MAX).map((
      { o, p },
    ) => ({ date: o.date, dose: p.dose, doseUnit: p.doseUnit }));
    return { timesUsed: used.length, lastDate: used[0]?.o.date ?? null, applications };
  }

  function toRule(u: ProductUse, date: string, harvestDate: string): ProductUseRule {
    return {
      target: u.target,
      maxDose: u.maxDose,
      doseUnit: u.doseUnit,
      maxApplications: u.maxApplications,
      preHarvestIntervalDays: u.preHarvestIntervalDays,
      bbchMin: u.bbchMin,
      bbchMax: u.bbchMax,
      bufferZoneWaterM: u.bufferZoneWaterM,
      conditions: u.conditions,
      preHarvestOk: u.preHarvestIntervalDays == null
        ? null
        : addDays(date, u.preHarvestIntervalDays) <= harvestDate,
    };
  }

  return {
    async checkProductUse(query) {
      const date = query.date ?? deps.today();
      if (!IsoDateSchema.safeParse(date).success) {
        throw bad("date must be a real date in YYYY-MM-DD format");
      }
      if (!normalize(query.product)) throw bad("product must name a product or an AMM number");
      const field = await getField(query.fieldId);

      const [all, season, farm] = await Promise.all([
        candidates(),
        data.getSeasonAt(field.id, date),
        data.getFarm(),
      ]);
      const ref = season ? await data.getCropRef(season.cropCode) : null;
      const cropName = season ? (ref ? cropNameIn(ref, language) : season.cropCode) : null;

      const result: ProductCheck = {
        query: query.product,
        date,
        fieldId: field.id,
        fieldName: field.name,
        crop: season
          ? {
            seasonId: season.id,
            code: season.cropCode,
            name: cropName!,
            sowingDate: season.sowingDate,
            harvestDate: season.harvestDate,
          }
          : null,
        status: "not_found",
        product: null,
        matches: [],
        authorised: null,
        uses: [],
        usage: null,
        applicationsLeft: null,
        daysToHarvest: season ? daysBetween(date, season.harvestDate) : null,
        preHarvestOk: null,
        warnings: [],
      };

      const found = matchProducts(query.product, all);
      if (found.length === 0) return result;
      if (found.length > 1) {
        return { ...result, status: "ambiguous", matches: found.slice(0, PRODUCT_MATCHES_MAX) };
      }

      const product = found[0];
      result.status = "found";
      result.product = product;
      const warnings = result.warnings;

      if (!season) {
        warnings.push(
          `${field.name} has no crop on ${date}: the authorisation depends on the crop, so it cannot be checked.`,
        );
        if (product.synthetic) warnings.push(NO_EPHY_DATA);
        return result;
      }

      result.usage = await usageOf(product, field, season, date);
      if (product.productId == null) {
        warnings.push(NO_EPHY_DATA);
        return result;
      }

      const uses = (await data.listProductUses(product.productId))
        .filter((u) => u.cropCode === season.cropCode)
        .map((u) => toRule(u, date, season.harvestDate));
      result.uses = uses;
      // Outside France the French rules are shown, but they are not a verdict.
      const country = farm.countryCode?.toUpperCase() ?? null;
      const verdict = country == null || country === EPHY_COUNTRY;
      if (!verdict) {
        warnings.push(
          `E-Phy covers France only: these French rules are not a verdict for this farm (${country}).`,
        );
      }

      if (uses.length === 0) {
        if (verdict) {
          result.authorised = false;
          warnings.push(`Not authorised: E-Phy lists no use of ${product.name} on ${cropName}.`);
        }
        return result;
      }
      if (verdict) result.authorised = true;

      const timesUsed = result.usage.timesUsed;
      const max = uses.length === 1 ? uses[0].maxApplications : null;
      if (verdict && max != null) {
        result.applicationsLeft = Math.max(0, max - timesUsed);
        if (timesUsed > max) {
          warnings.push(
            `Used ${plural(timesUsed, "time")} this season, more than the maximum of ${
              plural(max, "application")
            }.`,
          );
        } else if (timesUsed === max) {
          warnings.push(
            `Maximum number of applications reached: ${timesUsed} of ${max} this season.`,
          );
        }
      }

      const phi = uses.filter((u) => u.preHarvestOk != null);
      if (verdict && phi.length) {
        const ok = phi.every((u) => u.preHarvestOk);
        const notOk = phi.every((u) => !u.preHarvestOk);
        if (ok) result.preHarvestOk = true;
        else if (notOk) {
          result.preHarvestOk = false;
          const days = [...new Set(phi.map((u) => u.preHarvestIntervalDays))].join(" or ");
          warnings.push(
            `Pre-harvest interval not met: ${days} days needed, only ${
              plural(result.daysToHarvest!, "day")
            } to harvest (${season.harvestDate}).`,
          );
        } else {
          warnings.push(
            `The pre-harvest interval depends on the use: ${
              plural(result.daysToHarvest!, "day")
            } to harvest (${season.harvestDate}); check each use.`,
          );
        }
      }

      const ranges = [
        ...new Set(
          uses.filter((u) => u.bbchMin != null || u.bbchMax != null).map((u) =>
            bbchRange(u.bbchMin, u.bbchMax)
          ),
        ),
      ];
      if (ranges.length === 1) {
        warnings.push(`Crop stage (BBCH) is not checked automatically: allowed ${ranges[0]}.`);
      } else if (ranges.length > 1) {
        warnings.push(
          "Crop stage (BBCH) is not checked automatically: each use gives its own BBCH range.",
        );
      }
      return result;
    },
  };
}
