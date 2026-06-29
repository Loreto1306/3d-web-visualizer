// Script de diagnóstico: tenta decodificar cada primitiva Draco individualmente
// para mapear exatamente quais meshes/nodes estão corrompidos num GLB.
const fs = require('fs');
const path = require('path');
const draco3d = require('draco3d');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node diagnose-draco.cjs <arquivo.glb>');
  process.exit(1);
}

function readGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const chunk0Length = buf.readUInt32LE(12);
  const jsonStart = 20;
  const json = JSON.parse(buf.toString('utf8', jsonStart, jsonStart + chunk0Length));
  const chunk1Offset = jsonStart + chunk0Length;
  const chunk1Length = buf.readUInt32LE(chunk1Offset);
  const binStart = chunk1Offset + 8;
  const bin = buf.subarray(binStart, binStart + chunk1Length);
  return { json, bin };
}

async function main() {
  const { json, bin } = readGlb(file);
  const decoderModule = await draco3d.createDecoderModule({});

  const meshes = json.meshes || [];
  const bufferViews = json.bufferViews || [];
  const nodes = json.nodes || [];

  // Mapeia meshIndex -> lista de nodes que usam essa mesh
  const meshToNodes = {};
  nodes.forEach((n, nodeIdx) => {
    if (n.mesh !== undefined) {
      (meshToNodes[n.mesh] = meshToNodes[n.mesh] || []).push({ idx: nodeIdx, name: n.name });
    }
  });

  let total = 0;
  let failed = 0;
  const failures = [];

  meshes.forEach((mesh, meshIdx) => {
    (mesh.primitives || []).forEach((prim, primIdx) => {
      const dracoExt = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!dracoExt) return;
      total++;

      const bv = bufferViews[dracoExt.bufferView];
      const start = bv.byteOffset || 0;
      const length = bv.byteLength;
      const chunk = bin.subarray(start, start + length);

      const dracoBuffer = new decoderModule.DecoderBuffer();
      dracoBuffer.Init(chunk, chunk.length);
      const decoder = new decoderModule.Decoder();
      const geometryType = decoder.GetEncodedGeometryType(dracoBuffer);

      let outGeometry, status;
      try {
        if (geometryType === decoderModule.TRIANGULAR_MESH) {
          outGeometry = new decoderModule.Mesh();
          status = decoder.DecodeBufferToMesh(dracoBuffer, outGeometry);
        } else {
          outGeometry = new decoderModule.PointCloud();
          status = decoder.DecodeBufferToPointCloud(dracoBuffer, outGeometry);
        }
        if (!status.ok()) {
          failed++;
          failures.push({
            meshIdx, primIdx, bufferView: dracoExt.bufferView,
            byteOffset: start, byteLength: length,
            error: status.error_msg(),
            nodes: meshToNodes[meshIdx] || [],
            meshName: mesh.name,
          });
        }
      } catch (e) {
        failed++;
        failures.push({
          meshIdx, primIdx, bufferView: dracoExt.bufferView,
          byteOffset: start, byteLength: length,
          error: String(e),
          nodes: meshToNodes[meshIdx] || [],
          meshName: mesh.name,
        });
      } finally {
        decoderModule.destroy(decoder);
        decoderModule.destroy(dracoBuffer);
        if (outGeometry) decoderModule.destroy(outGeometry);
      }
    });
  });

  console.log(`\n=== ${path.basename(file)} ===`);
  console.log(`Primitivas com Draco: ${total}`);
  console.log(`Falharam: ${failed} (${((failed / total) * 100).toFixed(1)}%)`);
  console.log(`OK: ${total - failed}`);

  if (failures.length) {
    console.log('\nDetalhe das falhas:');
    failures.forEach((f) => {
      const nodeNames = f.nodes.map((n) => n.name || `#${n.idx}`).join(', ') || '(nenhum node referencia esta mesh)';
      console.log(` - mesh #${f.meshIdx} (${f.meshName || 'sem nome'}) prim #${f.primIdx} | bufferView #${f.bufferView} offset=${f.byteOffset} len=${f.byteLength} | erro: ${f.error} | nodes: ${nodeNames}`);
    });
  }

  fs.writeFileSync(
    file + '.draco-report.json',
    JSON.stringify({ total, failed, failures }, null, 2)
  );
  console.log(`\nRelatório salvo em: ${path.basename(file)}.draco-report.json`);
}

main().catch((e) => {
  console.error('Erro fatal no diagnóstico:', e);
  process.exit(1);
});
