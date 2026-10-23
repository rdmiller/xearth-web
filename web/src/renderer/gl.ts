// WebGL2 plumbing: a star point pass, then the globe as one full-screen
// triangle (day, night and two cloud maps, plus aurora, snow/ice, radar and smoke) blended over it.

import type { StarCatalog } from '../stars';
import type { Camera } from '../view';
import type { Vec3 } from '../vec';
import fragSrc from './globe.frag.glsl?raw';
import { BodyLayer, type BodyDraw } from './bodies';
import { ModelLayer, type ModelDraw } from './model';
import { FIRE_STYLE, FLOOD_STYLE, LIGHTNING_STYLE, SurfacePointLayer, type SurfacePoints } from './points';
import type { AuroraGrid } from '../hazards';
import { SatLayer, type SatCategoryLook } from './sats';
import { StarLayer } from './stars';

/** Whose zoomed-in pictures: the main view's, or the ISS camera's (renderView). */
export type DetailSlot = 'main' | 'camera';

/** A zoomed-in picture: its texture and box, and what it is (0 yesterday's VIIRS, 1 live, 2 a base map). */
interface DetailPicture {
  tex: WebGLTexture;
  box: [number, number, number, number] | null;
  kind: number;
  /** A live picture's: the longitude below its satellite (radians), and the Sun when it was taken. */
  sub: number;
  sun: Vec3;
}

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
  /** Ionosphere wash: GloTEC total electron content, D-RAP HF absorption, or none. */
  iono: 'off' | 'tec' | 'drap';
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
  /** Whose zoomed-in pictures (detail, nightDetail): the main view's (the default) or the ISS camera's. */
  detailSlot?: DetailSlot;
  /** Live geostationary discs (when any has been set). */
  live: boolean;
  /** Himawari-9's live clouds over its disc, in place of the hourly map's (when set). */
  himawari: boolean;
  /** Volcanic ash: the Ash RGB pictures over everything below (when any has been set). */
  ash: boolean;
  /** Sea surface temperature: 0 off, 1 the temperature, 2 its anomaly (when set). */
  sst: number;
  /** GIBS night-lights detail (when one has been set). */
  nightDetail: boolean;
  /** Sun-lit terrain: the slopes' vertical exaggeration, or 0 for none (needs setRelief). */
  relief: number;
  /** Fire layer: detections at most `windowH` old, dimmer than `minIntensity` hidden. */
  fires: { windowH: number; minIntensity: number } | null;
  /** Flood extent (NASA LANCE), with the GDACS events. */
  floods: boolean;
  /** Lightning layer: flashes at most `windowMin` old. */
  lightning: { windowMin: number } | null;
  /** Draw the bulk satellite layer (Starlink), extrapolated `dt` seconds past its SGP4 pass. */
  satellites: { dt: number; categories: SatCategoryLook[] } | null;
  dpr: number;
  /**
   * Pixels per Earth radius on the ground, over radiusPx: how much finer the textures must be
   * sampled than radiusPx says. 1 when absent; the ISS camera's ground is ~18× nearer.
   */
  lodScale?: number;
  /** A model drawn over everything (the ISS under its camera); renderView only. */
  model?: ModelDraw;
}

type Slot = 'day' | 'night';
/** Live geostationary discs: one array layer each, this many texels a side. */
const LIVE_LAYERS = 4;
const LIVE_PX = 2048;
const LIVE_UNIT = 12;
/** Himawari's cloud opacity. Unit 4 is the Sun and Moon's too (bodies.ts), so it's bound every frame. */
const HIM_UNIT = 4;
/** The Ash RGB pictures (ash.ts): MSG 0°, the Indian Ocean disc, the Geo Ring. Unit 6, as 4. */
const ASH_LAYERS = 3;
const ASH_UNIT = 6;
const UNIT: Record<Slot, number> = { day: 0, night: 1 };
const SAMPLER: Record<Slot, string> = { day: 'uDay', night: 'uNight' };
/**
 * The hourly cloud map: one two-layer array (the current map and the previous, for the
 * cross-fade), so both take one texture unit of the 16 WebGL promises.
 */
const CLOUD_UNIT = 2;
/** Sea surface temperature and its anomaly (sst.ts), in the unit the cloud array freed. */
const SST_UNIT = 3;

