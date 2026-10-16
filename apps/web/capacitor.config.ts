import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tellia.force",
  appName: "Tellia Force",
  webDir: "dist",
  // For live-reload on a device during the hackathon, run `vite --host` and set:
  //   server: { url: "http://YOUR-LAN-IP:5173", cleartext: true }
  server: {
    androidScheme: "https",
    // Dev only: allow plain-http calls to the dev API (10.0.2.2 / LAN IP).
    cleartext: true,
  },
  android: {
    // Dev only: the app is served over https://localhost, so let the WebView
    // call the plain-http dev API without blocking it as mixed content.
    // Remove for a prod build that hits an https API.
    allowMixedContent: true,
  },
};

export default config;
