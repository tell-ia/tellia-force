import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initNative } from "./lib/native";
import "./index.css";

initNative();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