export class GlobeRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly stars: StarLayer;
  private readonly sats: SatLayer;
  private readonly bodies: BodyLayer;
  private readonly fireLayer: SurfacePointLayer;
  private readonly floodLayer: SurfacePointLayer;
  private readonly lightningLayer: SurfacePointLayer;
  private readonly auroraTex: WebGLTexture;
  private hasAurora = false;
  /** One space-weather texture on the aurora's 1° grid: aurora (r), TEC (g), D-RAP (b). */
  private auroraBytes: Uint8Array | null = null;
  private tecBytes: Uint8Array | null = null;
  private drapBytes: Uint8Array | null = null;
  private swSize = { width: 360, height: 181 };
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
  /**
   * The zoomed-in pictures, by day (unit 10) and by night (unit 15): the main view's, and the
   * ISS camera's own for its pass (FrameState.detailSlot), bound to the same units in turn.
   */
  private readonly details: Record<DetailSlot, DetailPicture>;
  private readonly nightDetails: Record<DetailSlot, { tex: WebGLTexture; box: [number, number, number, number] | null }>;
  private readonly reliefTex: WebGLTexture;
  private hasRelief = false;
  private liveTex: WebGLTexture;
  private liveSized = false;
  private readonly liveHas = new Float32Array(LIVE_LAYERS);
  private readonly liveBox = new Float32Array(LIVE_LAYERS * 4);
  private readonly liveSub = new Float32Array(LIVE_LAYERS);
  /** 1 for a disc shown only where the others leave gaps (LiveSource.fill). */
  private readonly liveFill = new Float32Array(LIVE_LAYERS);
  /** The Sun's direction when each disc, and the zoomed-in live picture, was taken. */
  private readonly liveSun = new Float32Array(LIVE_LAYERS * 3);
  private readonly himTex: WebGLTexture;
  private readonly sstTex: WebGLTexture;
  private hasSst = false;
  private ashTex: WebGLTexture;
  private ashSized = false;
  private readonly ashHas = new Float32Array(ASH_LAYERS);
  private readonly ashBox = new Float32Array(ASH_LAYERS * 4);
  private readonly ashSub = new Float32Array(ASH_LAYERS);
  /** 0: shown first; 1: fills in where 0 doesn't; 2: a whole-world mosaic under both. */
  private readonly ashTier = new Float32Array(ASH_LAYERS);
  private himBox: [number, number, number, number] | null = null;
  private himSub = 0;
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private readonly textures: Record<Slot, WebGLTexture>;
  private readonly loaded: Record<Slot, boolean> = { day: false, night: false };
  private cloudTex: WebGLTexture;
  private cloudSize: [number, number] | null = null;
  /** The array layer holding the current map; the other holds the previous. */
  private cloudCur = 0;
  private cloudLoaded = false;
  private readonly aniso: EXT_texture_filter_anisotropic | null;
  /** 0 → previous cloud map, 1 → current; animated by the caller after setClouds. */
  cloudMix = 1;
  /** renderView's offscreen frame, at the size last asked for, with a depth buffer for models. */
  private view: { fbo: WebGLFramebuffer; rb: WebGLRenderbuffer; depth: WebGLRenderbuffer; width: number; height: number; pixels: Uint8Array } | null = null;
  /** The model layer, made when a model is first set. */
  private modelLayer: ModelLayer | null = null;

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
    this.floodLayer = new SurfacePointLayer(gl, (vs, fs) => link(gl, vs, fs), FLOOD_STYLE);
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
    this.details = {
      main: { tex: empty(), box: null, kind: 0, sub: 0, sun: [0, 0, 0] },
      camera: { tex: empty(), box: null, kind: 0, sub: 0, sun: [0, 0, 0] },
    };
    this.nightDetails = { main: { tex: empty(), box: null }, camera: { tex: empty(), box: null } };
    this.reliefTex = empty();
    this.himTex = empty();
    this.sstTex = empty();
    this.ashTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ashTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
    };
    for (const slot of Object.keys(UNIT) as Slot[]) gl.uniform1i(this.u(SAMPLER[slot]), UNIT[slot]);
    this.cloudTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cloudTex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, 1, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(8));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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

  /**
   * Show a new cloud map; the previous one is kept for a cross-fade (cloudMix 0 → 1). It goes
   * into the layer not now current; a map of a new size starts the array afresh, with no fade.
   */
  setClouds(image: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas) {
    const gl = this.gl;
    const w = image.width;
    const h = image.height;
    gl.activeTexture(gl.TEXTURE0 + CLOUD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cloudTex);
    const fresh = !this.cloudSize || this.cloudSize[0] !== w || this.cloudSize[1] !== h;
    if (fresh) {
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, w, h, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.cloudSize = [w, h];
    }
    const layer = fresh || !this.cloudLoaded ? 0 : 1 - this.cloudCur;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // row 0 = north = v 0
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.cloudMix = this.cloudLoaded && !fresh ? 0 : 1;
    this.cloudCur = layer;
    this.cloudLoaded = true;
  }

  get hasClouds() {
    return this.cloudLoaded;
  }

  /** Aurora probability grid (row 0 = north pole, column 0 = −180°), one byte per cell. */
  setAurora(grid: AuroraGrid) {
    this.auroraBytes = grid.data;
    this.swSize = { width: grid.width, height: grid.height };
    this.hasAurora = true;
    this.uploadSpaceWeather();
  }

  /** TEC and D-RAP bytes on the aurora's grid (ionosphere.ts), or null to keep what's there. */
  setIonosphere(tec: Uint8Array | null, drap: Uint8Array | null) {
    if (tec) this.tecBytes = tec;
    if (drap) this.drapBytes = drap;
    this.uploadSpaceWeather();
  }

  /** Aurora, TEC and D-RAP share a grid, so they share a texture (and a texture unit). */
  private uploadSpaceWeather() {
    const { width, height } = this.swSize;
    const n = width * height;
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = this.auroraBytes?.[i] ?? 0;
      rgba[i * 4 + 1] = this.tecBytes?.[i] ?? 0;
      rgba[i * 4 + 2] = this.drapBytes?.[i] ?? 0;
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
   * One satellite's live disc (layer 0–3) for a lat/lon box, with the longitude below the
   * satellite (degrees). Drawn to the array's fixed size first, whatever size it came at.
   * `fill`: shown only where the other discs leave gaps.
   */
  setLive(layer: number, image: CanvasImageSource, box: LatLonBox, subLon: number, scanSun: Vec3, fill = false) {
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
    this.liveFill[layer] = fill ? 1 : 0;
    this.liveSun.set(scanSun, layer * 3);
  }

  /**
   * Himawari's cloud opacity (RGBA bytes: r = opacity × valid, g = valid) for a lat/lon box,
   * with the longitude below the satellite (degrees). Mipmapped, so a valid-weighted mean.
   */
  setHimawari(rgba: Uint8Array, w: number, h: number, box: LatLonBox, subLon: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + HIM_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.himTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.himBox = [box.lon0, box.lat1, box.lonSpan, box.latSpan];
    this.himSub = (subLon * Math.PI) / 180;
  }

  /**
   * One Ash RGB picture (layer 0–2) for a lat/lon box, with the longitude below its satellite
   * and its tier (see ashTier). Drawn to the array's fixed size first, as the live discs are.
   * Its no data is transparent (maskAshNoData); stored premultiplied, so the mipmaps average
   * only the picture and the shader divides the alpha back out.
   */
  setAsh(layer: number, image: CanvasImageSource, box: LatLonBox, subLon: number, tier: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + ASH_UNIT);
    if (!this.ashSized) {
      gl.deleteTexture(this.ashTex);
      this.ashTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ashTex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(LIVE_PX) + 1, gl.RGBA8, LIVE_PX, LIVE_PX, ASH_LAYERS);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.ashSized = true;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ashTex);
    const canvas = new OffscreenCanvas(LIVE_PX, LIVE_PX);
    canvas.getContext('2d')!.drawImage(image, 0, 0, LIVE_PX, LIVE_PX);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, LIVE_PX, LIVE_PX, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    this.ashHas[layer] = 1;
    this.ashBox.set([box.lon0, box.lat1, box.lonSpan, box.latSpan], layer * 4);
    this.ashSub[layer] = (subLon * Math.PI) / 180;
    this.ashTier[layer] = tier;
  }

  /**
   * Sea surface temperature (r) and anomaly (g) on the whole-world 0.25° grid, alpha 255 where
   * there's data and all zero where not: premultiplied, so mipmaps average only the sea.
   */
  setSst(rgba: Uint8Array, w: number, h: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + SST_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.sstTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.hasSst = true;
  }

  get hasLive() {
    return this.liveHas.some((v) => v > 0);
  }

  /**
   * The zoomed-in picture for a lat/lon box (west, north, lon span, lat span in degrees).
   * `live`: it's a live picture, taken from above this longitude with the Sun there; `'base'`:
   * a sharper base map in place of the Blue Marble (clouds and all still drawn over it); else
   * yesterday's VIIRS. `slot`: the main view's, or the ISS camera's.
   */
  setDetail(image: TexImageSource, box: LatLonBox, live?: { subLon: number; scanSun: Vec3 } | 'base', slot: DetailSlot = 'main') {
    const gl = this.gl;
    const d = this.details[slot];
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, d.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    d.box = [box.lon0, box.lat1, box.lonSpan, box.latSpan];
    d.kind = live === 'base' ? 2 : live ? 1 : 0;
    if (live && live !== 'base') {
      d.sub = (live.subLon * Math.PI) / 180;
      d.sun = live.scanSun;
    }
  }

  clearDetail(slot: DetailSlot = 'main') {
    this.details[slot].box = null;
  }

  /** Night-lights detail for a lat/lon box, as setDetail. */
  setNightDetail(image: TexImageSource, box: { lon0: number; lat1: number; lonSpan: number; latSpan: number }, slot: DetailSlot = 'main') {
    const gl = this.gl;
    const d = this.nightDetails[slot];
    gl.activeTexture(gl.TEXTURE15);
    gl.bindTexture(gl.TEXTURE_2D, d.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    d.box = [box.lon0, box.lat1, box.lonSpan, box.latSpan];
  }

  clearNightDetail(slot: DetailSlot = 'main') {
    this.nightDetails[slot].box = null;
  }

  setFires(points: SurfacePoints) {
    this.fireLayer.setPoints(points);
  }

  setFloods(points: SurfacePoints) {
    this.floodLayer.setPoints(points);
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
    this.draw(f, this.canvas.width, this.canvas.height);
  }

  /**
   * Draw a frame into an offscreen buffer of this size rather than the canvas, and read it
   * back (RGBA, rows bottom to top): a second view of everything uploaded — the ISS camera —
   * for one more pass over a small frame and no more texture units. The read waits on the GPU.
   */
  renderView(f: FrameState, width: number, height: number): Uint8Array {
    const gl = this.gl;
    let v = this.view;
    if (!v || v.width !== width || v.height !== height) {
      this.releaseView();
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
      const depth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      v = this.view = { fbo, rb, depth, width, height, pixels: new Uint8Array(width * height * 4) };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, v.fbo);
    this.draw(f, width, height);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, v.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return v.pixels;
  }

  /** Free renderView's buffer (the camera was closed). */
  releaseView() {
    if (!this.view) return;
    this.gl.deleteFramebuffer(this.view.fbo);
    this.gl.deleteRenderbuffer(this.view.rb);
    this.gl.deleteRenderbuffer(this.view.depth);
    this.view = null;
  }

  /** A model for renderView frames to draw (FrameState.model poses it): its parts' triangles. */
  setModel(parts: Map<string, { positions: Float32Array; normals: Float32Array; colors: Float32Array }>) {
    this.modelLayer ??= new ModelLayer(this.gl, (vs, fs) => link(this.gl, vs, fs));
    this.modelLayer.setParts(parts);
  }

  private draw(f: FrameState, width: number, height: number) {
    const gl = this.gl;
    const { camera: cam } = f;
    const res: [number, number] = [width, height];
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (f.stars) {
      this.stars.draw(
        { camera: cam, radiusPx: f.radiusPx, dpr: f.dpr, ...f.stars },
        res,
      );
    }

    this.bodies.draw(f.bodies, res);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    for (const slot of Object.keys(UNIT) as Slot[]) {
      gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[slot]);
    }
    gl.uniform2f(this.u('uRes'), width, height);
    gl.uniform1f(this.u('uRadiusPx'), f.radiusPx);
    gl.uniform1f(this.u('uLodScale'), f.lodScale ?? 1);
    gl.uniform3fv(this.u('uDir'), cam.dir);
    gl.uniform3fv(this.u('uRight'), cam.right);
    gl.uniform3fv(this.u('uUp'), cam.up);
    gl.uniform1f(this.u('uDist'), cam.dist);
    gl.uniform1f(this.u('uFocal'), cam.focal);
    gl.uniform3fv(this.u('uSun'), f.sun);
    gl.uniform1f(this.u('uHasDay'), this.loaded.day ? 1 : 0);
    gl.uniform1f(this.u('uHasNight'), this.loaded.night ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + CLOUD_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.cloudTex);
    gl.uniform1i(this.u('uClouds'), CLOUD_UNIT);
    gl.uniform1f(this.u('uCloudCur'), this.cloudCur);
    gl.uniform1f(this.u('uCloudMix'), this.cloudMix);
    gl.uniform1f(this.u('uCloudOn'), f.clouds && this.cloudLoaded ? 1 : 0);
    gl.uniform1f(this.u('uLights'), f.lights ? 1 : 0);
    gl.uniform1f(this.u('uGrid'), f.grid ? 1 : 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.auroraTex);
    gl.uniform1i(this.u('uAurora'), 5);
    gl.uniform1f(this.u('uAuroraOn'), f.aurora && this.hasAurora ? 1 : 0);
    const iono = f.iono === 'tec' && this.tecBytes ? 1 : f.iono === 'drap' && this.drapBytes ? 2 : 0;
    gl.uniform1f(this.u('uIonoMode'), iono);
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
    const det = this.details[f.detailSlot ?? 'main'];
    gl.bindTexture(gl.TEXTURE_2D, det.tex);
    gl.uniform1i(this.u('uDetail'), 10);
    gl.uniform1f(this.u('uDetailOn'), f.detail && det.box ? 1 : 0);
    if (det.box) gl.uniform4fv(this.u('uDetailBox'), det.box);
    gl.uniform1f(this.u('uDetailLive'), det.kind);
    gl.uniform1f(this.u('uDetailSub'), det.sub);
    gl.uniform3fv(this.u('uDetailSun'), det.sun);
    gl.activeTexture(gl.TEXTURE0 + LIVE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.liveTex);
    gl.uniform1i(this.u('uLive'), LIVE_UNIT);
    gl.uniform1f(this.u('uLiveOn'), f.live && this.hasLive ? 1 : 0);
    gl.uniform1fv(this.u('uLiveHas'), this.liveHas);
    gl.uniform4fv(this.u('uLiveBox'), this.liveBox);
    gl.uniform1fv(this.u('uLiveSub'), this.liveSub);
    gl.uniform1fv(this.u('uLiveFill'), this.liveFill);
    gl.uniform3fv(this.u('uLiveSun'), this.liveSun);
    gl.activeTexture(gl.TEXTURE0 + HIM_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.himTex);
    gl.uniform1i(this.u('uHim'), HIM_UNIT);
    gl.uniform1f(this.u('uHimOn'), f.himawari && this.himBox ? 1 : 0);
    if (this.himBox) gl.uniform4fv(this.u('uHimBox'), this.himBox);
    gl.uniform1f(this.u('uHimSub'), this.himSub);
    gl.activeTexture(gl.TEXTURE0 + ASH_UNIT);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.ashTex);
    gl.uniform1i(this.u('uAsh'), ASH_UNIT);
    gl.uniform1f(this.u('uAshOn'), f.ash && this.ashHas.some((v) => v > 0) ? 1 : 0);
    gl.uniform1fv(this.u('uAshHas'), this.ashHas);
    gl.uniform4fv(this.u('uAshBox'), this.ashBox);
    gl.uniform1fv(this.u('uAshSub'), this.ashSub);
    gl.uniform1fv(this.u('uAshTier'), this.ashTier);
    gl.activeTexture(gl.TEXTURE0 + SST_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.sstTex);
    gl.uniform1i(this.u('uSst'), SST_UNIT);
    gl.uniform1f(this.u('uSstMode'), this.hasSst ? f.sst : 0);
    gl.activeTexture(gl.TEXTURE15);
    const night = this.nightDetails[f.detailSlot ?? 'main'];
    gl.bindTexture(gl.TEXTURE_2D, night.tex);
    gl.uniform1i(this.u('uNightDetail'), 15);
    gl.uniform1f(this.u('uNightDetailOn'), f.nightDetail && night.box ? 1 : 0);
    if (night.box) gl.uniform4fv(this.u('uNightDetailBox'), night.box);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.reliefTex);
    gl.uniform1i(this.u('uRelief'), 11);
    gl.uniform1f(this.u('uReliefK'), this.hasRelief ? f.relief : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    if (f.floods) this.floodLayer.draw({ camera: cam, radiusPx: f.radiusPx, sun: f.sun, window: 1, minIntensity: 0 }, res);
    if (f.fires) {
      this.fireLayer.draw({ camera: cam, radiusPx: f.radiusPx, sun: f.sun, window: f.fires.windowH, minIntensity: f.fires.minIntensity }, res);
    }
    if (f.lightning) {
      this.lightningLayer.draw({ camera: cam, radiusPx: f.radiusPx, sun: f.sun, window: f.lightning.windowMin, minIntensity: 0 }, res);
    }

    if (f.satellites) {
      this.sats.draw(
        { camera: cam, radiusPx: f.radiusPx, sun: f.sun, dpr: f.dpr, dt: f.satellites.dt, categories: f.satellites.categories },
        res,
      );
    }
    if (f.model) this.modelLayer?.draw(f.model, cam.focal * f.radiusPx, res);
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
