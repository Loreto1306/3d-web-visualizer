import React, { Suspense, useState, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Bounds, useBounds, ContactShadows, Environment } from '@react-three/drei'
import * as THREE from 'three'

// 1. COMPONENTE DA ÁRVORE (Mantido igual, apenas garantindo o stopPropagation)
function TreeView({ node, onSelect }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children && node.children.length > 0

  return (
    <div style={{ fontFamily: 'Segoe UI, sans-serif', fontSize: '12px', color: '#ddd', userSelect: 'none' }}>
      <div 
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
          onSelect(node);
        }}
        style={{ 
          cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '5px',
          backgroundColor: open ? '#333' : 'transparent', borderRadius: '4px'
        }}
      >
        <span style={{ width: '15px', textAlign: 'center' }}>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span>{hasChildren ? (open ? '📂' : '📁') : '📄'}</span>
        <span style={{ whiteSpace: 'nowrap' }}>{node.name || 'Objeto sem nome'}</span>
      </div>
      
      {open && hasChildren && (
        <div style={{ marginLeft: '18px', paddingLeft: '10px', borderLeft: '1px solid #444' }}>
          {node.children.map((child, i) => (
            <TreeView key={child.uuid || i} node={child} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// 2. COMPONENTE PARA A CAIXA DELIMITADORA (Bounding Box)
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

// 3. HANDLER DE SELEÇÃO (Foco Real)
function SelectionHandler({ selectedNode }) {
  const bounds = useBounds()

  useEffect(() => {
    if (selectedNode) {
      // O segredo do foco: refresh calcula os limites do objeto selecionado e seus filhos
      // fit() move a câmera para enquadrar perfeitamente
      bounds.refresh(selectedNode).clip().fit()
    }
  }, [selectedNode, bounds])

  return null
}

// 4. O MODELO (Highlight azul mantido)
function Model({ url, selectedNode }) {
  const { scene } = useGLTF(url)

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj.isMesh) {
        if (selectedNode && (obj.uuid === selectedNode.uuid || obj.parent?.uuid === selectedNode.uuid)) {
          obj.material.emissive?.set('#0066ff')
          obj.material.emissiveIntensity = 0.5
        } else {
          obj.material.emissive?.set('#000000')
          obj.material.emissiveIntensity = 0
        }
      }
    })
  }, [selectedNode, scene])

  return <primitive object={scene} />
}

// 5. APP PRINCIPAL
export default function App() {
  const [selected, setSelected] = useState(null)
  const { scene } = useGLTF('/0571-UNILEVER_06042026_125553.glb')

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#050505', overflow: 'hidden' }}>
      
      <div style={{ width: '350px', height: '100%', overflowY: 'auto', borderRight: '1px solid #222', background: '#111', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ color: '#fff', padding: '15px', fontSize: '16px', borderBottom: '1px solid #222', margin: 0 }}>Selection Tree</h3>
        <div style={{ padding: '10px' }}>
          <TreeView node={scene} onSelect={(node) => setSelected(node)} />
        </div>
      </div>

      <div style={{ flexGrow: 1, position: 'relative' }}>
        <Canvas dpr={[1, 2]} camera={{ position: [20, 20, 20], fov: 45 }}>
          <Suspense fallback={null}>
            {/* Iluminação manual para evitar conflito com Stage */}
            <ambientLight intensity={0.5} />
            <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} />
            <pointLight position={[-10, -10, -10]} />
            <Environment preset="city" />

            {/* Bounds controla o enquadramento */}
            <Bounds fit clip observe margin={1.2}>
              <SelectionHandler selectedNode={selected} />
              <Model url="/0571-UNILEVER_06042026_125553.glb" selectedNode={selected} />
              {/* Desenha a caixa verde ao redor do selecionado */}
              <SelectionBox selectedNode={selected} />
            </Bounds>

            <ContactShadows position={[0, -1, 0]} opacity={0.25} scale={10} blur={1.5} far={0.8} />
          </Suspense>
          
          <OrbitControls makeDefault />
        </Canvas>
        
        {selected && (
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '5px', fontSize: '12px', border: '1px solid #333' }}>
            Focado: <strong style={{color: '#00ff00'}}>{selected.name}</strong>
          </div>
        )}
      </div>
    </div>
  )
}