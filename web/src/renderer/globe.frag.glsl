#version 300 es
// One full-screen pass: a ray per pixel, intersected with the unit sphere.
// Orthographic (uDist == 0, like xearth) or perspective from uDist radii.
// Everything is computed without divergent branches so the limb can be
// antialiased with a coverage term. Output is premultiplied (alpha = disc
// coverage) and blended over the star layer drawn underneath.
precision highp float;
precision mediump sampler2DArray;

uniform vec2 uRes;
uniform float uRadiusPx;   // pixels per Earth radius
uniform float uLodScale;   // texture detail per pixel, relative to uRadiusPx's (ISS camera: ~18)
uniform vec3 uDir;         // centre → viewer
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;       // 0 = orthographic
uniform float uFocal;
uniform vec3 uSun;         // unit vector toward the Sun, Earth-fixed

uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2DArray uClouds; // the hourly cloud map: the current layer and the previous one
uniform float uCloudCur;     // which layer is current (the other is the previous)
uniform float uHasDay;
uniform float uHasNight;
uniform float uCloudMix;   // 0 → prev, 1 → cur
uniform float uCloudOn;
uniform float uLights;
uniform float uGrid;
uniform sampler2D uAurora;  // r: OVATION probability of visible aurora, 0–100 as bytes;
                            // g: GloTEC TEC, 0–120 TECU; b: D-RAP HF absorption, 0–35 MHz (ionosphere.ts)
// Data layers' u…On are strengths, 0 to 1: they fade as the clock leaves now (hazardFade.ts).
uniform float uAuroraOn;
uniform float uIonoMode;    // 0 off, 1 TEC, 2 HF absorption
uniform float uIonoFade;
uniform sampler2D uSnowIce;  // r = snow on land, g = ice concentration (NOAA IMS + Sea Ice Index)
uniform float uSnowIceOn;
uniform sampler2D uRadar;    // RainViewer composite, Web Mercator ±85.05°, premultiplied
uniform float uRadarOn;
uniform sampler2D uImerg;    // NASA IMERG rain and snow, equirectangular, radar colours, premultiplied (imerg.ts)
uniform float uImergOn;
uniform sampler2D uRadarCover; // RainViewer coverage, Web Mercator like uRadar: alpha 1 = no radar there
uniform sampler2D uSmoke;    // HMS smoke density: 0, ⅓, ⅔, 1 = none, light, medium, heavy
uniform float uSmokeOn;
uniform sampler2D uDetail;   // NASA GIBS true colour for the region on screen (zoomed in)
uniform float uDetailOn;
uniform vec4 uDetailBox;     // west lon, north lat, lon span, lat span (degrees); lon may run past 180
uniform float uDetailLive;   // what the detail is: 0 yesterday's VIIRS, 1 a live geostationary picture, 2 a sharper base map
uniform float uDetailSub;    // its satellite's longitude (radians)
uniform vec3 uDetailSun;     // the Sun's direction when it was taken
uniform sampler2DArray uLive; // live geostationary discs: GOES-West, GOES-East, MTG, IODC (liveImagery.ts)
uniform float uLiveOn;
uniform float uLiveHas[4];
uniform vec4 uLiveBox[4];    // as uDetailBox, per disc
uniform float uLiveSub[4];   // longitude below each satellite (radians)
uniform vec3 uLiveSun[4];    // the Sun's direction when each was taken
uniform float uLiveFill[4];  // 1: shown only where the other discs leave gaps
uniform sampler2D uHim;      // Himawari-9 cloud opacity (himawariClouds.ts): r = opacity × valid, g = valid
uniform float uHimOn;
uniform vec4 uHimBox;        // as uDetailBox
uniform float uHimSub;       // longitude below Himawari (radians)
uniform sampler2DArray uAsh; // Ash RGB: MSG 0°, the Indian Ocean disc, the Geo Ring (ash.ts)
uniform float uAshOn;
uniform float uAshHas[3];
uniform vec4 uAshBox[3];     // as uDetailBox, per picture
uniform float uAshSub[3];    // longitude below each satellite (radians)
uniform float uAshTier[3];   // 0 first, 1 where 0 isn't, 2 (a whole-world mosaic) under both
uniform sampler2DArray uSurface; // layer 0: sea surface temperature −2…34 °C (r) and anomaly −4…+4 °C (g), premultiplied (sst.ts);
                             // layer 1: land surface temperature −80…80 °C, afternoon (r, over b) and night (g, over a) (lst.ts);
                             // layer 2: soil moisture 0…0.75 m³/m³, top 5 cm (r) and root zone (g), premultiplied (soil.ts)
