// AUTO-GENERATED from the Supabase PostgREST schema. Do not edit by hand —
// regenerate when the DB changes. Schemas are snake_case, 1:1 with the DB,
// so the API can select rows and return/validate them with no mapping layer.
import { z } from "zod";

/** Actions the assistant proposes to the farmer (for example the 3 actions of the day), with status and feedback. */
export const AlertSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  member_id: z.number().int().nullable(),
  field_id: z.number().int().nullable(),
  kind: z.string(),
  priority: z.number().int(),
  title: z.string(),
  body: z.string().nullable(),
  due_date: z.string().nullable(),
  status: z.string(),
  channel: z.string().nullable(),
  feedback: z.string().nullable(),
  details: z.unknown().nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;

/** One row per crop: names in 6 languages, degree-day base temperature, FAO-56 crop coefficients (Kc). */
export const CropRefSchema = z.object({
  crop_code: z.string(),
  crop_group_code: z.string().nullable(),
  name_en: z.string(),
  name_fr: z.string(),
  name_es: z.string().nullable(),
  name_de: z.string().nullable(),
  name_it: z.string().nullable(),
  name_pt: z.string().nullable(),
  ephy_crop_names: z.array(z.unknown()).nullable(),
  winter_crop: z.boolean(),
  gdd_base_c: z.number(),
  kc_ini: z.number().nullable(),
  kc_mid: z.number().nullable(),
  kc_end: z.number().nullable(),
  typical_sowing: z.string().nullable(),
  typical_harvest: z.string().nullable(),
});
export type CropRef = z.infer<typeof CropRefSchema>;

/** The crop on a field for one harvest year (winter crops are sown the autumn before). harvest_date is expected when status is not harvested. */
export const CropSeasonSchema = z.object({
  id: z.number().int(),
  field_id: z.number().int(),
  harvest_year: z.number().int(),
  crop_code: z.string(),
  variety: z.string().nullable(),
  previous_crop_code: z.string().nullable(),
  sowing_date: z.string().nullable(),
  harvest_date: z.string().nullable(),
  status: z.string(),
  irrigated: z.boolean(),
  yield_t_ha: z.number().nullable(),
  moisture_pct: z.number().nullable(),
  protein_pct: z.number().nullable(),
  origin: z.string(),
  details: z.unknown().nullable(),
});
export type CropSeason = z.infer<typeof CropSeasonSchema>;

/** Simple stage model: BBCH stage reached at a fraction of the sowing-to-harvest degree-days. Approximation for the demo. */
export const CropStageSchema = z.object({
  crop_code: z.string(),
  bbch: z.number().int(),
  season_fraction: z.number(),
  label_en: z.string(),
  label_fr: z.string(),
  kc: z.number(),
});
export type CropStage = z.infer<typeof CropStageSchema>;

/** Documents produced by the assistant, for example the spray register. */
export const DocumentSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  kind: z.string(),
  title: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  file_url: z.string().nullable(),
  content: z.unknown().nullable(),
  member_id: z.number().int().nullable(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** The one demo farm. Fictional name; records based on synthetic holding source_holding_id. */
export const FarmSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  legal_form: z.string().nullable(),
  nuts3_id: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  uaa_ha: z.number().nullable(),
  organic: z.boolean(),
  farm_type: z.string().nullable(),
  source_holding_id: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Farm = z.infer<typeof FarmSchema>;

/** Yearly farm accounts. Synthetic. */
export const FarmEconomicsSchema = z.object({
  year: z.number().int(),
  total_output_eur: z.number().nullable(),
  seeds_eur: z.number().nullable(),
  fertiliser_eur: z.number().nullable(),
  crop_protection_eur: z.number().nullable(),
  energy_eur: z.number().nullable(),
  contract_work_eur: z.number().nullable(),
  wages_eur: z.number().nullable(),
  depreciation_eur: z.number().nullable(),
  total_inputs_eur: z.number().nullable(),
  farm_net_value_added_eur: z.number().nullable(),
  origin: z.string(),
});
export type FarmEconomics = z.infer<typeof FarmEconomicsSchema>;

/** Fields (parcels) of the farm. Names are invented. Shapes are schematic squares placed in the region. */
export const FieldSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  area_ha: z.number(),
  tenure: z.string().nullable(),
  irrigable: z.boolean(),
  centroid_lat: z.number().nullable(),
  centroid_lon: z.number().nullable(),
  shape_geojson: z.unknown().nullable(),
  source_parcel_id: z.string().nullable(),
});
export type Field = z.infer<typeof FieldSchema>;

