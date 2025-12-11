import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONFIG } from '../constants';
import { SystemState, Emotion } from '../types';

interface VisualizerCanvasProps {
  systemStateRef: React.MutableRefObject<SystemState>;
  isPaused: boolean;
}

// --- Shader Code ---

const GRASS_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorldPosition;
  
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uPlayerPosition;
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  
  // Simple noise function
  float noise(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }
  
  // Perlin-ish noise for wind waves
  float smoothNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = noise(i);
      float b = noise(i + vec2(1.0, 0.0));
      float c = noise(i + vec2(0.0, 1.0));
      float d = noise(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vUv = uv;
    
    // Instance Matrix transforms
    vec3 pos = position;
    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
    
    // UV height factor (0 at bottom, 1 at top)
    // We assume the blade geometry is set up so Y increases from 0 to height
    float heightPercent = pos.y / 2.5; // Approx height of blade
    
    // --- 1. Global Wind ---
    // Create large rolling waves
    float windWave = smoothNoise(worldPos.xz * 0.05 + uTime * 0.5);
    // Create faster, smaller jitters
    float windJitter = smoothNoise(worldPos.xz * 0.2 + uTime * 2.0);
    
    float totalWind = (windWave * 0.7 + windJitter * 0.3) * uWindStrength * heightPercent; // Only move top
    
    worldPos.x += totalWind * 2.0;
    worldPos.z += totalWind * 1.0;
    
    // --- 2. Interactive "Breeze" (Player/Ball Collision) ---
    float dist = distance(worldPos.xz, uPlayerPosition.xz);
    float interactRadius = 25.0;
    if (dist < interactRadius) {
        float pushFactor = (1.0 - dist / interactRadius);
        pushFactor = pow(pushFactor, 2.0) * 8.0 * heightPercent; // Bend more at top
        
        vec3 pushDir = normalize(worldPos.xyz - uPlayerPosition);
        worldPos.x += pushDir.x * pushFactor;
        worldPos.z += pushDir.z * pushFactor;
        worldPos.y -= pushFactor * 0.3; // Squash down slightly
    }

    vWorldPosition = worldPos.xyz;
    
    // --- 3. Coloring ---
    // Mix base and tip color based on height and wind
    // Add some random variation per blade based on position
    float variation = smoothNoise(worldPos.xz * 0.1);
    vec3 mixedBase = mix(uBaseColor, uBaseColor * 0.8, variation);
    vec3 mixedTip = mix(uTipColor, uTipColor * 1.2, variation);
    
    vColor = mix(mixedBase, mixedTip, heightPercent);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const GRASS_FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorldPosition;
  
  uniform vec3 uSunPosition;

  void main() {
    // Simple Lambert-ish lighting
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    vec3 lightDir = normalize(uSunPosition - vWorldPosition);
    
    float diff = max(dot(normal, lightDir), 0.0);
    // Add ambient
    vec3 light = vColor * (diff * 0.6 + 0.4);
    
    // Soft shadow/AO at bottom
    // float ao = smoothstep(0.0, 0.4, vUv.y);
    // light *= (0.5 + 0.5 * ao);

    gl_FragColor = vec4(light, 1.0);
    
    // Simple distance fog
    float dist = length(vWorldPosition.xz); // Distance from center
    float fogFactor = smoothstep(150.0, 300.0, dist);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.1, 0.1, 0.1), fogFactor);
  }
