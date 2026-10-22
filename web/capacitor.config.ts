// Capacitor: the Android app bundles the built site (dist/) and runs it in the system
// WebView. The layer data and NASA textures aren't bundled — they come from the hosted
// server named by VITE_DATA_BASE in .env.android (see README, "Android").
//
// appId is a placeholder: change it (here and in android/app/build.gradle) to a reverse
// domain you control before publishing.

import type { CapacitorConfig } from '@capacitor/cli';

// Testing only: XEARTH_ANDROID_LOCAL=1 at `cap sync` lets the app read data over plain http
// (e.g. the Docker stack at http://10.0.2.2:8090/ from the emulator). Never ship with it.
const local = process.env.XEARTH_ANDROID_LOCAL === '1';

const config: CapacitorConfig = {
  appId: 'dev.xearthweb.app',
  appName: 'xearth',
  webDir: 'dist',
  backgroundColor: '#000000',
  android: {
    backgroundColor: '#000000',
    allowMixedContent: local,
  },
  server: local ? { cleartext: true } : undefined,
};

export default config;
