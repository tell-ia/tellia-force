// Design tokens for TelliaForce, extracted verbatim from the hi-fi prototype
// (docs/prototype/*.dc.html). Single source of truth: components reference CSS
// variables (var(--tf-…)) that `themeVars()` sets on :root at runtime; charts
// read the hex values directly from `colors`. No component hardcodes a color,
// font, radius or spacing — it imports from here.

export type ThemeName = "light" | "dark";

/** Themed semantic colors. Keys are the prototype's own token names. */
export const colors = {
  light: {
    bg: "#F6F3E8",
    surface: "#FCFAF3",
    sunk: "#ECE8D9",
    ink: "#182E22",
    ink2: "#4F5A52",
    line: "#DDD8C6",
    brand: "#306241",
    water: "#2E7D72",
    waterSoft: "#D5E8E3",
    rain: "#6E97B8", // rainfall bars (distinct from irrigation teal)
    soil: "#A88F68", // water already held in the soil (next-days bars)
    cons: "#C9BE9E", // crop-use bars
    act: "#9C5A14", // the single "action needed" accent
    actSoft: "#F4E4CC",
    okSoft: "#E2EFE6",
    hero: "#234534",
  },
  dark: {
    bg: "#0E1712",
    surface: "#15221A",
    sunk: "#1C2B22",
    ink: "#EEEBDD",
    ink2: "#A7B0A6",
    line: "#2A3B30",
    brand: "#7AC898",
    water: "#5FBFAF",
    waterSoft: "#1D3A35",
    rain: "#6E97B8",
    soil: "#8C7A5C",
    cons: "#A39B7B",
    act: "#E5A35C",
    actSoft: "#3B2914",
    okSoft: "#1C3325",
    hero: "#1E3A2B",
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export type ColorToken = keyof typeof colors.light;

/** The recommendation hero card is dark-green in both themes (theme-invariant). */
export const hero = {
  bg: "#275936",
  ink: "#F6F3E8",
  ink2: "#D9E6DC",
  line: "rgba(246, 243, 232, 0.25)",
  // Water already applied today: a light teal that reads on the green, and its tint.
  water: "#8EE0D1",
  waterBg: "rgba(95, 191, 175, 0.2)",
  // MOCK asset: prototype /_blob/c43002414e533f7232b62715fbeda75b — added in Phase 2.
  texture: "/assets/hero-texture.jpg",
} as const;

export const font = {
  display: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  body: "'DM Sans', 'Helvetica Neue', sans-serif",
} as const;

/** Corner radii (px). */
export const radius = {
  pill: 999,
  hero: 20,
  section: 18,
  card: 14,
  chip: 14,
  tile: 12,
  bar: 8,
  avatar: 20,
} as const;

/** Spacing scale (px). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const shadow = {
  header: "0 4px 16px rgba(15, 24, 19, 0.25)",
  focusRing: "0 0 0 5px var(--tf-waterSoft)",
} as const;

/** CSS var name for a themed token, e.g. "--tf-bg". */
export const cssVar = (t: ColorToken): string => `--tf-${t}`;
/** Reference a themed token in a style prop: `color: v("ink")`. */
export const v = (t: ColorToken): string => `var(${cssVar(t)})`;

/** `{ "--tf-bg": "#…", … }` for a theme — set on :root to switch light/dark. */
export function themeVars(name: ThemeName): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors[name]).map(([k, val]) => [cssVar(k as ColorToken), val]),
  );
}

export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap";