uniform float uSstMode;      // 0 off, 1 temperature, 2 anomaly
uniform float uSstFade;
uniform float uLstMode;      // 0 off, 1 each side its own (afternoon by day, night by night), 2 afternoon, 3 night
uniform float uLstFade;
uniform float uSoilMode;     // 0 off, 1 top 5 cm, 2 root zone
uniform float uSoilFade;
uniform sampler2D uNightDetail; // NASA Black Marble nightly lights for the region on screen (zoomed in), grey
uniform float uNightDetailOn;
uniform vec4 uNightDetailBox;   // as uDetailBox
uniform sampler2D uRelief;   // terrain slopes, east (r) and north (g), from ETOPO 2022 (make-relief.py)
uniform float uReliefK;      // vertical exaggeration; 0 = off (the day texture then has NASA's shading)

out vec4 outColor;

const float PI = 3.14159265359;
// Live pictures fade out between 64° and 72° from the point below their satellite (LIMB_DEG).
const float LIMB_COS = 0.309;
const float LIMB_COS_IN = 0.438;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// make-relief.py stores each slope as 127.5 + 127·sign(g)·sqrt(|g| / 0.5).
vec2 decodeSlope(vec2 t) {
  vec2 e = (t * 255.0 - 127.5) / 127.0;
  return sign(e) * e * e * 0.5;
}

// Where a lat/lon box (west lon, north lat, lon span, lat span, degrees) puts this point:
// (u, v) in 0…1 inside it.
vec2 boxUV(vec4 box, float lon, float lat) {
  return vec2(mod(degrees(lon) - box.x, 360.0) / box.z, (box.y - degrees(lat)) / box.w);
}

// 0 at a box's edge, 1 from 4% of its size in, so a fetched region's seam doesn't show.
float boxFade(vec2 duv, vec4 box, float coslat) {
  vec2 edgeDeg = min(duv, 1.0 - duv) * box.zw * vec2(coslat, 1.0);
  return smoothstep(0.0, 0.04 * min(box.z * coslat, box.w), min(edgeDeg.x, edgeDeg.y));
}

// Total electron content, low to high: deep violet, magenta, orange, pale yellow ("inferno"-like).
vec3 tecRamp(float t) {
  vec3 a = mix(vec3(0.16, 0.04, 0.42), vec3(0.78, 0.22, 0.50), smoothstep(0.0, 0.4, t));
  vec3 b = mix(a, vec3(0.98, 0.55, 0.15), smoothstep(0.35, 0.7, t));
  return mix(b, vec3(0.98, 0.95, 0.55), smoothstep(0.65, 1.0, t));
}

// Sea surface temperature, 0…30 °C: deep blue through cyan and yellow to red, cool to warm.
vec3 sstRamp(float t) {
  vec3 a = mix(vec3(0.05, 0.10, 0.35), vec3(0.10, 0.42, 0.82), smoothstep(0.0, 0.3, t));
  vec3 b = mix(a, vec3(0.25, 0.78, 0.80), smoothstep(0.25, 0.5, t));
  vec3 c = mix(b, vec3(0.97, 0.90, 0.42), smoothstep(0.45, 0.65, t));
  vec3 d = mix(c, vec3(0.97, 0.52, 0.18), smoothstep(0.62, 0.82, t));
  return mix(d, vec3(0.70, 0.08, 0.12), smoothstep(0.8, 1.0, t));
}

// SST anomaly, −1…1 for −3…+3 °C: blue, white at zero, red, as public anomaly maps draw it.
vec3 anomalyRamp(float s) {
  vec3 cold = mix(mix(vec3(0.97), vec3(0.55, 0.75, 0.92), smoothstep(0.0, 0.5, -s)), vec3(0.13, 0.30, 0.67), smoothstep(0.45, 1.0, -s));
  vec3 warm = mix(mix(vec3(0.97), vec3(0.97, 0.63, 0.48), smoothstep(0.0, 0.5, s)), vec3(0.70, 0.08, 0.15), smoothstep(0.45, 1.0, s));
  return s < 0.0 ? cold : warm;
}

