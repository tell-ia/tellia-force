import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.tellia.force",
  appName: "Tellia Force",
  webDir: "dist",
  // For live-reload on a device during the hackathon, run `vite --host` and set:
  //   server: { url: "http://YOUR-LAN-IP:5173", cleartext: true }
  server: {
    androidScheme: "https",
  },
};

export default config;
