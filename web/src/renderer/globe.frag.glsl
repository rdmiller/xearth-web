#version 300 es
// One full-screen pass: a ray per pixel, intersected with the unit sphere.
// Orthographic (uDist == 0, like xearth) or perspective from uDist radii.
// Everything is computed without divergent branches so the limb can be
// antialiased with a coverage term. Output is premultiplied (alpha = disc
// coverage) and blended over the star layer drawn underneath.
precision highp float;

uniform vec2 uRes;
uniform float uRadiusPx;   // pixels per Earth radius
uniform vec3 uDir;         // centre → viewer
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uDist;       // 0 = orthographic
uniform float uFocal;
uniform vec3 uSun;         // unit vector toward the Sun, Earth-fixed

uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uCloudPrev;
uniform sampler2D uCloudCur;
uniform float uHasDay;
uniform float uHasNight;
uniform float uCloudMix;   // 0 → prev, 1 → cur
uniform float uCloudOn;
uniform float uLights;
uniform float uGrid;
uniform sampler2D uAurora;  // OVATION probability of visible aurora, 0–100 as bytes
uniform float uAuroraOn;
uniform sampler2D uSnowIce;  // r = snow on land, g = ice concentration (NOAA IMS + Sea Ice Index)
uniform float uSnowIceOn;
uniform sampler2D uRadar;    // RainViewer composite, Web Mercator ±85.05°, premultiplied
uniform float uRadarOn;
uniform sampler2D uSmoke;    // HMS smoke density: 0, ⅓, ⅔, 1 = none, light, medium, heavy
uniform float uSmokeOn;
uniform sampler2D uDetail;   // NASA GIBS true colour for the region on screen (zoomed in)
uniform float uDetailOn;
uniform vec4 uDetailBox;     // west lon, north lat, lon span, lat span (degrees); lon may run past 180

out vec4 outColor;

const float PI = 3.14159265359;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }

