// The ISS camera's model (web/public/models/iss.glb), from NASA 3D Resources' "International
// Space Station (ISS) (B)" (NASA / Michael D. Carbajal). NASA ships it Draco-compressed; this
// writes it so the browser needs no decoder:
//
//   * decoded, without KHR_materials_specular (unused) or texture coordinates (no textures);
//   * without seven small parts (bendedtru1–3, bendedtrus, pCylinder1/2/8) that float ~30 units
//     clear of the station, leftovers that would hang in front of the camera;
//   * quantized (KHR_mesh_quantization): positions to 14 bits, normals to 8, ~174,000 triangles
//     in ~2 MB rather than 3.5.
//
// The tools aren't the app's dependencies. Install them in a folder of their own:
//   npm i @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 @gltf-transform/functions@4.1.1 draco3dgltf@1.5.7
// then:
//   node web/scripts/bake-iss-model.mjs <that folder> "International Space Station (ISS) (B).glb" web/public/models/iss.glb

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const [, , toolsDir, inPath, outPath] = process.argv;
if (!outPath) {
  console.error('usage: node bake-iss-model.mjs <tools folder> <in.glb> <out.glb>');
  process.exit(1);
}
const require = createRequire(resolve(toolsDir) + '/');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune, quantize } = require('@gltf-transform/functions');
const draco3d = require('draco3dgltf');

const STRAYS = new Set(['bendedtru1', 'bendedtru2', 'bendedtru3', 'bendedtrus', 'pCylinder1', 'pCylinder2', 'pCylinder8']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(inPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName === 'KHR_draco_mesh_compression' || ext.extensionName === 'KHR_materials_specular') ext.dispose();
}
for (const node of doc.getRoot().listNodes()) {
  if (STRAYS.has(node.getName())) node.dispose();
}
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) prim.setAttribute('TEXCOORD_0', null);
}
await doc.transform(prune(), quantize({ quantizePosition: 14, quantizeNormal: 8 }));
await io.write(outPath, doc);
const triangles = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
console.log(`wrote ${outPath}: ${triangles} triangles`);