// Land surface temperature, °C: violet and blue below freezing, pale at 0, then yellow, orange and
// red, deep red past 50 °C: a weather map's cold to hot, over −40…+60.
vec3 lstRamp(float c) {
  float t = clamp((c + 40.0) / 100.0, 0.0, 1.0);
  vec3 a = mix(vec3(0.32, 0.10, 0.52), vec3(0.12, 0.35, 0.85), smoothstep(0.0, 0.25, t));
  vec3 b = mix(a, vec3(0.82, 0.93, 0.97), smoothstep(0.2, 0.4, t));
  vec3 d = mix(b, vec3(0.98, 0.88, 0.35), smoothstep(0.4, 0.6, t));
  vec3 e = mix(d, vec3(0.95, 0.45, 0.12), smoothstep(0.58, 0.78, t));
  return mix(e, vec3(0.62, 0.05, 0.10), smoothstep(0.75, 1.0, t));
}

// Soil moisture, m³/m³: dry brown through tan and green to deep blue where it's soaked, over
// 0.05…0.5 (a desert's sand to a saturated loam; peat runs past it).
vec3 soilRamp(float m) {
  float t = clamp((m - 0.05) / 0.45, 0.0, 1.0);
  vec3 a = mix(vec3(0.45, 0.25, 0.08), vec3(0.85, 0.70, 0.40), smoothstep(0.0, 0.25, t));
  vec3 b = mix(a, vec3(0.55, 0.78, 0.38), smoothstep(0.2, 0.45, t));
  vec3 c = mix(b, vec3(0.15, 0.62, 0.65), smoothstep(0.45, 0.7, t));
  return mix(c, vec3(0.10, 0.22, 0.62), smoothstep(0.7, 1.0, t));
}

// HF absorption toward 35 MHz: violet, green, yellow, red. (SWPC's own maps start at blue, on
// a dark background; over the ocean blue vanishes, so the quiet sunlit cap is violet here.)
vec3 drapRamp(float t) {
  vec3 a = mix(vec3(0.72, 0.38, 1.0), vec3(0.15, 0.85, 0.35), smoothstep(0.1, 0.35, t));
  vec3 b = mix(a, vec3(1.0, 0.9, 0.15), smoothstep(0.25, 0.6, t));
  return mix(b, vec3(1.0, 0.2, 0.1), smoothstep(0.55, 1.0, t));
}

// Analytic mip level: texels per screen pixel at this point, for a texture `rows` texels
// from pole to pole. Avoids dFdx, which misbehaves across the longitude seam and at the limb.
float lodForRows(float rows, float mu, float coslat) {
  float texPerRad = rows / PI;
  float ratio = texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05));
  return log2(max(ratio, 1.0));
}

// Not overloads of one name: ANGLE's D3D11 backend passes samplers as indices, so a
// sampler2D and a sampler2DArray version become the same HLSL function and the program
// fails to compile on Windows (error X3003: redefinition), losing the context.
float lodFor(sampler2D t, float mu, float coslat) {
  return lodForRows(float(textureSize(t, 0).y), mu, coslat);
}

