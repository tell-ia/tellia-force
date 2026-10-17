import { Check } from "lucide-react";
import { useState } from "react";
import type { FarmSummary } from "@tellia/shared";
import { farmAccent, useFarm } from "../../app/FarmContext";
import { setMemberPhone } from "../../lib/api";
import { PHONE_PRESETS } from "../../lib/phones";
import { font, v, type ColorToken } from "../../theme/tokens";

export function PersonaSheet({ onClose }: { onClose: () => void }) {
  const { farms, farm, setFarm } = useFarm();
  const [phone, setPhone] = useState<string>(() => {
    try {
      return localStorage.getItem("tf-phone") || PHONE_PRESETS[0]?.number || "";
    } catch {
      return PHONE_PRESETS[0]?.number ?? "";
    }
  });

  const pickPhone = (n: string) => {
    setPhone(n);
    try {
      localStorage.setItem("tf-phone", n);
    } catch {
      /* ignore */
    }
  };

  // Vincent's VAPI hack: picking a farm also saves the chosen number on its member.
  const pickFarm = (f: FarmSummary) => {
    setFarm(f);
    if (phone) void setMemberPhone(f.memberId, phone).catch(() => {});
    onClose();
  };

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 10 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: 0, padding: 0, background: "rgba(15, 24, 19, 0.48)", cursor: "pointer" }}
      />
      <div
        role="dialog"
        aria-label="Switch farm"
        style={{
          position: "relative",
          background: v("bg"),
          borderRadius: "22px 22px 0 0",
          padding: "10px 20px calc(28px + env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, background: v("line") }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontFamily: font.display, fontWeight: 600, fontSize: 28, lineHeight: 1 }}>Switch farm</div>
          <div style={{ fontSize: 13, color: v("ink2") }}>Parcels, chat and numbers follow the farm you pick.</div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: v("ink2") }}>
            Your number — the advisor calls &amp; texts you here
          </span>
          <select
            value={phone}
            onChange={(e) => pickPhone(e.target.value)}
            style={{ height: 48, borderRadius: 12, border: `1px solid ${v("line")}`, background: v("surface"), color: v("ink"), fontSize: 15, padding: "0 12px" }}
          >
            {PHONE_PRESETS.map((p) => (
              <option key={p.number} value={p.number}>
                {p.label} · {p.number}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {farms.map((f) => (
            <FarmOption
              key={f.id}
              f={f}
              selected={f.id === farm?.id}
              accent={farmAccent(f, farms)}
              onPick={() => pickFarm(f)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FarmOption({
  f,
  selected,
  accent,
  onPick,
}: {
  f: FarmSummary;
  selected: boolean;
  accent: ColorToken;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        minHeight: 76,
        width: "100%",
        boxSizing: "border-box",
        textAlign: "left",
        color: v("ink"),
        cursor: "pointer",
        borderRadius: 16,
        padding: "12px 14px",
        background: v("surface"),
        border: selected ? `2px solid ${v("brand")}` : `1px solid ${v("line")}`,
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          flex: "none",
          borderRadius: 23,
          background: v(accent),
          color: v("bg"),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: font.display,
          fontWeight: 700,
          fontSize: 19,
        }}
      >
        {f.initials}
      </span>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{f.name}</span>
        <span style={{ fontSize: 13, color: v("ink2") }}>
          {f.region}
          {f.parcelCount ? ` · ${f.parcelCount} parcels` : ""}
          {f.live ? "" : " · demo data"}
        </span>
        <span style={{ fontSize: 11, color: v("ink2"), letterSpacing: "0.06em" }}>{f.code}</span>
      </span>
      {selected && (
        <span
          style={{
            width: 26,
            height: 26,
            flex: "none",
            borderRadius: 13,
            background: v("brand"),
            color: v("bg"),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={15} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
