import { useEffect } from "react";
import { ThemeProvider } from "./theme/ThemeProvider";
import { FarmProvider } from "./app/FarmContext";
import { DateProvider } from "./app/DateContext";
import { EquipmentProvider } from "./app/EquipmentContext";
import { FarmPlanProvider } from "./app/FarmPlanContext";
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
          <EquipmentProvider>
            <FarmPlanProvider>
              <AppShell />
            </FarmPlanProvider>
          </EquipmentProvider>
        </FarmProvider>
      </DateProvider>
    </ThemeProvider>
  );
}
