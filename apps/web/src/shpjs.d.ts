// shpjs ships no types: a zipped shapefile (or .shp buffer) in, GeoJSON in WGS84 out
// (one FeatureCollection, or one per layer when the zip holds several).
declare module "shpjs" {
  export default function shp(input: ArrayBuffer | string): Promise<unknown>;
}