`;

const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({ systemStateRef, isPaused }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const playerRef = useRef<THREE.Mesh | null>(null);
  
  const frameIdRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Init Scene ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    scene.fog = new THREE.Fog(0x111111, 100, 300);
    sceneRef.current = scene;

    // --- Init Camera ---
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.set(0, 40, 120); // Looking down at an angle
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // --- Init Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffaa33, 1.5);
    sunLight.position.set(100, 100, -100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    // --- Ground Plane ---
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a1a0a, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- The Grass (InstancedMesh) ---
    const bladeWidth = 0.5;
    const bladeHeight = 3.5;
    const bladeJoints = 3;
    
    // Create a simple blade geometry (triangle-ish plane)
    const grassGeo = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, bladeJoints);
    grassGeo.translate(0, bladeHeight / 2, 0); // Pivot at bottom

    const grassMat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 1.0 },
        uPlayerPosition: { value: new THREE.Vector3(0, 0, 0) },
        uBaseColor: { value: new THREE.Color(0x004400) },
        uTipColor: { value: new THREE.Color(0x88cc44) },
        uSunPosition: { value: sunLight.position },
      },
      side: THREE.DoubleSide,
    });
    materialRef.current = grassMat;

    const instanceCount = CONFIG.particleCount; // Reusing constant
    const instancedGrass = new THREE.InstancedMesh(grassGeo, grassMat, instanceCount);
    instancedGrass.castShadow = true;
    instancedGrass.receiveShadow = true;

    // Distribute grass
    const dummy = new THREE.Object3D();
    for (let i = 0; i < instanceCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 200; // 200 unit radius
      
      dummy.position.set(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius
      );
      
      // Random rotation around Y
      dummy.rotation.y = Math.random() * Math.PI;
      
      // Random scale variation
      const scale = 0.8 + Math.random() * 0.6;
      dummy.scale.set(scale, scale, scale);
      
      dummy.updateMatrix();
      instancedGrass.setMatrixAt(i, dummy.matrix);
    }
    instancedGrass.instanceMatrix.needsUpdate = true;
    scene.add(instancedGrass);

    // --- The Player (Orb) ---
    const orbGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    scene.add(orb);
    
    // Light attached to orb
    const orbLight = new THREE.PointLight(0xffaa00, 2, 30);
    orb.add(orbLight);
    playerRef.current = orb;

    // --- Resize ---
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // --- Animation Loop ---
    const targetPlayerPos = new THREE.Vector3();

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (isPausedRef.current) return;

      const state = systemStateRef.current;
      timeRef.current += 0.01;

      // 1. Update Player Orb Position using Hand Position from State
      // state.handPosition is -1 to 1. Map to ground coords ~ -80 to 80
      const targetX = state.handPosition.x * 80;
      const targetZ = state.handPosition.y * 60 + 20; 
      
      // Add slight hover movement
      targetPlayerPos.set(targetX, 4 + Math.sin(timeRef.current * 2) * 1, targetZ);
      
      if (playerRef.current) {
        playerRef.current.position.lerp(targetPlayerPos, 0.1); // Smooth lerp
      }

      // 2. Determine Atmosphere Colors based on Emotion (Driven by Fist/Open Hand)
      let targetBase = new THREE.Color(0x0a3a0a); // Deep Green
      let targetTip = new THREE.Color(0x88cc44);  // Fresh Green
      let sunColor = new THREE.Color(0xffaa33);   // Orange Sun

      if (state.emotion === Emotion.CALM) {
        targetBase.setHex(0x1a2a0a);
        targetTip.setHex(CONFIG.calmColor); // Golden
        sunColor.setHex(0xffaa33);
      } else if (state.emotion === Emotion.HAPPY) {
        targetBase.setHex(0x004400);
        targetTip.setHex(CONFIG.happyColor); // Vibrant Green
        sunColor.setHex(0xffffcc); // Bright Sun
      } else if (state.emotion === Emotion.SAD) {
        // "Storm" mode
        targetBase.setHex(0x05101a);
        targetTip.setHex(CONFIG.sadColor); // Blue Grey
        sunColor.setHex(0x8899aa); // Cold Sun
      }

      // 3. Update Grass Shader
      if (materialRef.current) {
        // Audio drives wind strength
        // Base wind = 0.5. Add amplitude * 5.0
        const windStrength = 0.5 + (state.soundAmplitude * 5.0);
        
        materialRef.current.uniforms.uTime.value = timeRef.current;
        materialRef.current.uniforms.uWindStrength.value = windStrength;
        
        if (playerRef.current) {
          materialRef.current.uniforms.uPlayerPosition.value.copy(playerRef.current.position);
        }

        // Color Lerping
        materialRef.current.uniforms.uBaseColor.value.lerp(targetBase, 0.05);
        materialRef.current.uniforms.uTipColor.value.lerp(targetTip, 0.05);
      }
      
      // Update Sun Light Color
      sunLight.color.lerp(sunColor, 0.05);

      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      grassGeo.dispose();
      grassMat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      orbGeo.dispose();
      orbMat.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default VisualizerCanvas;