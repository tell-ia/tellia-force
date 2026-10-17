import { useEffect, useState } from "react";
import { font, v } from "../../theme/tokens";

// A little agri-flavoured loader: a bobbing water droplet + rotating one-liners.
const MESSAGES = [
  "Forecasting cloud tears…",
  "Counting water buckets…",
  "Asking the soil how it feels…",
  "Chasing degree-days…",
  "Measuring the morning dew…",
  "Balancing the water books…",
  "Consulting the clouds…",
  "Waking up the maize…",
];

export function Loader({ label }: { label?: string }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  useEffect(() => {
    if (label) return; // fixed label → no rotation
    const id = setInterval(() => setI((n) => (n + 1) % MESSAGES.length), 1700);
    return () => clearInterval(id);
  }, [label]);

  return (
    <div style={{ flex: 1, minHeight: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }}>
      <div style={{ position: "relative", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span data-tf-anim style={{ position: "absolute", width: 44, height: 44, borderRadius: "50%", background: v("waterSoft"), animation: "tf-ripple 1.6s ease-out infinite" }} />
        <svg data-tf-anim width="34" height="34" viewBox="0 0 24 24" fill={v("water")} aria-hidden="true" style={{ position: "relative", animation: "tf-bob 1.4s ease-in-out infinite" }}>
          <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
        </svg>
      </div>
      <div
        key={label ?? i}
        data-tf-anim
        aria-live="polite"
        style={{ fontFamily: font.display, fontWeight: 600, fontSize: 17, color: v("ink2"), textAlign: "center", animation: "tf-fade 0.4s ease-out" }}
      >
        {label ?? MESSAGES[i]}
      </div>
    </div>
  );
}
