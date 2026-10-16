import type { FarmFixture } from "../../src/modules/irrigation/data/memoryFarmData";
import { addDays } from "../../src/modules/irrigation/engine/util";

const MAIZE_KC: [number, number][] = [
  [0, .3],
  [.05, .3],
  [.22, .37],
  [.30, .66],
  [.47, 1.2],
  [.52, 1.2],
  [.60, 1.2],
  [.70, 1.2],
  [.85, .86],
  [.93, .59],
  [1, .35],
];

function constantWeather(from: string, to: string) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push({
      date: d,
      et0: 5,
      rain: 0,
      tmin: 12,
      tmean: 20,
      gddBase0: 20,
      gddBase5: 15,
      gddBase6: 14,
      gddBase10: 10,
    });
  }
  return out;
}

function constantClimatology(value: number) {
  const out: Record<string, number> = {};
  for (let d = "2025-01-01"; d <= "2025-12-31"; d = addDays(d, 1)) out[d.slice(5)] = value;
  return out;
}

/** Realistic farm mirroring the real DB (GAEC des Trois Chênes). */
export function makeFarmFixture(): FarmFixture {
  return {
    farm: { id: 1, name: "GAEC des Trois Chênes", lat: 48.046, lon: 1.794 },
    members: [
      { id: 1, name: "Claire Lefèvre", language: "fr", mainContact: true },
      { id: 2, name: "Thomas Lefèvre", language: "fr", mainContact: false },
    ],
    fields: [
      {
        id: 10,
        name: "La Vallée",
        areaHa: 12.5,
        irrigable: true,
        centroid: { lat: 48.046, lon: 1.794 },
      },
      {
        id: 11,
        name: "Le Puits",
        areaHa: 8.2,
        irrigable: true,
        centroid: { lat: 48.05, lon: 1.79 },
      },
      { id: 3, name: "Les Longues Raies", areaHa: 15, irrigable: false, centroid: null },
    ],
    seasons: {
      10: [{
        id: 109,
        cropCode: "MAIZ",
        sowingDate: "2026-04-16",
        harvestDate: "2026-10-17",
        status: "growing",
      }],
      11: [{
        id: 121,
        cropCode: "COWT",
        sowingDate: "2026-10-09",
        harvestDate: "2027-07-15",
        status: "growing",
      }],
      3: [{
        id: 30,
        cropCode: "RAPE",
        sowingDate: "2025-08-24",
        harvestDate: "2026-07-22",
        status: "growing",
      }],
    },
    soils: {
      10: { sandPct: 63.5, clayPct: 6.7, organicMatterPct: 5.11 },
      11: { sandPct: 30.6, clayPct: 28.3, organicMatterPct: 0.95 },
    },
    cropRefs: [
      {
        code: "MAIZ",
        nameFr: "Maïs",
        nameEn: "Maize",
        gddBaseC: 6,
        kcIni: .3,
        kcMid: 1.2,
        kcEnd: .35,
      },
      {
        code: "COWT",
        nameFr: "Blé tendre d'hiver",
        nameEn: "Common winter wheat",
        gddBaseC: 0,
        kcIni: .4,
        kcMid: 1.15,
        kcEnd: .4,
      },
      {
        code: "RAPE",
        nameFr: "Colza",
        nameEn: "Rapeseed",
        gddBaseC: 0,
        kcIni: .35,
        kcMid: 1.15,
        kcEnd: .35,
      },
    ],
    cropStages: {
      MAIZ: MAIZE_KC.map(([seasonFraction, kc]) => ({ seasonFraction, kc })),
    },
    weather: constantWeather("2026-04-01", "2026-07-15"),
    climatology: { 0: constantClimatology(20), 6: constantClimatology(14) },
    irrigations: [{
      operationId: 1,
      fieldId: 10,
      seasonId: 109,
      date: "2026-06-21",
      mm: 30,
      status: "confirmed",
      source: "import",
      memberId: null,
    }],
  };
}
