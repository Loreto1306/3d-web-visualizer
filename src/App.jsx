import React, { Suspense, useState, useEffect, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Bounds, useBounds, ContactShadows, Environment, useProgress } from '@react-three/drei'
import { DRACOLoader } from 'three-stdlib'
import * as THREE from 'three'

// PATCH: o GLTFLoader do three-stdlib chama decodeDracoFile(buffer, onLoad, attrs, types, colorSpace, onError),
// mas o DRACOLoader.decodeDracoFile (método legado) só lê os 4 primeiros argumentos e descarta o onError.
// Quando a decodificação Draco falha, o reject nunca é chamado e a Promise fica pendurada para sempre
// (tela trava em X% sem nenhum erro). Aqui forçamos a propagação do erro real.
DRACOLoader.prototype.decodeDracoFile = function (buffer, callback, attributeIDs, attributeTypes, _colorSpace, onError) {
  const taskConfig = {
    attributeIDs: attributeIDs || this.defaultAttributeIDs,
    attributeTypes: attributeTypes || this.defaultAttributeTypes,
    useUniqueIDs: !!attributeIDs,
  }
  this.decodeGeometry(buffer, taskConfig).then(callback).catch((err) => {
    console.error('Falha ao decodificar primitiva Draco:', err)
    onError?.(err)
  })
}

const MODELS = [
  { label: '06/04 (~9k nodes)', url: '/0571-UNILEVER_06042026_125553.glb' },
  { label: '16/04 (~227k nodes)', url: '/0571-UNILEVER_16042026_190610.glb' },
  { label: '16/04 CORRIGIDO (sem 3 meshes vazias)', url: '/0571-UNILEVER_16042026_190610_fixed.glb' },
  { label: '16/04 V3 (~301k nodes)', url: '/0571-UNILEVER_16042026_190610_V3.glb' },
  { label: '16/04 V3 CORRIGIDO (sem 5 meshes vazias)', url: '/0571-UNILEVER_16042026_190610_V3_fixed.glb' },
]

// Helper: verifica se um objeto está dentro da seleção (ele mesmo ou descendente)
function isWithinSelection(obj, selectedNode) {
  let p = obj
  while (p) {
    if (p === selectedNode) return true
    p = p.parent
  }
  return false
}

