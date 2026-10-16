import { ThemeProvider } from "./theme/ThemeProvider";
import { FarmProvider } from "./app/FarmContext";
import { AppShell } from "./app/AppShell";

export default function App() {
  return (
    <ThemeProvider>
      <FarmProvider>
        <AppShell />
      </FarmProvider>
    </ThemeProvider>
  );
}
