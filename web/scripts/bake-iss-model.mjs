// The ISS camera's model (web/public/models/iss.glb), from NASA 3D Resources' "International
// Space Station (ISS) (A)" (NASA Ames). NASA ships it Draco-compressed; this writes it plain, so
// the browser needs no decoder: one mesh, six materials, ~6,600 triangles. The texture
// coordinates go (it has no textures) and so does KHR_materials_specular (unused).
//
// The tools aren't the app's dependencies. Install them in a folder of their own:
//   npm i @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1 draco3dgltf@1.5.7
// then:
//   node web/scripts/bake-iss-model.mjs <that folder> "International Space Station (ISS) (A).glb" web/public/models/iss.glb

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
const draco3d = require('draco3dgltf');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(inPath);
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (ext.extensionName === 'KHR_draco_mesh_compression' || ext.extensionName === 'KHR_materials_specular') ext.dispose();
}
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0');
    prim.setAttribute('TEXCOORD_0', null);
    if (uv && uv.listParents().length <= 1) uv.dispose();
  }
}
await io.write(outPath, doc);
const triangles = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
console.log(`wrote ${outPath}: ${triangles} triangles`);