// 1. COMPONENTE DA ÁRVORE
function TreeView({ node, onSelect, selectedUuid, ancestorUuids }) {
  const [manualOpen, setManualOpen] = useState(false)
  const isSelected = node.uuid === selectedUuid
  const forceOpen = ancestorUuids.has(node.uuid)
  const open = manualOpen || forceOpen
  const hasChildren = node.children && node.children.length > 0
  const rowRef = useRef(null)

  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isSelected])

  return (
    <div style={{ fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#ddd', userSelect: 'none' }}>
      <div
        ref={rowRef}
        onClick={(e) => {
          e.stopPropagation();
          setManualOpen((o) => !o);
          onSelect(node);
        }}
        style={{
          cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '5px',
          backgroundColor: isSelected ? '#0066ff33' : (open ? '#333' : 'transparent'),
          outline: isSelected ? '1px solid #0066ff' : 'none',
          borderRadius: '4px'
        }}
      >
        <span style={{ width: '15px', textAlign: 'center' }}>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span>{hasChildren ? (open ? '📂' : '📁') : '📄'}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{node.name || 'Objeto sem nome'}</span>
      </div>

      {open && hasChildren && (
        <div style={{ marginLeft: '18px', paddingLeft: '10px', borderLeft: '1px solid #444' }}>
          {node.children.map((child, i) => (
            <TreeView key={child.uuid || i} node={child} onSelect={onSelect} selectedUuid={selectedUuid} ancestorUuids={ancestorUuids} />
          ))}
        </div>
      )}
    </div>
  )
}

// 2. PAINEL DE INFORMAÇÕES DO ELEMENTO SELECIONADO
function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1a', gap: '8px' }}>
      <span style={{ color: '#888', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#eee', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function fmtVec(v, asDegrees = false) {
  const f = (n) => (asDegrees ? THREE.MathUtils.radToDeg(n).toFixed(1) + '°' : n.toFixed(2))
  return `${f(v.x)}, ${f(v.y)}, ${f(v.z)}`
}

function InfoPanel({ node }) {
  if (!node) {
    return (
      <div style={{ padding: '15px', color: '#666', fontSize: '12px', borderTop: '1px solid #222' }}>
        Selecione um item na árvore ou clique em uma peça no modelo 3D.
      </div>
    )
  }

  const isMesh = !!node.isMesh
  const geo = isMesh ? node.geometry : null
  const vertexCount = geo?.attributes?.position?.count ?? null
  const triangleCount = geo ? (geo.index ? geo.index.count / 3 : (vertexCount ? vertexCount / 3 : null)) : null
  const materials = isMesh ? (Array.isArray(node.material) ? node.material : [node.material]) : []

  return (
    <div style={{ padding: '12px 15px', color: '#ddd', fontSize: '12px', borderTop: '1px solid #222', maxHeight: '260px', overflowY: 'auto' }}>
      <h4 style={{ margin: '0 0 8px', color: '#fff', fontSize: '13px' }}>Propriedades</h4>
      <InfoRow label="Nome" value={node.name || '(sem nome)'} />
      <InfoRow label="Tipo" value={node.type} />
      <InfoRow label="UUID" value={node.uuid.slice(0, 8) + '…'} />
      <InfoRow label="Filhos" value={String(node.children?.length || 0)} />
      <InfoRow label="Posição" value={fmtVec(node.position)} />
      <InfoRow label="Rotação" value={fmtVec(node.rotation, true)} />
      <InfoRow label="Escala" value={fmtVec(node.scale)} />
      {isMesh && (
        <>
          <InfoRow label="Vértices" value={vertexCount != null ? vertexCount.toLocaleString() : '—'} />
          <InfoRow label="Triângulos" value={triangleCount != null ? Math.round(triangleCount).toLocaleString() : '—'} />
          {materials.map((m, i) => m && (
            <InfoRow key={m.uuid || i} label={`Material ${i + 1}`} value={m.name || m.type} />
          ))}
        </>
      )}
    </div>
  )
}

// 3. CAIXA DELIMITADORA (Bounding Box)
function SelectionBox({ selectedNode }) {
  const boxRef = useRef()

  useFrame(() => {
    if (selectedNode && selectedNode.isObject3D) {
      boxRef.current.setFromObject(selectedNode)
      boxRef.current.visible = true
    } else {
      boxRef.current.visible = false
    }
  })

  return <boxHelper ref={boxRef} args={[new THREE.Object3D(), 0x00ff00]} />
}

// 4. HANDLER DE SELEÇÃO (Foco Real)
function SelectionHandler({ selectedNode }) {
  const bounds = useBounds()

  useEffect(() => {
    if (selectedNode) {
      bounds.refresh(selectedNode).clip().fit()
    }
  }, [selectedNode, bounds])

  return null
}

// 5. O MODELO: carrega a cena, aplica highlight e expõe clique nos elementos
function Scene({ url, selectedNode, onModelClick, onSceneReady }) {
  const { scene } = useGLTF(url)

  useEffect(() => {
    onSceneReady?.(scene)
  }, [scene, onSceneReady])

  useEffect(() => {
    scene.traverse((obj) => {
      if (!obj.isMesh) return
      const highlight = !!selectedNode && isWithinSelection(obj, selectedNode)
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      materials.forEach((m) => {
        if (!m) return
        if (highlight) {
          m.emissive?.set('#0066ff')
          m.emissiveIntensity = 0.5
        } else {
          m.emissive?.set('#000000')
          m.emissiveIntensity = 0
        }
      })
    })
  }, [selectedNode, scene])

  return (
    <primitive
      object={scene}
      onClick={(e) => {
        e.stopPropagation()
        onModelClick?.(e.object)
      }}
    />
  )
}

// 6. BOUNDARY: evita tela em branco quando o GLB falha ao decodificar/parsear
class ModelErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, info) {
    console.error('Erro ao carregar GLB:', error, info)
    this.props.onError?.(error)
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

// 7. OVERLAY DE PROGRESSO DE CARREGAMENTO
function LoadingOverlay() {
  const { active, progress, item } = useProgress()
  if (!active) return null
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(5,5,5,0.85)',
      color: '#fff', gap: '10px', zIndex: 10
    }}>
      <div style={{ fontSize: '14px' }}>Carregando modelo... {progress.toFixed(0)}%</div>
      <div style={{ width: '240px', height: '6px', background: '#222', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', background: '#00ff88', transition: 'width 0.2s' }} />
      </div>
      <div style={{ fontSize: '10px', color: '#777', maxWidth: '320px', textAlign: 'center', wordBreak: 'break-all' }}>{item}</div>
    </div>
  )
}

// 8. APP PRINCIPAL
export default function App() {
  const [modelUrl, setModelUrl] = useState(MODELS[1].url)
  const [selected, setSelected] = useState(null)
  const [loadedScene, setLoadedScene] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const ancestorUuids = useMemo(() => {
    const set = new Set()
    let p = selected?.parent
    while (p) {
      set.add(p.uuid)
      p = p.parent
    }
    return set
  }, [selected])

  const handleModelChange = (url) => {
    setModelUrl(url)
    setSelected(null)
    setLoadedScene(null)
    setLoadError(null)
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#050505', overflow: 'hidden' }}>

      <div style={{ width: '350px', height: '100%', overflowY: 'auto', borderRight: '1px solid #222', background: '#111', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ color: '#fff', padding: '15px 15px 8px', fontSize: '16px', margin: 0 }}>Selection Tree</h3>

        <div style={{ padding: '0 15px 12px' }}>
          <select
            value={modelUrl}
            onChange={(e) => handleModelChange(e.target.value)}
            style={{ width: '100%', background: '#1a1a1a', color: '#ddd', border: '1px solid #333', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
          >
            {MODELS.map((m) => (
              <option key={m.url} value={m.url}>{m.label}</option>
            ))}
          </select>
        </div>

        <div style={{ borderTop: '1px solid #222', flexGrow: 1, overflowY: 'auto', padding: '10px' }}>
          {loadError ? (
            <div style={{ color: '#ff6b6b', fontSize: '12px' }}>Falha ao carregar este modelo. Veja o aviso na área 3D.</div>
          ) : loadedScene ? (
            <TreeView node={loadedScene} onSelect={setSelected} selectedUuid={selected?.uuid} ancestorUuids={ancestorUuids} />
          ) : (
            <div style={{ color: '#666', fontSize: '12px' }}>Carregando árvore...</div>
          )}
        </div>

        <InfoPanel node={selected} />
      </div>

      <div style={{ flexGrow: 1, position: 'relative' }}>
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [20, 20, 20], fov: 45 }}
          onPointerMissed={() => setSelected(null)}
        >
          <ModelErrorBoundary key={modelUrl} onError={(e) => setLoadError(e?.message || String(e))}>
            <Suspense fallback={null}>
              <ambientLight intensity={0.5} />
              <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} />
              <pointLight position={[-10, -10, -10]} />
              <Environment preset="city" />

              <Bounds fit clip observe margin={1.2}>
                <SelectionHandler selectedNode={selected} />
                <Scene url={modelUrl} selectedNode={selected} onModelClick={setSelected} onSceneReady={setLoadedScene} />
                <SelectionBox selectedNode={selected} />
              </Bounds>

              <ContactShadows position={[0, -1, 0]} opacity={0.25} scale={10} blur={1.5} far={0.8} />
            </Suspense>
          </ModelErrorBoundary>

          <OrbitControls makeDefault rotateSpeed={0.4} zoomSpeed={0.6} panSpeed={0.5} />
        </Canvas>

        <LoadingOverlay />

        {loadError && (
          <div style={{ position: 'absolute', top: '15px', left: '15px', right: '15px', background: '#4a0000', color: '#fff', padding: '10px 15px', borderRadius: '5px', fontSize: '12px', border: '1px solid #aa0000', zIndex: 20 }}>
            Falha ao carregar o modelo: {loadError}
          </div>
        )}

        {selected && (
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '5px', fontSize: '12px', border: '1px solid #333' }}>
            Focado: <strong style={{ color: '#00ff00' }}>{selected.name}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
