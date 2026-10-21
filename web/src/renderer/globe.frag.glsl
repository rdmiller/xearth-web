#version 300 es
// One full-screen pass: a ray per pixel, intersected with the unit sphere.
// Orthographic (uDist == 0, like xearth) or perspective from uDist radii.
// Everything is computed without divergent branches so the limb can be
// antialiased by blending globe and sky with a coverage term.
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
uniform float uStars;

out vec4 outColor;

const float PI = 3.14159265359;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

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

  // ---- sky ---------------------------------------------------------------
  vec3 sky = vec3(0.0);
  if (uStars > 0.5) {
    vec2 cell = floor(gl_FragCoord.xy / 2.0);
    float s = step(0.998, hash(cell));
    sky += vec3(0.85, 0.9, 1.0) * s * (0.35 + 0.65 * hash(cell + 7.0));
  }
  float glowLit = smoothstep(-0.3, 0.35, dot(normalize(closest), uSun));
  sky += vec3(0.30, 0.55, 1.0) * 0.55 * exp(-max(dq - 1.0, 0.0) * 22.0) * glowLit;

  // ---- surface -----------------------------------------------------------
  float lat = asin(clamp(n.z, -1.0, 1.0));
  float lon = atan(n.y, n.x);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 view = -rd;
  float mu = max(dot(n, view), 0.0);
  float coslat = cos(lat);

  vec3 albedoS = uHasDay > 0.5 ? textureLod(uDay, uv, lodFor(uDay, mu, coslat)).rgb : vec3(0.06, 0.16, 0.38);
  vec3 albedo = toLinear(albedoS);

  float k = dot(n, uSun);
  float dayW = smoothstep(-0.105, 0.06, k);       // fades out by the end of civil twilight
  float lambert = clamp(k, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.62, 0.38), vec3(1.0), smoothstep(0.0, 0.25, k));
  vec3 dayCol = albedo * dayW * (0.35 + 0.65 * lambert) * tint * 1.1;

  float nightW = 1.0 - smoothstep(-0.12, 0.02, k);
  vec3 nightTex = uHasNight > 0.5 ? toLinear(textureLod(uNight, uv, lodFor(uNight, mu, coslat)).rgb) : albedo * 0.05;
  vec3 nightCol = nightTex * nightW * mix(0.15, 1.4, uLights);

  float ca = 0.0;
  if (uCloudOn > 0.5) {
    float lc = lodFor(uCloudCur, mu, coslat);
    ca = mix(textureLod(uCloudPrev, uv, lc).r, textureLod(uCloudCur, uv, lc).r, uCloudMix);
  }
  vec3 cloudCol = vec3(0.95) * dayW * (0.25 + 0.75 * lambert) * tint + vec3(0.012, 0.015, 0.022) * nightW;
  vec3 col = mix(dayCol + nightCol, cloudCol, ca * 0.92);

  // Sun glint on open water (ocean picked out by its blue cast).
  float ocean = uHasDay > 0.5 ? smoothstep(0.03, 0.12, albedoS.b - max(albedoS.r, albedoS.g)) : 1.0;
  vec3 hv = normalize(uSun + view);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, hv), 0.0), 30.0) * 0.18 * ocean * (1.0 - ca) * dayW;

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
  float cover = clamp((1.0 - dq) * uRadiusPx + 0.5, 0.0, 1.0);
  vec3 outLin = mix(sky, col, cover);
  outColor = vec4(pow(outLin, vec3(1.0 / 2.2)), 1.0);
}