// Analytic mip level: texels per screen pixel at this point. Avoids dFdx,
// which misbehaves across the longitude seam and at the limb.
float lodFor(sampler2D t, float mu, float coslat) {
  float texPerRad = float(textureSize(t, 0).y) / PI;
  float ratio = texPerRad / (uRadiusPx * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05));
  return log2(max(ratio, 1.0));
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
  // data" black, so dark texels fall back; the box edge fades so the seam doesn't show.
  float detailA = 0.0;
  if (uDetailOn > 0.5) {
    float du = mod(degrees(lon) - uDetailBox.x, 360.0) / uDetailBox.z;
    float dv = (uDetailBox.y - degrees(lat)) / uDetailBox.w;
    if (du >= 0.0 && du <= 1.0 && dv >= 0.0 && dv <= 1.0) {
      float texPerRad = float(textureSize(uDetail, 0).x) / radians(uDetailBox.z);
      float lod = log2(max(texPerRad / (uRadiusPx * max(mu, 0.08)) * inversesqrt(max(coslat, 0.05)), 1.0));
      vec3 d = textureLod(uDetail, vec2(du, dv), lod).rgb;
      float data = smoothstep(0.012, 0.045, max(d.r, max(d.g, d.b)));
      vec2 edgeDeg = min(vec2(du, dv), 1.0 - vec2(du, dv)) * uDetailBox.zw * vec2(coslat, 1.0);
      float edge = smoothstep(0.0, 0.04 * min(uDetailBox.z * coslat, uDetailBox.w), min(edgeDeg.x, edgeDeg.y));
      detailA = data * edge;
      albedo = mix(albedo, toLinear(d), detailA);
    }
  }

  // Today's snow and ice over the month's Blue Marble. Snow under forest reads
  // grey from space, so it whitens dark ground less; sea ice is a bluer white.
  float iceC = 0.0;
  if (uSnowIceOn > 0.5) {
    vec2 si = textureLod(uSnowIce, uv, lodFor(uSnowIce, mu, coslat)).rg;
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    // (The true-colour photo already shows its own snow and ice.)
    float snowCover = si.r * mix(0.55, 0.9, smoothstep(0.02, 0.12, lum)) * (1.0 - detailA);
    albedo = mix(albedo, vec3(0.80, 0.83, 0.87), snowCover);
    iceC = si.g * (1.0 - detailA);
    albedo = mix(albedo, vec3(0.70, 0.76, 0.82), iceC * 0.9);
  }

  float k = dot(n, uSun);
  float dayW = smoothstep(-0.105, 0.06, k);       // fades out by the end of civil twilight
  float lambert = clamp(k, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.25, k));
  vec3 dayCol = albedo * dayW * (0.35 + 0.65 * lambert) * tint * 1.1;

  // Smoke: a grey-brown haze over the sunlit ground (HMS maps it by day only),
  // under the clouds. Heavy smoke hides about half of what's below.
  float smokeA = 0.0;
  if (uSmokeOn > 0.5) {
    smokeA = textureLod(uSmoke, uv, lodFor(uSmoke, mu, coslat)).r * 0.55;
    vec3 smoke = vec3(0.50, 0.45, 0.38) * dayW * (0.35 + 0.65 * lambert) * tint;
    dayCol = mix(dayCol, smoke, smokeA);
  }

  float nightW = 1.0 - smoothstep(-0.12, 0.02, k);
  vec3 nightTex = uHasNight > 0.5 ? toLinear(textureLod(uNight, uv, lodFor(uNight, mu, coslat)).rgb) : albedo * 0.05;
  vec3 nightCol = nightTex * nightW * mix(0.15, 1.4, uLights);

  float ca = 0.0;
  if (uCloudOn > 0.5) {
    float lc = lodFor(uCloudCur, mu, coslat);
    ca = mix(textureLod(uCloudPrev, uv, lc).r, textureLod(uCloudCur, uv, lc).r, uCloudMix);
    // The true-colour photo has its own (yesterday's) clouds: two sets would read as mush.
    ca *= 1.0 - 0.9 * detailA;
  }
  vec3 cloudCol = vec3(0.95) * dayW * (0.25 + 0.75 * lambert) * tint + vec3(0.012, 0.015, 0.022) * nightW;
  vec3 col = mix(dayCol + nightCol, cloudCol, ca * 0.92);

  // Radar on top of the clouds, as on a weather map (it shows the rain beneath
  // them). The texture is Web Mercator, so latitude maps through ln tan; its
  // texel size on the ground shrinks with cos(latitude), which sets the mip level.
  if (uRadarOn > 0.5 && abs(lat) < 1.4844) {
    vec2 ruv = vec2(uv.x, 0.5 - log(tan(PI / 4.0 + lat / 2.0)) / (2.0 * PI));
    float texPerRad = float(textureSize(uRadar, 0).x) / (2.0 * PI) / max(coslat, 0.05);
    vec4 r = textureLod(uRadar, ruv, log2(max(texPerRad / (uRadiusPx * max(mu, 0.08)), 1.0)));
    if (r.a > 0.004) {
      vec3 echo = toLinear(r.rgb / r.a) * mix(0.55, 1.0, dayW);
      col = mix(col, echo, r.a * 0.85);
    }
  }

  // Aurora: emission ~100–300 km up, above the clouds, seen only where it's dark
  // (Sun at least ~6° below the horizon). The response 1 − exp(−2.5·p^1.4) keeps
  // the likely core of the oval bright and its low-probability fringe faint, so it
  // reads as a band rather than a slab. Green oxygen line, a red tint where strong.
  if (uAuroraOn > 0.5) {
    float ap = textureLod(uAurora, uv, 0.0).r * 2.55; // byte v/255 → v/100
    float dark = 1.0 - smoothstep(-0.16, -0.02, k);
    float glow = (1.0 - exp(-2.5 * pow(ap, 1.4))) * dark;
    vec3 aurora = mix(vec3(0.08, 0.95, 0.32), vec3(0.9, 0.2, 0.45), 0.3 * smoothstep(0.5, 1.0, ap));
    col += aurora * glow * 0.6;
  }

  // Sun glint on open water (ocean picked out by its blue cast).
  float ocean = uHasDay > 0.5 ? smoothstep(0.03, 0.12, albedoS.b - max(albedoS.r, albedoS.g)) : 1.0;
  vec3 hv = normalize(uSun + view);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 30.0) * 0.18 * ocean * (1.0 - ca) * (1.0 - iceC) * (1.0 - smokeA) * dayW;

  // Atmosphere along the lit limb.
  col += vec3(0.30, 0.50, 1.0) * pow(1.0 - mu, 4.0) * 0.6 * smoothstep(-0.2, 0.4, k);

  // Graticule every 15°, about one pixel wide.
  if (uGrid > 0.5) {
    float latD = degrees(lat);
    float lonD = degrees(lon);
    float pxDeg = degrees(1.0 / (uRadiusPx * max(mu, 0.05)));
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
