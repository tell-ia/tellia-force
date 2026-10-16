import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { GOOGLE_FONTS_HREF, themeVars, type ThemeName } from "./tokens";

interface ThemeCtx {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function initialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem("tf-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* private mode / blocked storage — fall through */
  }
  return typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

let fontsLoaded = false;
function ensureFonts(): void {
  if (fontsLoaded || typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS_HREF;
  document.head.appendChild(link);
  fontsLoaded = true;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    ensureFonts();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, val] of Object.entries(themeVars(theme))) {
      root.style.setProperty(k, val);
    }
    root.style.colorScheme = theme;
    root.setAttribute("data-theme", theme);
    document.body.style.background = "var(--tf-bg)";
    try {
      localStorage.setItem("tf-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      setTheme: setThemeState,
      toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    }),
    [theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme must be used inside ThemeProvider");
  return c;
}
