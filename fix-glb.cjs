// Remove do GLB as meshes cujas primitivas Draco falham ao decodificar,
// mantendo o resto do arquivo (geometria, hierarquia de nodes, materiais) intacto.
// Usa o relatório gerado por diagnose-draco.cjs.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node fix-glb.cjs <arquivo.glb>');
  process.exit(1);
}

const reportPath = file + '.draco-report.json';
if (!fs.existsSync(reportPath)) {
  console.error('Relatório não encontrado, rode diagnose-draco.cjs primeiro:', reportPath);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const brokenMeshIdx = new Set(report.failures.map((f) => f.meshIdx));

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

function writeGlb(outPath, json, bin) {
  let jsonStr = JSON.stringify(json);
  // padding do chunk JSON com espaços até múltiplo de 4
  while ((jsonStr.length % 4) !== 0) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');

  // padding do chunk BIN com zeros até múltiplo de 4
  let binPadded = bin;
  const pad = (4 - (bin.length % 4)) % 4;
  if (pad > 0) {
    binPadded = Buffer.concat([bin, Buffer.alloc(pad)]);
  }

  const totalLength = 12 + (8 + jsonBuf.length) + (8 + binPadded.length);
  const out = Buffer.alloc(totalLength);

  out.write('glTF', 0, 'ascii');
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLength, 8);

  let offset = 12;
  out.writeUInt32LE(jsonBuf.length, offset); offset += 4;
  out.write('JSON', offset, 'ascii'); offset += 4;
  jsonBuf.copy(out, offset); offset += jsonBuf.length;

  out.writeUInt32LE(binPadded.length, offset); offset += 4;
  out.write('BIN\0', offset, 'ascii'); offset += 4;
  binPadded.copy(out, offset);

  fs.writeFileSync(outPath, out);
}

const { json, bin } = readGlb(file);

const oldMeshes = json.meshes || [];
const remap = new Map(); // oldIdx -> newIdx (undefined se removido)
const newMeshes = [];
oldMeshes.forEach((mesh, idx) => {
  if (brokenMeshIdx.has(idx)) return; // descarta
  remap.set(idx, newMeshes.length);
  newMeshes.push(mesh);
});
json.meshes = newMeshes;

let nodesAffected = 0;
(json.nodes || []).forEach((node) => {
  if (node.mesh === undefined) return;
  if (brokenMeshIdx.has(node.mesh)) {
    delete node.mesh;
    nodesAffected++;
  } else {
    node.mesh = remap.get(node.mesh);
  }
});

const outPath = file.replace(/\.glb$/i, '_fixed.glb');
writeGlb(outPath, json, bin);

console.log(`Meshes removidas: ${brokenMeshIdx.size}`);
console.log(`Nodes que perderam geometria vazia: ${nodesAffected}`);
console.log(`Arquivo corrigido salvo em: ${path.basename(outPath)}`);
console.log(`Tamanho original: ${fs.statSync(file).size} bytes | corrigido: ${fs.statSync(outPath).size} bytes`);