/** Monthly reference price per crop, EUR per tonne. Synthetic (hackathon dataset). */
export const MarketPriceSchema = z.object({
  crop_code: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  price_eur_t: z.number(),
});
export type MarketPrice = z.infer<typeof MarketPriceSchema>;

/** People of the farm. phone (E.164, like +33612345678) identifies who sends a WhatsApp message or calls. */
export const MemberSchema = z.object({
  id: z.number().int(),
  full_name: z.string(),
  role: z.string(),
  phone: z.string().nullable(),
  language: z.string(),
  birth_year: z.number().int().nullable(),
  annual_hours: z.number().int().nullable(),
  certiphyto: z.boolean(),
  main_contact: z.boolean(),
  notes: z.string().nullable(),
});
export type Member = z.infer<typeof MemberSchema>;

/** WhatsApp messages and phone calls with the assistant. transcript holds speech-to-text for audio and calls. */
export const MessageSchema = z.object({
  id: z.number().int(),
  created_at: z.string(),
  member_id: z.number().int().nullable(),
  channel: z.string(),
  direction: z.string(),
  kind: z.string(),
  text: z.string().nullable(),
  transcript: z.string().nullable(),
  media_url: z.string().nullable(),
  external_id: z.string().nullable(),
  tool_calls: z.unknown().nullable(),
  details: z.unknown().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Farm journal: every field operation. status=draft for records the assistant created and the farmer has not confirmed yet; planned for future work. */
export const OperationSchema = z.object({
  id: z.number().int(),
  field_id: z.number().int(),
  crop_season_id: z.number().int().nullable(),
  op_date: z.string(),
  op_type: z.string(),
  status: z.string(),
  source: z.string(),
  member_id: z.number().int().nullable(),
  area_ha: z.number().nullable(),
  bbch: z.number().int().nullable(),
  fertiliser_type: z.string().nullable(),
  n_kg_ha: z.number().nullable(),
  p2o5_kg_ha: z.number().nullable(),
  k2o_kg_ha: z.number().nullable(),
  method: z.string().nullable(),
  water_mm: z.number().nullable(),
  variety: z.string().nullable(),
  seed_rate_kg_ha: z.number().nullable(),
  seed_origin: z.string().nullable(),
  yield_t_ha: z.number().nullable(),
  moisture_pct: z.number().nullable(),
  protein_pct: z.number().nullable(),
  notes: z.string().nullable(),
  message_id: z.number().int().nullable(),
  origin: z.string(),
  details: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Operation = z.infer<typeof OperationSchema>;

/** Products used in an operation (a tank mix has several rows). dose is per hectare. */
export const OperationInputSchema = z.object({
  id: z.number().int(),
  operation_id: z.number().int(),
  product_id: z.number().int().nullable(),
  product_name: z.string(),
  dose: z.number().nullable(),
  dose_unit: z.string().nullable(),
  target: z.string().nullable(),
});
export type OperationInput = z.infer<typeof OperationInputSchema>;

/** Crop protection products. Real products from the French E-Phy register (Anses). */
export const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  amm_number: z.string().nullable(),
  product_kind: z.string(),
  functions: z.string().nullable(),
  active_substances: z.string().nullable(),
  formulation: z.string().nullable(),
  holder: z.string().nullable(),
  source: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

/** Authorised uses of a product on a crop (E-Phy): max dose, max number of applications, days before harvest (DAR), buffer zone near water (ZNT). */
export const ProductUseSchema = z.object({
  id: z.number().int(),
  product_id: z.number().int(),
  crop_code: z.string(),
  usage_id: z.string(),
  target: z.string().nullable(),
  max_dose: z.number().nullable(),
  dose_unit: z.string().nullable(),
  max_applications: z.number().int().nullable(),
  pre_harvest_interval_days: z.number().int().nullable(),
  bbch_min: z.number().int().nullable(),
  bbch_max: z.number().int().nullable(),
  buffer_zone_water_m: z.number().nullable(),
  conditions: z.string().nullable(),
});
export type ProductUse = z.infer<typeof ProductUseSchema>;

/** The NUTS3 region of the farm, with climate normals and average topsoil. Real data. */
export const RegionSchema = z.object({
  nuts3_id: z.string(),
  name: z.string(),
  country_code: z.string(),
  centroid_lat: z.number().nullable(),
  centroid_lon: z.number().nullable(),
  climate_period: z.string().nullable(),
  mean_annual_precip_mm: z.number().nullable(),
  mean_april_sept_precip_mm: z.number().nullable(),
  mean_annual_et0_mm: z.number().nullable(),
  mean_annual_gdd_base5: z.number().nullable(),
  mean_annual_frost_days: z.number().nullable(),
  mean_annual_heat_days: z.number().nullable(),
  mean_annual_dry_days: z.number().nullable(),
  topsoil_ph: z.number().nullable(),
  topsoil_organic_carbon_g_kg: z.number().nullable(),
  topsoil_clay_pct: z.number().nullable(),
  topsoil_sand_pct: z.number().nullable(),
  topsoil_silt_pct: z.number().nullable(),
  source: z.string().nullable(),
});
export type Region = z.infer<typeof RegionSchema>;

/** Real regional averages for the farm region: yield, fertiliser use (NPK) and pesticide use by crop group. Join with crop_ref.crop_group_code. Yields are regional proxies; maize (LMAIZ) yields may include green maize (fresh matter), so compare with care. */
export const RegionalBenchmarkSchema = z.object({
  crop_group_code: z.string(),
  crop_group_name: z.string().nullable(),
  year: z.number().int(),
  yield_t_ha: z.number().nullable(),
  yield_source_geography: z.string().nullable(),
  yield_value_type: z.string().nullable(),
  n_kg_ha: z.number().nullable(),
  p2o5_kg_ha: z.number().nullable(),
  k2o_kg_ha: z.number().nullable(),
  npk_reference_year: z.number().int().nullable(),
  irrigated_share: z.number().nullable(),
  pesticide_total_kg_ai_ha: z.number().nullable(),
  herbicide_kg_ai_ha: z.number().nullable(),
  fungicide_kg_ai_ha: z.number().nullable(),
  insecticide_kg_ai_ha: z.number().nullable(),
  pesticide_reference: z.string().nullable(),
});
export type RegionalBenchmark = z.infer<typeof RegionalBenchmarkSchema>;

/** Grain sales. Generated from the farm harvests and the synthetic monthly prices. */
export const SaleSchema = z.object({
  id: z.number().int(),
  sale_date: z.string(),
  crop_code: z.string(),
  harvest_year: z.number().int(),
  volume_t: z.number(),
  price_eur_t: z.number(),
  buyer: z.string().nullable(),
  contract_type: z.string().nullable(),
  quality_grade: z.string().nullable(),
  origin: z.string(),
});
export type Sale = z.infer<typeof SaleSchema>;

/** Soil analysis per field. Values from the synthetic dataset; sampling date invented. */
export const SoilAnalysisSchema = z.object({
  id: z.number().int(),
  field_id: z.number().int(),
  sampled_on: z.string().nullable(),
  ph_h2o: z.number().nullable(),
  organic_matter_pct: z.number().nullable(),
  soc_g_kg: z.number().nullable(),
  nitrogen_g_kg: z.number().nullable(),
  phosphorus_mg_kg: z.number().nullable(),
  potassium_mg_kg: z.number().nullable(),
  sulfur_mg_kg: z.number().nullable(),
  calcium_mg_kg: z.number().nullable(),
  magnesium_mg_kg: z.number().nullable(),
  zinc_mg_kg: z.number().nullable(),
  boron_mg_kg: z.number().nullable(),
  sand_pct: z.number().nullable(),
  silt_pct: z.number().nullable(),
  clay_pct: z.number().nullable(),
  cec_cmol_kg: z.number().nullable(),
  bulk_density_kg_dm3: z.number().nullable(),
  lime_requirement_t_ha: z.number().nullable(),
  origin: z.string(),
});
export type SoilAnalysis = z.infer<typeof SoilAnalysisSchema>;

/** CAP payments per year and scheme (BISS, CRISS, ECO_SCHEME, COUPLED, RURAL_DEV). Synthetic. */
export const SubsidySchema = z.object({
  id: z.number().int(),
  year: z.number().int(),
  scheme: z.string(),
  amount_eur: z.number(),
  origin: z.string(),
});
export type Subsidy = z.infer<typeof SubsidySchema>;

/** Each field with its crop in the ground (growing), or else the next planned crop. */
export const VFieldCurrentSchema = z.object({
  field_id: z.number().int().nullable(),
  field_name: z.string().nullable(),
  area_ha: z.number().nullable(),
  irrigable: z.boolean().nullable(),
  crop_season_id: z.number().int().nullable(),
  harvest_year: z.number().int().nullable(),
  crop_code: z.string().nullable(),
  crop_en: z.string().nullable(),
  crop_fr: z.string().nullable(),
  status: z.string().nullable(),
  sowing_date: z.string().nullable(),
  harvest_date: z.string().nullable(),
});
export type VFieldCurrent = z.infer<typeof VFieldCurrentSchema>;

/** Fertiliser (N, P2O5, K2O kg/ha) per crop season, next to the regional average N use and yield. */
export const VNutrientsBySeasonSchema = z.object({
  crop_season_id: z.number().int().nullable(),
  field_name: z.string().nullable(),
  area_ha: z.number().nullable(),
  harvest_year: z.number().int().nullable(),
  crop_code: z.string().nullable(),
  n_kg_ha: z.number().nullable(),
  p2o5_kg_ha: z.number().nullable(),
  k2o_kg_ha: z.number().nullable(),
  yield_t_ha: z.number().nullable(),
  regional_n_kg_ha: z.number().nullable(),
  regional_yield_t_ha: z.number().nullable(),
});
export type VNutrientsBySeason = z.infer<typeof VNutrientsBySeasonSchema>;

/** Spray register (registre phytosanitaire): one row per product applied, with daily weather. */
export const VSprayRegisterSchema = z.object({
  operation_id: z.number().int().nullable(),
  op_date: z.string().nullable(),
  field_name: z.string().nullable(),
  area_ha: z.number().nullable(),
  harvest_year: z.number().int().nullable(),
  crop_fr: z.string().nullable(),
  crop_en: z.string().nullable(),
  bbch: z.number().int().nullable(),
  product_name: z.string().nullable(),
  amm_number: z.string().nullable(),
  product_kind: z.string().nullable(),
  dose: z.number().nullable(),
  dose_unit: z.string().nullable(),
  quantity_total: z.number().nullable(),
  target: z.string().nullable(),
  operator: z.string().nullable(),
  wind_m_s: z.number().nullable(),
  precip_mm: z.number().nullable(),
  status: z.string().nullable(),
  source: z.string().nullable(),
});
export type VSprayRegister = z.infer<typeof VSprayRegisterSchema>;

/** Real daily weather for the farm. 2015-2024: AgERA5 average of the region (hackathon dataset). From 2025: Open-Meteo at the farm location. */
export const WeatherDailySchema = z.object({
  date: z.string(),
  tmin_c: z.number().nullable(),
  tmean_c: z.number().nullable(),
  tmax_c: z.number().nullable(),
  precip_mm: z.number().nullable(),
  rh_pct: z.number().nullable(),
  wind_m_s: z.number().nullable(),
  radiation_mj_m2: z.number().nullable(),
  et0_mm: z.number().nullable(),
  gdd_base0: z.number().nullable(),
  gdd_base5: z.number().nullable(),
  gdd_base6: z.number().nullable(),
  gdd_base10: z.number().nullable(),
  source: z.string(),
});
export type WeatherDaily = z.infer<typeof WeatherDailySchema>;

/** Table name -> row schema. */
export const tableSchemas = {
  "alert": AlertSchema,
  "crop_ref": CropRefSchema,
  "crop_season": CropSeasonSchema,
  "crop_stage": CropStageSchema,
  "document": DocumentSchema,
  "farm": FarmSchema,
  "farm_economics": FarmEconomicsSchema,
  "field": FieldSchema,
  "market_price": MarketPriceSchema,
  "member": MemberSchema,
  "message": MessageSchema,
  "operation": OperationSchema,
  "operation_input": OperationInputSchema,
  "product": ProductSchema,
  "product_use": ProductUseSchema,
  "region": RegionSchema,
  "regional_benchmark": RegionalBenchmarkSchema,
  "sale": SaleSchema,
  "soil_analysis": SoilAnalysisSchema,
  "subsidy": SubsidySchema,
  "v_field_current": VFieldCurrentSchema,
  "v_nutrients_by_season": VNutrientsBySeasonSchema,
  "v_spray_register": VSprayRegisterSchema,
  "weather_daily": WeatherDailySchema,
} as const;
export type TableName = keyof typeof tableSchemas;
