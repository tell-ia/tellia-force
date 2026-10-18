import {
  FarmIrrigationPlanSchema,
  defaultFarmEquipment,
  irrigationHours,
  moveHours,
  reelGunModel,
  runsForField,
  type FarmEquipment,
  type FarmIrrigationPlan,
  type FarmFieldOutcome,
  type FarmPlanRun,
  type FarmSummary,
} from "@tellia/shared";
import { getFarmToday, getParcelReport } from "./parcels";
import { simulateFieldEvents } from "./plan";
import { list } from "./data";

const MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS);
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const round1 = (n: number) => Math.round(n * 10) / 10;

type Centroid = { lat: number; lon: number } | null;
interface Pass {
  fieldId: number;
  fieldName: string;
  passIndex: number;
  neededHour: number;
  grossMm: number;
  eff: number;
  areaHa: number;
  centroid: Centroid;
  soilCapMm: number;
  thresholdMm: number; // comfort line; below it the crop is stressed
}

// Cross-field reel-gun rotation. Each field is covered by several reel runs; runs are
// sequenced across the farm's gun(s), one run at a time per gun. Reuses the per-field
// engine reports/plans; the scheduling is orchestration. `equipment` (editable in the
// app) sets the gun(s), pump and move time.
export async function buildFarmPlan(
  farm: FarmSummary,
  equipment?: FarmEquipment,
): Promise<FarmIrrigationPlan> {
  const eq = equipment ?? defaultFarmEquipment(farm.id);
  const guns = eq.gunModelIds.map((id) => reelGunModel(id));
  const [today, fields] = await Promise.all([getFarmToday(farm), list("field", { limit: 100 })]);
  const asOf = today.asOf;

  const meta = new Map(
    fields.data
      .filter((f) => f.farm_id === farm.id)
      .map((f) => [
        f.id,
        {
          areaHa: f.area_ha ?? 0,
          centroid:
            f.centroid_lat != null && f.centroid_lon != null
              ? { lat: f.centroid_lat, lon: f.centroid_lon }
              : null,
        },
      ]),
  );

  const action = today.parcels.filter((p) => p.status === "action");
  const reports = await Promise.all(action.map((p) => getParcelReport(p.id).catch(() => null)));

  const passes: Pass[] = [];
  for (const rep of reports) {
    if (!rep) continue;
    const m = meta.get(rep.id);
    const areaHa = rep.areaHa || m?.areaHa || 0;
    const eff = rep.recommendation.efficiency || guns[0]!.efficiency;
    const list2 = rep.plan?.passes?.length
      ? rep.plan.passes
      : rep.recommendation.grossMm > 0
        ? [{ date: rep.asOf, grossMm: rep.recommendation.grossMm }]
        : [];
    list2.forEach((ps, i) =>
      passes.push({
        fieldId: rep.id,
        fieldName: rep.name,
        passIndex: i,
        neededHour: Math.max(0, daysBetween(asOf, ps.date)) * 24,
        grossMm: Math.round(ps.grossMm),
        eff,
        areaHa,
        centroid: m?.centroid ?? null,
        soilCapMm: rep.reserve.capacityMm,
        thresholdMm: rep.reserve.thresholdMm,
      }),
    );
  }
  passes.sort((a, b) => a.neededHour - b.neededHour || a.fieldId - b.fieldId);

  // Build runs (a field's pass split into reel runs by the gun's strip/hose).
  interface SchedRun extends Pass {
    runIndex: number;
    runs: number;
    runArea: number;
  }
  const schedRuns: SchedRun[] = [];
  for (const p of passes) {
    const n = runsForField(p.areaHa, guns[0]!);
    for (let r = 0; r < n; r++) {
      schedRuns.push({ ...p, runIndex: r, runs: n, runArea: p.areaHa / n });
    }
  }

  // Reel guns run day and night once going, but the farmer sets up / moves them only
  // in working hours. So a run's move+setup starts within [WORK_START, WORK_END]; the
  // run itself then continues overnight.
  const WORK_START = 7;
  const WORK_END = 20;
  const nextWorkStart = (h: number) => {
    const day = Math.floor(h / 24);
    const hod = h - day * 24;
    if (hod < WORK_START) return day * 24 + WORK_START;
    if (hod > WORK_END) return (day + 1) * 24 + WORK_START;
    return h;
  };
  // Sequence on the gun(s): each run goes to the gun that can start it soonest, so the
  // guns share the work — different fields run in parallel, and a heavy field's runs can
  // be split across guns. Doses stay the engine's (never raised). Pure in the gun count,
  // so we can re-schedule for different N (to suggest a gun count) without re-fetching.
  const startFor = (gs: { freeHour: number; last: Centroid }, r: SchedRun) =>
    nextWorkStart(Math.max(r.neededHour, gs.freeHour)) + moveHours(gs.last, r.centroid, eq.moveMinutes);
  const scheduleFor = (nGuns: number): { runs: FarmPlanRun[]; totalHours: number } => {
    const flow = guns[0]?.flowM3h ?? 60;
    const gunState = Array.from({ length: nGuns }, () => ({ flow, freeHour: 10, last: null as Centroid })); // "now" ≈ 10:00
    const runs: FarmPlanRun[] = [];
    let total = 0;
    for (const r of schedRuns) {
      let best = 0;
      let bestStart = Infinity;
      gunState.forEach((gs, gi) => {
        const start = startFor(gs, r);
        if (start < bestStart) {
          bestStart = start;
          best = gi;
        }
      });
      const gs = gunState[best]!;
      const mv = moveHours(gs.last, r.centroid, eq.moveMinutes);
      const startHour = startFor(gs, r);
      const dur = irrigationHours(r.runArea, r.grossMm, gs.flow);
      const endHour = startHour + dur;
      gs.freeHour = endHour;
      gs.last = r.centroid;
      total += mv + dur;
      runs.push({
        fieldId: r.fieldId,
        fieldName: r.fieldName,
        gunIndex: best,
        runIndex: r.runIndex,
        passIndex: r.passIndex,
        startHour: round1(startHour),
        endHour: round1(endHour),
        neededHour: r.neededHour,
        grossMm: r.grossMm,
        netMm: Math.round(r.grossMm * r.eff),
        areaHa: round1(r.runArea),
        late: false, // set from the re-simulated forecast below
        bumped: false,
        note: null,
      });
    }
    return { runs, totalHours: total };
  };

  // Per-field outcome: re-simulate each field with a schedule's ACTUAL watering dates. A
  // field is "stressed" (late) only when its reserve actually dips below the comfort line
  // in the forecast — the true signal, not just a late start (reel runs finish the next
  // day, so a late start isn't the same as a dip). Watering sooner (more guns) keeps a
  // field above comfort, so adding a gun visibly removes the stress.
  const simulateOutcomes = (runs: FarmPlanRun[]): Promise<FarmFieldOutcome[]> => {
    const ids = [...new Set(runs.map((o) => o.fieldId))];
    return Promise.all(
      ids.map(async (fid): Promise<FarmFieldOutcome> => {
        const fieldRuns = runs.filter((o) => o.fieldId === fid);
        const name = fieldRuns[0]?.fieldName ?? `Field ${fid}`;
        const threshold = passes.find((p) => p.fieldId === fid)?.thresholdMm ?? 0;
        // One event per pass: the day all its runs finish, at the pass dose.
        const byPass = new Map<number, { endDay: number; gross: number }>();
        for (const r of fieldRuns) {
          const endDay = Math.floor(r.endHour / 24);
          const e = byPass.get(r.passIndex);
          if (!e) byPass.set(r.passIndex, { endDay, gross: r.grossMm });
          else byPass.set(r.passIndex, { endDay: Math.max(e.endDay, endDay), gross: Math.max(e.gross, r.grossMm) });
        }
        const events = [...byPass.values()]
          .map((e) => ({ date: addDaysIso(asOf, e.endDay), grossMm: e.gross }))
          .sort((a, b) => a.date.localeCompare(b.date));
        const series = (await simulateFieldEvents(fid, asOf, events)) ?? [];
        // A field is "stressed" (late) when the rotation DOESN'T bring it home: it ends the
        // forecast still below comfort. Many fields start the day already below comfort
        // (that's why they need water) — that isn't the gun's fault, so we judge by where
        // the rotation leaves them, not by whether they ever dipped. Watering a field
        // sooner (more guns) lets it recover inside the window, so adding a gun flips it
        // from late to on-time.
        const forecast = series.filter((d) => d.forecast);
        const last = forecast.at(-1);
        const stressed = last ? last.reserveMm < threshold : false;
        const todayRuns = fieldRuns.filter((r) => Math.floor(r.startHour / 24) === 0);
        const next = [...fieldRuns].sort((a, b) => a.startHour - b.startHour)[0];
        return {
          fieldId: fid,
          fieldName: name,
          late: stressed,
          todayGross: todayRuns.length ? todayRuns[0]!.grossMm : null,
          todayGunIndex: todayRuns.length ? todayRuns[0]!.gunIndex : null,
          todayStartHour: todayRuns.length ? todayRuns[0]!.startHour % 24 : null,
          comfortDay: null, // filled from the projection below
          nextDate: next ? addDaysIso(asOf, Math.floor(next.startHour / 24)) : null,
          series,
        };
      }),
    );
  };

  const { runs: out, totalHours } = scheduleFor(guns.length);
  const fieldOutcomes = await simulateOutcomes(out);

  // --- Steady-state recovery projection (beyond the ~7-day forecast) ------------------
  // The engine's weather reaches only ~7 days, but a deeply depleted field needs weeks of
  // rotations to climb back to comfort. We project that from the engine's own numbers: each
  // field's mean daily crop use (ETc, from its balance series) and the engine's net dose per
  // pass, against how fast the rotation can deliver water — more guns = shorter rotation =
  // more mm/day. While a field is below comfort it sits far from field capacity, so the extra
  // passes soak in without draining, and the climb is simply deficit ÷ (delivery − use).
  // Shown as a "projected" figure in the UI, never as a measured one.
  const projById = new Map<number, { dailyUse: number; deficit: number; netPass: number }>();
  for (const rep of reports) {
    if (!rep) continue;
    const uses = (rep.series ?? []).map((d) => d.cropUse).filter((u) => u > 0);
    const dailyUse = uses.length ? uses.reduce((a, b) => a + b, 0) / uses.length : 0;
    const passGross = rep.plan?.passes?.[0]?.grossMm ?? rep.recommendation.grossMm;
    const netPass = Math.round(passGross * (rep.recommendation.efficiency || guns[0]!.efficiency));
    const deficit = Math.max(0, rep.reserve.thresholdMm - rep.reserve.availableMm);
    projById.set(rep.id, { dailyUse, deficit, netPass });
  }
  // One full rotation's gun-hours: water every needy field once (reel time + a move each).
  // More guns share these hours, so the rotation — and each field's re-watering gap — shrinks.
  const flow0 = guns[0]?.flowM3h ?? 60;
  const onePass = schedRuns.filter((r) => r.passIndex === 0);
  const rotationHours =
    onePass.reduce((s, r) => s + irrigationHours(r.runArea, r.grossMm, flow0), 0) +
    onePass.length * (eq.moveMinutes / 60);

  interface Recovery { reachable: boolean; days: number; cycles: number }
  /** mm/day a field climbs after the crop drinks (≤ 0 = the rotation can't out-run ETc). */
  const climbPerDay = (p: { dailyUse: number; netPass: number }, nGuns: number) => {
    const cycleDays = rotationHours / Math.max(1, nGuns) / 24;
    const deliveryPerDay = cycleDays > 0 ? p.netPass / cycleDays : 0; // mm/day this field gets
    return deliveryPerDay - p.dailyUse;
  };
  const recover = (fid: number, nGuns: number): Recovery => {
    const p = projById.get(fid);
    if (!p || p.deficit <= 0) return { reachable: true, days: 0, cycles: 0 };
    const cycleDays = rotationHours / Math.max(1, nGuns) / 24;
    const surplus = climbPerDay(p, nGuns);
    if (surplus <= 0) return { reachable: false, days: 0, cycles: 0 }; // can't out-run ETc
    const days = p.deficit / surplus;
    return { reachable: true, days: Math.ceil(days), cycles: Math.max(1, Math.ceil(days / cycleDays)) };
  };
  const needyIds = [...projById.keys()].filter((id) => projById.get(id)!.deficit > 0);
  const farmRecovery = (nGuns: number) => {
    const rs = needyIds.map((id) => recover(id, nGuns));
    const feasible = rs.every((r) => r.reachable);
    return {
      feasible,
      comfortInDays: feasible ? (rs.length ? Math.max(0, ...rs.map((r) => r.days)) : 0) : null,
      cyclesToComfort: feasible ? (rs.length ? Math.max(0, ...rs.map((r) => r.cycles)) : 0) : null,
    };
  };

  // Suggested guns: the fewest that bring every field back to comfort within a reasonable
  // cruise (≤ TARGET_DAYS), capped at one gun per needy field. Falls back to the fewest that
  // reach comfort at all, then to the cap (fields that even a full fleet can't out-run).
  const TARGET_DAYS = 10;
  const fieldCount = Math.max(1, needyIds.length);
  let targetN: number | null = null;
  let floorN: number | null = null;
  for (let n = 1; n <= fieldCount; n++) {
    const fr = farmRecovery(n);
    if (!fr.feasible) continue;
    if (floorN === null) floorN = n;
    if ((fr.comfortInDays ?? Infinity) <= TARGET_DAYS) {
      targetN = n;
      break;
    }
  }
  const suggestedGuns = targetN ?? floorN ?? fieldCount;

  // Per field at the actual gun count: the projected day it climbs back above comfort
  // (0 = already comfortable, null = the rotation can't out-run its crop use at all). The
  // grid colours each day by this: amber while still below comfort, green from that day on.
  const comfortDayById = new Map<number, number | null>();
  for (const o of fieldOutcomes) {
    const r = recover(o.fieldId, guns.length);
    const day = r.reachable ? r.days : null;
    o.comfortDay = day;
    comfortDayById.set(o.fieldId, day);
  }
  // A field is "late" overall when the rotation never brings it home (null recovery).
  const stressedIds = new Set(needyIds.filter((id) => !recover(id, guns.length).reachable));
  for (const o of fieldOutcomes) o.late = stressedIds.has(o.fieldId);
  for (const r of out) r.late = stressedIds.has(r.fieldId);
  const warnings: string[] = [];
  for (const o of fieldOutcomes) {
    if (o.late) warnings.push(`${o.fieldName}: the rotation can't deliver water faster than the crop uses it. Add a reel gun to shorten the rotation.`);
  }
  const sumFlow = guns.reduce((s, g) => s + g.flowM3h, 0);
  if (sumFlow > eq.pumpM3h) {
    warnings.push(`The reel guns need ${sumFlow} m³/h together but the pump gives ${eq.pumpM3h}; they can't all run at once.`);
  }

  const here = farmRecovery(guns.length);
  const comfortInDays = here.comfortInDays;
  const cyclesToComfort = here.cyclesToComfort;

  // The grid runs far enough to show each field climb back to comfort (amber → green),
  // i.e. out to the latest projected comfort day — capped so a very slow case doesn't make
  // it absurdly wide, and at least past the last scheduled run.
  const GRID_CAP = 28;
  const maxComfort = Math.max(0, ...fieldOutcomes.map((o) => o.comfortDay ?? 0));
  const horizonDays = Math.min(
    GRID_CAP,
    Math.max(12, Math.ceil(Math.max(0, ...out.map((o) => o.endHour)) / 24), maxComfort + 1),
  );

  // Per field and grid day: mm still below comfort once that day is over, on the same
  // projection as comfortDay (so it reaches 0 on the last amber day). The dose alone is
  // always the gun's max pass; this is what shows the field closing its gap.
  for (const o of fieldOutcomes) {
    const p = projById.get(o.fieldId);
    if (!p) continue;
    const climb = climbPerDay(p, guns.length);
    o.gapMm = Array.from({ length: horizonDays }, (_, d) => Math.max(0, Math.ceil(p.deficit - climb * (d + 1))));
  }

  return FarmIrrigationPlanSchema.parse({
    farmId: farm.id,
    asOf,
    horizonDays,
    guns: guns.map((g) => ({ id: g.id, name: g.name, flowM3h: g.flowM3h, stripWidthM: g.stripWidthM })),
    pumpM3h: eq.pumpM3h,
    moveMinutes: eq.moveMinutes,
    runs: out,
    fields: fieldOutcomes,
    feasible: stressedIds.size === 0,
    suggestedGuns,
    comfortInDays,
    cyclesToComfort,
    warnings,
    totalHours: round1(totalHours),
  });
}
