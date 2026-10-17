// The one place screens import data from. Screens never import fixtures directly.
export { API_MODE, mockDelay, setMemberId } from "./core";
export { listFarms } from "./farms";
export { getFarmToday, getParcelReport } from "./parcels";
export { getSeasonHeatmap, type SeasonHeatmap, type HeatDay } from "./heatmap";
export { recordIrrigation, type RecordIrrigationInput } from "./irrigation";
export { simulateDose, type DoseSim } from "./simulate";
export { setMemberPhone } from "./members";
export { getDemoDate, setDemoDate } from "./settings";
export { list } from "./data";
