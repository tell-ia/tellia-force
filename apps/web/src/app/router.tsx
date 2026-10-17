import { useEffect, useState } from "react";

// Minimal hash router — no dependency. Capacitor deep links (Phase 5) resolve to
// these hashes, e.g. telliaforce://parcel/101#balance → #/parcel/101.

export type RouteName = "today" | "chat" | "log" | "admin" | "parcel" | "gallery";

export interface Route {
  name: RouteName;
  params: Record<string, string>;
  anchor: string; // the #section after the route, for deep-link scroll
}

const TAB_ROUTES: readonly RouteName[] = ["today", "chat", "log"];
export const isTabRoute = (name: RouteName): boolean => TAB_ROUTES.includes(name);

export function parseRoute(hash: string): Route {
  // hash looks like "#/parcel/101#balance"
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart = "", anchor = ""] = raw.split("#");
  const seg = pathPart.split("/").filter(Boolean);
  const head = seg[0] ?? "today";
  if (head === "parcel" && seg[1]) {
    return { name: "parcel", params: { id: seg[1] }, anchor };
  }
  if (head === "log" && seg[1]) {
    return { name: "log", params: { id: seg[1] }, anchor };
  }
  const known: readonly string[] = ["today", "chat", "log", "admin", "gallery"];
  const name = (known.includes(head) ? head : "today") as RouteName;
  return { name, params: {}, anchor };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  location.hash = to.startsWith("#") ? to : `#/${to.replace(/^\//, "")}`;
}