float lodForArray(sampler2DArray t, float mu, float coslat) {
  return lodForRows(float(textureSize(t, 0).y), mu, coslat);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRadiusPx;

  vec3 ro, rd;
  if (uDist <= 0.0) {
    ro = uDir * 4.0 + p.x * uRight + p.y * uUp;
    rd = -uDir;
  } else {
    ro = uDir * uDist;
    rd = normalize(-uDir * uFocal + p.x * uRight + p.y * uUp);
  }

  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;
  vec3 closest = ro - b * rd;
  float dq = length(closest);           // ray's nearest approach to the centre
  float t = -b - sqrt(max(h, 0.0));
  vec3 n = normalize(ro + t * rd);

  // ---- sky: just the atmosphere's glow past the limb (stars are their own pass)
  float glowLit = smoothstep(-0.3, 0.35, dot(normalize(closest), uSun));
  vec3 glow = vec3(0.30, 0.55, 1.0) * 0.55 * exp(-max(dq - 1.0, 0.0) * 22.0) * glowLit;

  // ---- surface -----------------------------------------------------------
  float lat = asin(clamp(n.z, -1.0, 1.0));
  float lon = atan(n.y, n.x);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 view = -rd;
  float mu = max(dot(n, view), 0.0);
  float coslat = cos(lat);

  vec3 albedoS = uHasDay > 0.5 ? textureLod(uDay, uv, lodFor(uDay, mu, coslat)).rgb : vec3(0.06, 0.16, 0.38);
  vec3 albedo = toLinear(albedoS);

  // Zoomed in: yesterday's VIIRS true colour in place of the Blue Marble. GIBS draws "no
  // data" black, so dark texels fall back; the box edge fades so the seam doesn't show. Or
  // (the ISS camera's) the Blue Marble itself at 500 m: a sharper albedo, and nothing more —
  // snow, relief and clouds still go on it, as on the Blue Marble (photoA stays 0).
  float detailA = 0.0;
  float photoA = 0.0;
  bool baseMap = uDetailLive > 1.5;
  if (uDetailOn > 0.5 && (uDetailLive < 0.5 || baseMap)) {
    float du = mod(degrees(lon) - uDetailBox.x, 360.0) / uDetailBox.z;
    float dv = (uDetailBox.y - degrees(lat)) / uDetailBox.w;
    if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
      float texPerRad = float(textureSize(uDetail, 0).x) / radians(uDetailBox.z);
      float lod = log2(max(texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
      vec3 d = textureLod(uDetail, vec2(du, dv), lod).rgb;
      float data = baseMap ? 1.0 : smoothstep(0.012, 0.045, max(d.r, max(d.g, d.b)));
      vec2 edgeDeg = min(vec2(du, dv), 1.0 - vec2(du, dv)) * uDetailBox.zw * vec2(coslat, 1.0);
      float edge = smoothstep(0.0, 0.04 * min(uDetailBox.z * coslat, uDetailBox.w), min(edgeDeg.x, edgeDeg.y));
      detailA = data * edge;
      albedo = mix(albedo, toLinear(d), detailA);
      photoA = baseMap ? 0.0 : detailA;
    }
  }

  // Today's snow and ice over the month's Blue Marble. Snow under forest reads
  // grey from space, so it whitens dark ground less; sea ice is a bluer white.
  float iceC = 0.0;
  if (uSnowIceOn > 0.0) {
    vec2 si = textureLod(uSnowIce, uv, lodFor(uSnowIce, mu, coslat)).rg * uSnowIceOn;
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    // (The true-colour photo already shows its own snow and ice.)
    float snowCover = si.r * mix(0.55, 0.9, smoothstep(0.02, 0.12, lum)) * (1.0 - photoA);
    albedo = mix(albedo, vec3(0.80, 0.83, 0.87), snowCover);
    iceC = si.g * (1.0 - photoA);
    albedo = mix(albedo, vec3(0.70, 0.76, 0.82), iceC * 0.9);
  }

  // Terrain lit by the real Sun: the slopes tilt the ground's normal, exaggerated (a 7 km
  // texel flattens every mountain) and eased off for the steepest so ranges don't turn to
  // black-and-white facets. At a low Sun, slopes facing it light up and the far sides fall
  // into shade; sun-facing ridges catch a little light just past the terminator. Where the
  // true-colour photo shows, its own (real) shadows take over.
  vec3 ng = n;
  if (uReliefK > 0.0) {
    vec2 g = decodeSlope(textureLod(uRelief, uv, lodFor(uRelief, mu, coslat)).rg) * uReliefK * (1.0 - photoA);
    g /= 1.0 + length(g) / 3.0;
    vec3 east = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(n, east);
    ng = normalize(n - g.x * east - g.y * north);
  }

  float k = dot(n, uSun);
  float kg = dot(ng, uSun);
  float dayW = smoothstep(-0.105, 0.06, k + clamp(kg - k, -0.03, 0.03)); // fades out by the end of civil twilight
  float lambert = clamp(k, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.25, k));
  vec3 dayCol = albedo * dayW * (0.35 + 0.65 * clamp(kg, 0.0, 1.0)) * tint * 1.1;

  // Smoke: a grey-brown haze over the sunlit ground (HMS maps it by day only),
  // under the clouds. Heavy smoke hides about half of what's below.
  float smokeA = 0.0;
  if (uSmokeOn > 0.0) {
    smokeA = textureLod(uSmoke, uv, lodFor(uSmoke, mu, coslat)).r * 0.55 * uSmokeOn;
    vec3 smoke = vec3(0.50, 0.45, 0.38) * dayW * (0.35 + 0.65 * lambert) * tint;
    dayCol = mix(dayCol, smoke, smokeA);
  }

  float nightW = 1.0 - smoothstep(-0.12, 0.02, k);
  vec3 nightTex = uHasNight > 0.5 ? toLinear(textureLod(uNight, uv, lodFor(uNight, mu, coslat)).rgb) : albedo * 0.05;
  // Zoomed in: the newest night's lights in place of 2016's. Its grey radiance takes the
  // Black Marble's warm colour; the Black Marble's dark ground stays, its old lights don't.
  if (uNightDetailOn > 0.5) {
    vec2 duv = boxUV(uNightDetailBox, lon, lat);
    if (duv.x >= 0.0 && duv.x <= 1.0 && duv.y >= 0.0 && duv.y <= 1.0) {
      float texPerRad = float(textureSize(uNightDetail, 0).x) / radians(uNightDetailBox.z);
      float lod = log2(max(texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
      vec4 d = textureLod(uNightDetail, duv, lod);
      vec3 ground = min(nightTex, vec3(0.006));
      vec3 lights = ground + toLinear(d.rgb) * vec3(1.0, 0.755, 0.36); // sRGB (1, 0.88, 0.63)
      nightTex = mix(nightTex, lights, d.a * boxFade(duv, uNightDetailBox, coslat));
    }
  }
  vec3 nightCol = nightTex * nightW * mix(0.15, 1.4, uLights);

  float ca = 0.0;
  if (uCloudOn > 0.5) {
    float lc = log2(max(float(textureSize(uClouds, 0).y) / PI / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
    ca = mix(textureLod(uClouds, vec3(uv, 1.0 - uCloudCur), lc).r, textureLod(uClouds, vec3(uv, uCloudCur), lc).r, uCloudMix);
    // Over Himawari's disc, its live clouds (the hourly map's recipe, every 10 minutes) in
    // place of the hourly map's, faded toward its limb as the live pictures are.
    if (uHimOn > 0.5) {
      vec2 hu = boxUV(uHimBox, lon, lat);
      if (hu.x >= 0.0 && hu.x <= 1.0 && hu.y >= 0.0 && hu.y <= 1.0) {
        float texPerRad = float(textureSize(uHim, 0).x) / radians(uHimBox.z);
        float lod = log2(max(texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
        vec2 hv = textureLod(uHim, hu, lod).rg;
        float w = hv.g * smoothstep(LIMB_COS, LIMB_COS_IN, coslat * cos(lon - uHimSub));
        ca = mix(ca, hv.r / max(hv.g, 1e-3), w);
      }
    }
    // The true-colour photo has its own (yesterday's) clouds: two sets would read as mush.
    ca *= 1.0 - 0.9 * photoA;
  }
  vec3 cloudCol = vec3(0.95) * dayW * (0.25 + 0.75 * lambert) * tint + vec3(0.012, 0.015, 0.022) * nightW;
  vec3 col = mix(dayCol + nightCol, cloudCol, ca * 0.92);

  // Live geostationary pictures. They're already lit by the real Sun, so they replace the
  // finished day-side colour (ground and cloud together), not the albedo, and only where the
  // Sun is well up both now and when the scan was taken (up to an hour or so ago): their night
  // side is a different product, and the terminator moves ~15° an hour. Each satellite fades toward its
  // limb; where two overlap, the one seeing more face-on takes over within a few degrees, so
  // the clouds' parallax between them doesn't ghost. A fill disc (IODC's Natural Colour) goes
  // under the others, so it shows only past their limbs. Premultiplied: livePre over liveA.
  float liveA = 0.0;
  vec3 livePre = vec3(0.0);
  if (uLiveOn > 0.5) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec3 fillAcc = vec3(0.0);
    float fillSum = 0.0;
    float fillA = 0.0;
    float texPerRad = float(textureSize(uLive, 0).x);
    for (int i = 0; i < 4; i++) {
      if (uLiveHas[i] < 0.5) continue;
      vec4 bx = uLiveBox[i];
      float du = mod(degrees(lon) - bx.x, 360.0) / bx.z;
      float dv = (bx.y - degrees(lat)) / bx.w;
      if (du < 0.0 || du > 1.0 || dv < 0.0 || dv > 1.0) continue;
      float cosg = coslat * cos(lon - uLiveSub[i]);
      float fade = smoothstep(LIMB_COS, LIMB_COS_IN, cosg);
      if (fade <= 0.0) continue;
      float lod = log2(max(texPerRad / radians(bx.z) / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
      vec3 c = textureLod(uLive, vec3(du, dv, float(i)), lod).rgb;
      float q = fade * smoothstep(0.012, 0.045, max(c.r, max(c.g, c.b))) * smoothstep(0.1, 0.25, dot(n, uLiveSun[i]));
      float w = q * exp(40.0 * (cosg - 1.0));
      if (uLiveFill[i] > 0.5) {
        fillAcc += w * toLinear(c);
        fillSum += w;
        fillA = max(fillA, q);
        continue;
      }
      acc += w * toLinear(c);
      wsum += w;
      liveA = max(liveA, q);
    }
    livePre = acc / max(wsum, 1e-30) * liveA;
    livePre += fillAcc / max(fillSum, 1e-30) * fillA * (1.0 - liveA);
    liveA += fillA * (1.0 - liveA);
  }
  // Zoomed in: the satellite seeing the view most face-on, for just what's on screen, over the discs.
  if (uDetailOn > 0.5 && uDetailLive > 0.5 && uDetailLive < 1.5) {
    float du = mod(degrees(lon) - uDetailBox.x, 360.0) / uDetailBox.z;
    float dv = (uDetailBox.y - degrees(lat)) / uDetailBox.w;
    if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
      float texPerRad = float(textureSize(uDetail, 0).x) / radians(uDetailBox.z);
      float lod = log2(max(texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
      vec3 d = textureLod(uDetail, vec2(du, dv), lod).rgb;
      float data = smoothstep(0.012, 0.045, max(d.r, max(d.g, d.b)));
      vec2 edgeDeg = min(vec2(du, dv), 1.0 - vec2(du, dv)) * uDetailBox.zw * vec2(coslat, 1.0);
      float edge = smoothstep(0.0, 0.04 * min(uDetailBox.z * coslat, uDetailBox.w), min(edgeDeg.x, edgeDeg.y));
      float q = data * edge * smoothstep(LIMB_COS, LIMB_COS_IN, coslat * cos(lon - uDetailSub)) * smoothstep(0.1, 0.25, dot(n, uDetailSun));
      livePre = livePre * (1.0 - q) + toLinear(d) * q;
      liveA = liveA * (1.0 - q) + q;
    }
  }
  // Sun 6° up and the pictures start to show; 14°, they're all there is.
  float liveW = smoothstep(0.1, 0.25, k);
  col = col * (1.0 - liveA * liveW) + livePre * liveW;
  liveA *= liveW;

  // Volcanic ash: EUMETSAT's Ash RGB, a false-colour infrared picture made for ash and SO2,
  // day and night, over everything so far. The discs fade toward their limbs as the live
  // pictures do; each tier goes under the ones before it. Their no data is transparent
  // (maskAshNoData), premultiplied, so the alpha is both the mask and the divisor.
  if (uAshOn > 0.0) {
    float texPerRad = float(textureSize(uAsh, 0).x);
    vec3 ashPre = vec3(0.0);
    float ashA = 0.0;
    for (int tier = 0; tier < 3; tier++) {
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      float ta = 0.0;
      for (int i = 0; i < 3; i++) {
        if (uAshHas[i] < 0.5 || int(uAshTier[i] + 0.5) != tier) continue;
        vec2 duv = boxUV(uAshBox[i], lon, lat);
        if (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) continue;
        float cosg = coslat * cos(lon - uAshSub[i]);
        float fade = tier == 2 ? 1.0 : smoothstep(LIMB_COS, LIMB_COS_IN, cosg);
        if (fade <= 0.0) continue;
        float lod = log2(max(texPerRad / radians(uAshBox[i].z) / (uRadiusPx * uLodScale * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
        vec4 c4 = textureLod(uAsh, vec3(duv, float(i)), lod);
        vec3 c = c4.rgb / max(c4.a, 1e-3);
        float q = fade * smoothstep(0.5, 0.9, c4.a);
        float w = tier == 2 ? q : q * exp(40.0 * (cosg - 1.0));
        acc += w * toLinear(c);
        wsum += w;
        ta = max(ta, q);
      }
      ashPre += acc / max(wsum, 1e-30) * ta * (1.0 - ashA);
      ashA += ta * (1.0 - ashA);
    }
    ashPre *= uAshOn;
    ashA *= uAshOn;
    col = col * (1.0 - ashA) + ashPre;
    liveA += ashA * (1.0 - liveA); // no sun glint on the picture
  }

  // Sea surface temperature, or how far it is from usual, as a wash over the sea, day and night.
  // The anomaly is faint near zero and strong past ±2 °C, so El Niño's tongue and the marine
  // heatwaves stand out at a glance. The texture is premultiplied: alpha is the sea's share.
  if (uSstMode > 0.5) {
    vec4 s4 = textureLod(uSurface, vec3(uv, 0.0), lodForArray(uSurface, mu, coslat));
    if (s4.a > 0.02) {
      vec2 v = s4.rg / s4.a;
      vec3 c;
      float a;
      if (uSstMode < 1.5) {
        c = sstRamp(clamp((v.r * 36.0 - 2.0) / 30.0, 0.0, 1.0));
        a = 0.85;
      } else {
        float an = v.g * 8.0 - 4.0;
        c = anomalyRamp(clamp(an / 3.0, -1.0, 1.0));
        a = 0.15 + 0.75 * smoothstep(0.3, 2.0, abs(an));
      }
      a *= smoothstep(0.5, 0.95, s4.a) * uSstFade;
      col = mix(col, toLinear(c), a);
      liveA += a * (1.0 - liveA); // no sun glint on the data
    }
  }

  // Land surface temperature, the ground's own, where a pass saw it through clear sky. Each
  // side its own: the afternoon's where the Sun is up, the night's where it's down, crossing
  // over within ~6° of the terminator. Each pass is premultiplied by its own coverage.
  if (uLstMode > 0.5) {
    vec4 l4 = textureLod(uSurface, vec3(uv, 1.0), lodForArray(uSurface, mu, coslat));
    float sunW = uLstMode < 1.5 ? smoothstep(-0.1, 0.1, k) : uLstMode < 2.5 ? 1.0 : 0.0;
    vec3 pre = vec3(0.0);
    float a = 0.0;
    if (sunW > 0.0 && l4.b > 0.02) {
      float w = sunW * smoothstep(0.5, 0.95, l4.b);
      pre += w * toLinear(lstRamp(l4.r / l4.b * 160.0 - 80.0));
      a += w;
    }
    if (sunW < 1.0 && l4.a > 0.02) {
      float w = (1.0 - sunW) * smoothstep(0.5, 0.95, l4.a);
      pre += w * toLinear(lstRamp(l4.g / l4.a * 160.0 - 80.0));
      a += w;
    }
    float f = 0.85 * uLstFade;
    col = col * (1.0 - a * f) + pre * f;
    liveA += a * f * (1.0 - liveA);
  }

  // Soil moisture (SMAP L4), the top 5 cm or the root zone, over the land day and night: a
  // model's gap-free field, so no swaths or cloud holes. Premultiplied: alpha is the land's share.
  if (uSoilMode > 0.5) {
    vec4 m4 = textureLod(uSurface, vec3(uv, 2.0), lodForArray(uSurface, mu, coslat));
    if (m4.a > 0.02) {
      float m = (uSoilMode < 1.5 ? m4.r : m4.g) / m4.a * 0.75;
      float a = 0.85 * smoothstep(0.5, 0.95, m4.a) * uSoilFade;
      col = mix(col, toLinear(soilRamp(m)), a);
      liveA += a * (1.0 - liveA);
    }
  }

  // Satellite rain (IMERG) where no radar sees, a little fainter than radar: it's an
  // estimate, and ~5 hours old. Under the radar, so the two never double up at the edge.
  bool merc = abs(lat) < 1.4844;
  vec2 ruv = vec2(uv.x, 0.5 - log(tan(PI / 4.0 + lat / 2.0)) / (2.0 * PI));
  if (uImergOn > 0.0) {
    float noRadar = merc ? textureLod(uRadarCover, ruv, 0.0).a : 1.0;
    vec4 m = textureLod(uImerg, uv, lodFor(uImerg, mu, coslat));
    float a = m.a * noRadar;
    if (a > 0.004) {
      vec3 echo = toLinear(m.rgb / m.a) * mix(0.55, 1.0, dayW);
      col = mix(col, echo, a * 0.65 * uImergOn);
    }
  }

  // Radar on top of the clouds, as on a weather map (it shows the rain beneath
  // them). The texture is Web Mercator, so latitude maps through ln tan; its
  // texel size on the ground shrinks with cos(latitude), which sets the mip level.
  if (uRadarOn > 0.0 && merc) {
    float texPerRad = float(textureSize(uRadar, 0).x) / (2.0 * PI) / max(coslat, 0.05);
    vec4 r = textureLod(uRadar, ruv, log2(max(texPerRad / (uRadiusPx * uLodScale * max(mu, 0.08)), 1.0)));
    if (r.a > 0.004) {
      vec3 echo = toLinear(r.rgb / r.a) * mix(0.55, 1.0, dayW);
      col = mix(col, echo, r.a * 0.85 * uRadarOn);
    }
  }

  // Aurora: emission ~100–300 km up, above the clouds, seen only where it's dark
  // (Sun at least ~6° below the horizon). The response 1 − exp(−2.5·p^1.4) keeps
  // the likely core of the oval bright and its low-probability fringe faint, so it
  // reads as a band rather than a slab. Green oxygen line, a red tint where strong.
  if (uAuroraOn > 0.0) {
    float ap = textureLod(uAurora, uv, 0.0).r * 2.55; // byte v/255 → v/100
    float dark = 1.0 - smoothstep(-0.16, -0.02, k);
    float glow = (1.0 - exp(-2.5 * pow(ap, 1.4))) * dark;
    vec3 aurora = mix(vec3(0.08, 0.95, 0.32), vec3(0.9, 0.2, 0.45), 0.3 * smoothstep(0.5, 1.0, ap));
    col += aurora * glow * 0.6 * uAuroraOn;
  }

  // The ionosphere, ~300 km up: a colour wash over everything below, day and night. TEC
  // fades in from ~8 TECU so the night side stays clear and the dayside crests stand out.
  // Absorption is faint at a quiet day's 1–3 MHz, clear by ~10 MHz (radio blackouts), strong
  // past 20: a flare or a proton event should stand out, not the everyday sunlit cap.
  if (uIonoMode > 0.5) {
    vec4 sw = textureLod(uAurora, uv, 0.0);
    if (uIonoMode < 1.5) {
      float t = sw.g;
      col = mix(col, toLinear(tecRamp(t)), smoothstep(0.065, 0.6, t) * 0.55 * uIonoFade);
    } else {
      float t = sw.b;
      col = mix(col, toLinear(drapRamp(t)), smoothstep(0.03, 0.45, t) * 0.6 * uIonoFade);
    }
  }

  // Sun glint on open water (ocean picked out by its blue cast).
  float ocean = uHasDay > 0.5 ? smoothstep(0.03, 0.12, albedoS.b - max(albedoS.r, albedoS.g)) : 1.0;
  vec3 hv = normalize(uSun + view);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 30.0) * 0.18 * ocean * (1.0 - ca) * (1.0 - iceC) * (1.0 - smokeA) * (1.0 - liveA) * dayW;

  // Atmosphere along the lit limb.
  col += vec3(0.30, 0.50, 1.0) * pow(1.0 - mu, 4.0) * 0.6 * smoothstep(-0.2, 0.4, k);

  // Graticule every 15°, about one pixel wide.
  if (uGrid > 0.5) {
    float latD = degrees(lat);
    float lonD = degrees(lon);
    float pxDeg = degrees(1.0 / (uRadiusPx * uLodScale * max(mu, 0.05)));
    float dLat = abs(fract(latD / 15.0 + 0.5) - 0.5) * 15.0;
    float dLon = abs(fract(lonD / 15.0 + 0.5) - 0.5) * 15.0 * coslat;
    float line = 1.0 - smoothstep(0.0, 0.8 * pxDeg, min(dLat, dLon));
    col = mix(col, vec3(0.75, 0.82, 1.0), line * 0.2);
  }

  // ---- composite ---------------------------------------------------------
  // Premultiplied: the globe covers the stars; the glow adds over them.
  float cover = clamp((1.0 - dq) * uRadiusPx + 0.5, 0.0, 1.0);
  vec3 globe = pow(col, vec3(1.0 / 2.2));
  vec3 halo = pow(glow, vec3(1.0 / 2.2));
  outColor = vec4(globe * cover + halo * (1.0 - cover), cover);
}
