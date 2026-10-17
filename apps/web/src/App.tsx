import { useEffect } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { FarmProvider } from "./app/FarmContext";
import { DateProvider } from "./app/DateContext";
import { AppShell } from "./app/AppShell";
import { navigate } from "./app/router";
import { onDeepLink } from "./lib/native";

export default function App() {
  // Deep links (push notifications, URL scheme) → in-app route.
  useEffect(() => onDeepLink(navigate), []);

  return (
    <ThemeProvider>
      <DateProvider>
        <FarmProvider>
          <AppShell />
        </FarmProvider>
      </DateProvider>
    </ThemeProvider>
  );
}
