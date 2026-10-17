import { ArrowRight, Clock } from "lucide-react";
import type { Recommendation } from "@tellia/shared";
import { font, hero, radius } from "../../theme/tokens";

const HERO_INK = "#234534"; // text on the cream buttons/pills over the hero

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <section
      aria-label="Recommendation"
      style={{ flexShrink: 0, position: "relative", overflow: "hidden", borderRadius: radius.hero, background: hero.bg, color: hero.ink, padding: "22px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}
    >
      <img src={hero.texture} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <svg viewBox="0 0 582 403" width="420" height="291" aria-hidden="true" style={{ position: "absolute", right: -210, top: -60, opacity: 0.32 }}>
        <path d="M581 177.65V397.618C581 399.827 579.209 401.618 577 401.618H5C2.79083 401.618 1 399.827 1 397.618V5.00372C1 2.32147 3.58801 0.399292 6.15582 1.17435L578.156 173.821C579.845 174.331 581 175.886 581 177.65Z" fill="none" stroke={hero.ink} strokeWidth={3} />
      </svg>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14 }}>
        <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7, background: hero.ink, color: HERO_INK, borderRadius: radius.pill, padding: "5px 12px", fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <Clock size={12} strokeWidth={2.5} />
          {rec.headline}
        </span>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: font.display, fontWeight: 500, fontSize: 22, lineHeight: 1 }}>Apply</span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: font.display, fontWeight: 700, fontSize: 104, lineHeight: 0.86, letterSpacing: "-0.02em" }}>{rec.grossMm}</span>
            <span style={{ fontFamily: font.display, fontWeight: 600, fontSize: 36 }}>mm</span>
          </span>
          <span style={{ fontSize: 14, color: hero.ink2, marginTop: 4 }}>at the reel gun · ≈ {rec.netMm} mm reaches the soil</span>
        </div>
        {rec.secondPass && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: hero.ink2, borderTop: `1px solid ${hero.line}`, paddingTop: 12 }}>
            <ArrowRight size={16} />
            <span>{rec.secondPass}</span>
          </div>
        )}
        <button type="button" onClick={() => document.getElementById("balance")?.scrollIntoView({ behavior: "smooth", block: "start" })} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 12, border: `1.5px solid ${hero.line}`, background: "transparent", color: hero.ink, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
          Why?
        </button>
      </div>
    </section>
  );
}
