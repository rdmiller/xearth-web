// WebGL2 plumbing: a star point pass, then the globe as one full-screen
// triangle (day, night and two cloud maps, plus aurora, snow/ice, radar and smoke) blended over it.

import type { StarCatalog } from '../stars';
import type { Camera } from '../view';
import type { Vec3 } from '../vec';
import fragSrc from './globe.frag.glsl?raw';
import { BodyLayer, type BodyDraw } from './bodies';
import { FIRE_STYLE, LIGHTNING_STYLE, SurfacePointLayer, type SurfacePoints } from './points';
import type { AuroraGrid } from '../hazards';
import { SatLayer, type SatCategoryLook } from './sats';
import { StarLayer } from './stars';

/** West lon, north lat, and spans, in degrees; lon may run past 180. */
export interface LatLonBox {
  lon0: number;
  lat1: number;
  lonSpan: number;
  latSpan: number;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export interface FrameState {
  camera: Camera;
  sun: Vec3;
  radiusPx: number;
  clouds: boolean;
  lights: boolean;
  grid: boolean;
  /** Star layer, or null when stars are off. */
  stars: { frame: Float32Array; focal: number; magShift: number } | null;
  /** Sun and Moon discs (drawn behind the globe). */
  bodies: BodyDraw[];
  aurora: boolean;
  /** Snow on land and sea ice (NOAA IMS + Sea Ice Index). */
  snowIce: boolean;
  /** RainViewer radar composite. */
  radar: boolean;
  /** NASA IMERG satellite rain where RainViewer has no radar (needs its coverage). */
  imerg: boolean;
  /** NOAA HMS smoke plumes. */
  smoke: boolean;
  /** The zoomed-in picture (when one has been set): yesterday's VIIRS, or a live one. */
  detail: boolean;
  /** Live geostationary discs (when any has been set). */
  live: boolean;
  /** Sun-lit terrain: the slopes' vertical exaggeration, or 0 for none (needs setRelief). */
  relief: number;
  /** Fire layer: detections at most `windowH` old, dimmer than `minIntensity` hidden. */
  fires: { windowH: number; minIntensity: number } | null;
  /** Lightning layer: flashes at most `windowMin` old. */
  lightning: { windowMin: number } | null;
  /** Draw the bulk satellite layer (Starlink), extrapolated `dt` seconds past its SGP4 pass. */
  satellites: { dt: number; categories: SatCategoryLook[] } | null;
  dpr: number;
}

type Slot = 'day' | 'night' | 'cloudPrev' | 'cloudCur';
/** Live geostationary discs: one array layer each, this many texels a side. */
const LIVE_LAYERS = 3;
const LIVE_PX = 2048;
const LIVE_UNIT = 12;
const UNIT: Record<Slot, number> = { day: 0, night: 1, cloudPrev: 2, cloudCur: 3 };
const SAMPLER: Record<Slot, string> = { day: 'uDay', night: 'uNight', cloudPrev: 'uCloudPrev', cloudCur: 'uCloudCur' };

export class GlobeRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly stars: StarLayer;
  private readonly sats: SatLayer;
  private readonly bodies: BodyLayer;
  private readonly fireLayer: SurfacePointLayer;
  private readonly lightningLayer: SurfacePointLayer;
  private readonly auroraTex: WebGLTexture;
  private hasAurora = false;
  private readonly snowIceTex: WebGLTexture;
  private hasSnowIce = false;
  private readonly radarTex: WebGLTexture;
  private hasRadar = false;
  private readonly smokeTex: WebGLTexture;
  private readonly imergTex: WebGLTexture;
  private hasImerg = false;
  private readonly coverTex: WebGLTexture;
  private hasCover = false;
  private hasSmoke = false;
  private readonly detailTex: WebGLTexture;
  private readonly reliefTex: WebGLTexture;
  private hasRelief = false;
  private detailBox: [number, number, number, number] | null = null;
  /** Longitude (radians) below the satellite that took the zoomed-in picture, if it's a live one. */
  private detailSub: number | null = null;
  private liveTex: WebGLTexture;
  private liveSized = false;
  private readonly liveHas = new Float32Array(LIVE_LAYERS);
  private readonly liveBox = new Float32Array(LIVE_LAYERS * 4);
  private readonly liveSub = new Float32Array(LIVE_LAYERS);
  /** The Sun's direction when each disc, and the zoomed-in live picture, was taken. */
  private readonly liveSun = new Float32Array(LIVE_LAYERS * 3);
  private detailSun: Vec3 = [0, 0, 0];
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly textures: Record<Slot, WebGLTexture>;
  private readonly loaded: Record<Slot, boolean> = { day: false, night: false, cloudPrev: false, cloudCur: false };
  private readonly aniso: EXT_texture_filter_anisotropic | null;
  /** 0 → previous cloud map, 1 → current; animated by the caller after setClouds. */
  cloudMix = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.program = link(gl, VERT, fragSrc);
    this.stars = new StarLayer(gl, (vs, fs) => link(gl, vs, fs));
    this.sats = new SatLayer(gl, (vs, fs) => link(gl, vs, fs));
    this.bodies = new BodyLayer(gl, (vs, fs) => link(gl, vs, fs));
    this.fireLayer = new SurfacePointLayer(gl, (vs, fs) => link(gl, vs, fs), FIRE_STYLE);
    this.lightningLayer = new SurfacePointLayer(gl, (vs, fs) => link(gl, vs, fs), LIGHTNING_STYLE);
    // Optional layers start as a transparent 1×1 texture: the globe shader keeps them all
    // bound, and an empty texture object on a bound unit makes WebGL warn every frame
    // ("texture … is not renderable") until the layer's data first arrives.
    const empty = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // no mipmaps to need
      return t;
    };
    this.auroraTex = empty();
    this.snowIceTex = empty();
    this.radarTex = empty();
    this.smokeTex = empty();
    this.detailTex = empty();
    this.reliefTex = empty();
    // The live discs' array starts as one transparent texel too, for the same reason.
    this.liveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.liveTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.imergTex = empty();
    this.coverTex = empty();

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.useProgram(this.program);
    const blank = (rgba: number[]) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
      return t;
    };
    this.textures = {
      day: blank([16, 40, 96, 255]),
      night: blank([0, 0, 0, 255]),
      cloudPrev: blank([0, 0, 0, 255]),
      cloudCur: blank([0, 0, 0, 255]),
    };
    for (const slot of Object.keys(UNIT) as Slot[]) gl.uniform1i(this.u(SAMPLER[slot]), UNIT[slot]);
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  private upload(slot: Slot, image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // row 0 = north = v 0
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.loaded[slot] = true;
  }

  setDay(image: TexImageSource) {
    this.upload('day', image);
  }

  setNight(image: TexImageSource) {
    this.upload('night', image);
  }

  /** Show a new cloud map; the previous one is kept for a cross-fade (cloudMix 0 → 1). */
  setClouds(image: TexImageSource) {
    if (this.loaded.cloudCur) {
      [this.textures.cloudPrev, this.textures.cloudCur] = [this.textures.cloudCur, this.textures.cloudPrev];
      this.loaded.cloudPrev = true;
      this.cloudMix = 0;
    } else {
      this.cloudMix = 1;
    }
    this.upload('cloudCur', image);
    // The swap changed which texture object sits in each unit.
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + UNIT.cloudPrev);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.cloudPrev);
  }

  get hasClouds() {
    return this.loaded.cloudCur;
  }

  /** Aurora probability grid (row 0 = north pole, column 0 = −180°), one byte per cell. */
  setAurora(grid: AuroraGrid) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, grid.width, grid.height, 0, gl.RED, gl.UNSIGNED_BYTE, grid.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasAurora = true;
  }

  /** Snow (red) and ice concentration (green) on the globe's grid. */
  setSnowIce(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.snowIceTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasSnowIce = true;
  }

  /** Terrain slopes (east in red, north in green, encoded as make-relief.py writes them). */
  setRelief(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.reliefTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasRelief = true;
  }

  /**
   * Radar composite in Web Mercator (square, ±85.05°), straight alpha. Premultiplied
   * on upload so filtering doesn't darken the edges of the echoes.
   */
  setRadar(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.radarTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasRadar = true;
  }

  /** IMERG rain and snow on the globe's grid, in radar colours, straight alpha (premultiplied on upload). */
  setImerg(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.imergTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasImerg = true;
  }

  /** RainViewer's coverage in Web Mercator, like the radar: alpha 1 where no radar sees. */
  setRadarCoverage(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE14);
    gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasCover = true;
  }

  /** Smoke density on the globe's grid (red: 0, ⅓, ⅔, 1 = none, light, medium, heavy). */
  setSmoke(image: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.smokeTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasSmoke = true;
  }

  /**
   * One satellite's live disc (layer 0–2) for a lat/lon box, with the longitude below the
   * satellite (degrees). Drawn to the array's fixed size first, whatever size it came at.
   */
  setLive(layer: number, image: CanvasImageSource, box: LatLonBox, subLon: number, scanSun: Vec3) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + LIVE_UNIT);
    if (!this.liveSized) {
      gl.deleteTexture(this.liveTex);
      this.liveTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.liveTex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(LIVE_PX) + 1, gl.RGBA8, LIVE_PX, LIVE_PX, LIVE_LAYERS);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      this.liveSized = true;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.liveTex);
    const canvas = new OffscreenCanvas(LIVE_PX, LIVE_PX);
    canvas.getContext('2d')!.drawImage(image, 0, 0, LIVE_PX, LIVE_PX);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, LIVE_PX, LIVE_PX, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.liveHas[layer] = 1;
    this.liveBox.set([box.lon0, box.lat1, box.lonSpan, box.latSpan], layer * 4);
    this.liveSub[layer] = (subLon * Math.PI) / 180;
    this.liveSun.set(scanSun, layer * 3);
  }

  get hasLive() {
    return this.liveHas.some((v) => v > 0);
  }

  /**
   * The zoomed-in picture for a lat/lon box (west, north, lon span, lat span in degrees).
   * `live`: it's a live picture, taken from above this longitude with the Sun there; else
   * yesterday's VIIRS.
   */
  setDetail(image: TexImageSource, box: LatLonBox, live?: { subLon: number; scanSun: Vec3 }) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.detailBox = [box.lon0, box.lat1, box.lonSpan, box.latSpan];
    this.detailSub = live ? (live.subLon * Math.PI) / 180 : null;
    if (live) this.detailSun = live.scanSun;
  }

  clearDetail() {
    this.detailBox = null;
  }

  setFires(points: SurfacePoints) {
    this.fireLayer.setPoints(points);
  }

  setLightning(points: SurfacePoints) {
    this.lightningLayer.setPoints(points);
  }

  setSun(image: TexImageSource, limb: number) {
    this.bodies.setSunTexture(image, limb);
  }

  setMoon(image: TexImageSource) {
    this.bodies.setMoonTexture(image);
  }

  setStars(catalog: StarCatalog) {
    this.stars.setCatalog(catalog);
  }

  /** Bulk satellite positions (Earth radii, origin = none) and velocities (Earth radii/s). */
  setSatellites(xyz: Float32Array<ArrayBuffer>, vel: Float32Array<ArrayBuffer>) {
    this.sats.setPositions(xyz, vel);
  }

  /** Category per bulk satellite (index into the frame's `satellites.categories`). */
  setSatelliteCategories(category: Uint8Array) {
    this.sats.setCategories(category);
  }

  /** Match the drawing buffer to the canvas's CSS size × devicePixelRatio. */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  render(f: FrameState) {
    const gl = this.gl;
    const { camera: cam } = f;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (f.stars) {
      this.stars.draw(
        { camera: cam, radiusPx: f.radiusPx, dpr: f.dpr, ...f.stars },
        [this.canvas.width, this.canvas.height],
      );
    }

    this.bodies.draw(f.bodies, [this.canvas.width, this.canvas.height]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    for (const slot of Object.keys(UNIT) as Slot[]) {
      gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    }
    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform3fv(this.u('uDir'), cam.dir);
    gl.uniform3fv(this.u('uRight'), cam.right);
    gl.uniform3fv(this.u('uUp'), cam.up);
    gl.uniform1f(this.u('uDist'), cam.dist);
    gl.uniform1f(this.u('uFocal'), cam.focal);
    gl.uniform3fv(this.u('uSun'), f.sun);
    gl.uniform1f(this.u('uHasDay'), this.loaded.day ? 1 : 0);
    gl.uniform1f(this.u('uHasNight'), this.loaded.night ? 1 : 0);
    gl.uniform1f(this.u('uCloudMix'), this.cloudMix);
    gl.uniform1f(this.u('uCloudOn'), f.clouds && this.loaded.cloudCur ? 1 : 0);
    gl.uniform1f(this.u('uLights'), f.lights ? 1 : 0);
    gl.uniform1f(this.u('uGrid'), f.grid ? 1 : 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.uniform1i(this.u('uAurora'), 5);
    gl.uniform1f(this.u('uAuroraOn'), f.aurora && this.hasAurora ? 1 : 0);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.snowIceTex);
    gl.uniform1i(this.u('uSnowIce'), 7);
    gl.uniform1f(this.u('uSnowIceOn'), f.snowIce && this.hasSnowIce ? 1 : 0);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.radarTex);
    gl.uniform1i(this.u('uRadar'), 8);
    gl.uniform1f(this.u('uRadarOn'), f.radar && this.hasRadar ? 1 : 0);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.imergTex);
    gl.uniform1i(this.u('uImerg'), 13);
    gl.activeTexture(gl.TEXTURE14);
    gl.bindTexture(gl.TEXTURE_2D, this.coverTex);
    gl.uniform1i(this.u('uRadarCover'), 14);
    // Without the coverage, a 5-hour-old estimate would sit under live radar: wait for it.
    gl.uniform1f(this.u('uImergOn'), f.imerg && this.hasImerg && this.hasCover ? 1 : 0);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.smokeTex);
    gl.uniform1i(this.u('uSmoke'), 9);
    gl.uniform1f(this.u('uSmokeOn'), f.smoke && this.hasSmoke ? 1 : 0);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.detailTex);
    gl.uniform1i(this.u('uDetail'), 10);
    gl.uniform1f(this.u('uDetailOn'), f.detail && this.detailBox ? 1 : 0);
    if (this.detailBox) gl.uniform4fv(this.u('uDetailBox'), this.detailBox);
    gl.uniform1f(this.u('uDetailLive'), this.detailSub === null ? 0 : 1);
    gl.uniform1f(this.u('uDetailSub'), this.detailSub ?? 0);
    gl.uniform3fv(this.u('uDetailSun'), this.detailSun);
    gl.activeTexture(gl.TEXTURE0 + LIVE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.liveTex);
    gl.uniform1i(this.u('uLive'), LIVE_UNIT);
    gl.uniform1f(this.u('uLiveOn'), f.live && this.hasLive ? 1 : 0);
    gl.uniform1fv(this.u('uLiveHas'), this.liveHas);
    gl.uniform4fv(this.u('uLiveBox'), this.liveBox);
    gl.uniform1fv(this.u('uLiveSub'), this.liveSub);
    gl.uniform3fv(this.u('uLiveSun'), this.liveSun);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.reliefTex);
    gl.uniform1i(this.u('uRelief'), 11);
    gl.uniform1f(this.u('uReliefK'), this.hasRelief ? f.relief : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    const res: [number, number] = [this.canvas.width, this.canvas.height];
    if (f.fires) {
      this.fireLayer.draw({ camera: cam, radiusPx: f.radiusPx, sun: f.sun, window: f.fires.windowH, minIntensity: f.fires.minIntensity }, res);
    }
    if (f.lightning) {
      this.lightningLayer.draw({ camera: cam, radiusPx: f.radiusPx, sun: f.sun, window: f.lightning.windowMin, minIntensity: 0 }, res);
    }

    if (f.satellites) {
      this.sats.draw(
        { camera: cam, radiusPx: f.radiusPx, sun: f.sun, dpr: f.dpr, dt: f.satellites.dt, categories: f.satellites.categories },
        [this.canvas.width, this.canvas.height],
      );
    }
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}
