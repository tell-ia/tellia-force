// FAO-56 test data, copied from seed/fao56 (Marceau's tables) and the seed's derived crop phases.
import type { FarmFixture } from "../../src/modules/irrigation/data/memoryFarmData";
import type { IrrigationSystem, StoredWeatherDay } from "../../src/modules/irrigation/data/farmData";
import type { CropParams, CropPhases } from "../../src/modules/irrigation/engine/cropModel";
import type { SoilWaterClass } from "../../src/modules/irrigation/engine/soil";

/** fao56_crop_stages + fao56_kc + fao56_root_depletion, grain maize. */
export const MAIZE_PARAMS: CropParams = {
  tBaseC: 6,
  tMaxCapC: 30,
  kcIni: 0.3,
  kcMid: 1.2,
  kcEnd: 0.6,
  zrIniM: 0.2,
  zrMaxM: 1.2,
  pTable: 0.55,
};

/** Maize, earliness `early`: Arvalis anchors (flowering 850 °C·d base 6). */
export const MAIZE_EARLY_PHASES: CropPhases = {
  iniEnd: 320, // 5-6 leaves
  devEnd: 760, // full cover = flowering − 90
  midEnd: 1440, // flowering + 590 (dough, 32 % dry matter)
  lateEnd: 1630, // flowering + 780 (grain harvest)
  flowering: 850,
  sensitive: { from: 750, to: 1100, p: 0.45 }, // FAO-33 flowering window
};

/** fao56_soil_water (FAO-56 Table 19), mid values. Names as in the CSV. */
export const SOIL_CLASSES: SoilWaterClass[] = [
  { textureClass: "Sandy loam", thetaFcMid: 0.23, thetaWpMid: 0.11 },
  { textureClass: "Loam", thetaFcMid: 0.25, thetaWpMid: 0.12 },
  { textureClass: "Clay loam", thetaFcMid: 0.3, thetaWpMid: 0.18 },
  { textureClass: "Silt clay loam", thetaFcMid: 0.335, thetaWpMid: 0.205 },
];

/** The seed's reel gun: 0.75 efficiency, 20–40 mm gross per pass, 3-day round. */
export const REEL_GUN: IrrigationSystem = {
  id: 1,
  name: "Reel gun 1",
  efficiency: 0.75,
  doseMinMm: 20,
  doseMaxMm: 40,
  roundDays: 3,
};

/** Real AgERA5 weather, Loiret (FRB06), 15 Apr – 31 Aug 2022, as stored in weather_daily. */
export function loiret2022Weather(): StoredWeatherDay[] {
  const json = JSON.parse(
    Deno.readTextFileSync(new URL("./loiret_2022_weather.json", import.meta.url)),
  ) as { days: { date: string; tmin: number; tmean: number; tmax: number; et0: number; rain: number }[] };
  return json.days.map((d) => ({
    date: d.date,
    et0: d.et0,
    rain: d.rain,
    tmin: d.tmin,
    tmean: d.tmean,
    tmax: d.tmax,
    gddBase0: Math.max(0, d.tmean),
    gddBase5: Math.max(0, d.tmean - 5),
    gddBase6: Math.max(0, d.tmean - 6),
    gddBase10: Math.max(0, d.tmean - 10),
  }));
}

/**
 * Marceau's reference case: La Vallée 2022, maize `early` sown 3 May, sandy loam,
 * 35 mm gross on 9 July with a reel gun. Wet region (soil full at sowing).
 */
export function makeReference2022Fixture(opts: { withJuly9Watering?: boolean } = {}): FarmFixture {
  const watering = opts.withJuly9Watering ?? true;
  return {
    farm: { id: 1, name: "GAEC des Trois Chênes", lat: 48.046, lon: 1.794, aridityIndex: 0.8 },
    members: [{ id: 1, name: "Claire Lefèvre", language: "fr", mainContact: true }],
    fields: [{
      id: 10,
      name: "La Vallée",
      areaHa: 5.96,
      irrigable: true,
      centroid: { lat: 48.046, lon: 1.794 },
    }],
    seasons: {
      10: [{
        id: 1,
        cropCode: "MAIZ",
        sowingDate: "2022-05-03",
        harvestDate: "2022-10-15",
        status: "harvested",
        earlinessGroup: "early",
      }],
    },
    soils: { 10: { sandPct: 63.5, clayPct: 6.7, organicMatterPct: 5.11 } },
    cropRefs: [{
      code: "MAIZ",
      nameFr: "Maïs grain",
      nameEn: "Grain maize",
      names: { fr: "Maïs grain", en: "Grain maize", es: "Maíz grano", it: "Mais da granella" },
      gddBaseC: 6,
      kcIni: 0.3,
      kcMid: 1.2,
      kcEnd: 0.35,
    }],
    cropStages: {},
    cropParams: { MAIZ: MAIZE_PARAMS },
    cropPhases: [{ cropCode: "MAIZ", earlinessGroup: "early", phases: MAIZE_EARLY_PHASES }],
    soilClasses: SOIL_CLASSES,
    irrigationSystems: { 10: REEL_GUN },
    weather: loiret2022Weather(),
    climatology: {},
    irrigations: watering
      ? [{
        operationId: 1,
        fieldId: 10,
        seasonId: 1,
        date: "2022-07-09",
        mm: 35,
        status: "confirmed",
        source: "whatsapp",
        memberId: 1,
      }]
      : [],
  };
}
