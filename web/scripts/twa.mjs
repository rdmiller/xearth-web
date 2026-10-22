#!/usr/bin/env node
// Android TWA (Trusted Web Activity) helpers for Bubblewrap. A TWA is a thin Android app
// that opens the hosted site full-screen in Chrome — no bundle, so it updates with the site.
//
//   node scripts/twa.mjs manifest --url https://you.github.io/xearth-web/ [--package dev.xearthweb.twa]
//       Writes android-twa/twa-manifest.json, Bubblewrap's project file, from the site's
//       web manifest values. Then, in android-twa/: npx @bubblewrap/cli build
//
//   node scripts/twa.mjs assetlinks --fingerprint AA:BB:… [--package dev.xearthweb.twa]
//       Writes public/.well-known/assetlinks.json: the site's statement that this app (signed
//       with that key) may open it as a TWA. Deployed with the site, it lets Chrome drop the
//       URL bar. Get the fingerprint from `npx @bubblewrap/cli fingerprint list` (or keytool),
//       and add Play App Signing's too if Google Play re-signs the app.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PACKAGE = 'dev.xearthweb.twa';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function twaManifest(siteUrl, packageId) {
  const url = new URL(siteUrl);
  if (url.protocol !== 'https:') fail('The site must be served over https for a TWA.');
  const base = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const web = JSON.parse(readFileSync(join(WEB, 'public', 'manifest.webmanifest'), 'utf8'));
  const at = (p) => new URL(p, `${url.origin}${base}`).href;
  return {
    packageId,
    host: url.host,
    name: web.name,
    launcherName: web.short_name,
    display: web.display,
    orientation: 'default',
    themeColor: web.theme_color,
    themeColorDark: web.theme_color,
    navigationColor: web.background_color,
    navigationColorDark: web.background_color,
    navigationDividerColor: web.background_color,
    navigationDividerColorDark: web.background_color,
    backgroundColor: web.background_color,
    enableNotifications: false,
    startUrl: base,
    iconUrl: at('icons/icon-512.png'),
    maskableIconUrl: at('icons/icon-maskable-512.png'),
    splashScreenFadeOutDuration: 300,
    signingKey: { path: './android.keystore', alias: 'android' },
    appVersionName: '1',
    appVersionCode: 1,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: at('manifest.webmanifest'),
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: at(''),
    minSdkVersion: 24, // androidbrowserhelper 2.7 needs 24 (Android 7.0)
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
  };
}

export function assetLinks(packageId, fingerprints) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageId, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

const command = process.argv[2];
const packageId = arg('package', DEFAULT_PACKAGE);
if (command === 'manifest') {
  const url = arg('url');
  if (!url) fail('usage: twa.mjs manifest --url https://host/path/ [--package id]');
  const out = join(WEB, 'android-twa', 'twa-manifest.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(twaManifest(url, packageId), null, 2)}\n`);
  console.log(`wrote ${out}\nnext: cd android-twa && npx @bubblewrap/cli update --skipVersionUpgrade && npx @bubblewrap/cli build`);
} else if (command === 'assetlinks') {
  const prints = (arg('fingerprint', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!prints.length || prints.some((p) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(p))) {
    fail('usage: twa.mjs assetlinks --fingerprint AA:BB:…(32 bytes)[,another] [--package id]');
  }
  const out = join(WEB, 'public', '.well-known', 'assetlinks.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(assetLinks(packageId, prints), null, 2)}\n`);
  console.log(`wrote ${out} — deploy the site so https://<host>/.well-known/assetlinks.json serves it`);
} else {
  fail('usage: twa.mjs manifest --url https://host/path/ | assetlinks --fingerprint AA:BB:…');
}
