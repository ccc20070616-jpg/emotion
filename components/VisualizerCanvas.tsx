import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONFIG } from '../constants';
import { SystemState, Emotion } from '../types';

interface VisualizerCanvasProps {
  systemStateRef: React.MutableRefObject<SystemState>;
  isPaused: boolean;
}

// --- Constants for Optimization ---
const WORLD_EXTENT = 5000; // Increased map size significantly (-5000 to 5000)
const CHUNK_SIZE = 500;
const TOTAL_CHUNKS_SIDE = (WORLD_EXTENT * 2) / CHUNK_SIZE; 
// Fixed density per chunk to ensure lush grass regardless of map size
const INSTANCES_PER_CHUNK = 2000; 

// --- Shaders ---

const GRASS_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorldPosition;
  
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uPlayerPosition;
  uniform vec3 uBaseColor;
  uniform vec3 uTipColor;
  
  float noise(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }
  
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
    vec3 pos = position;
    // instanceMatrix is handled automatically by three.js for InstancedMesh
    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
    
    // Calculate height percentage (0.0 bottom to 1.0 top)
    // Blade height is approx 4.5
    float heightPercent = pos.y / 4.5; 
    
    // --- Wind Animation ---
    float windWave = smoothNoise(worldPos.xz * 0.05 + uTime * 0.5);
    float windJitter = smoothNoise(worldPos.xz * 0.2 + uTime * 2.0);
    float totalWind = (windWave * 0.7 + windJitter * 0.3) * uWindStrength * heightPercent; 
    
    worldPos.x += totalWind * 2.0;
    worldPos.z += totalWind * 1.0;
    
    // --- Interactive Push ---
    float dist = distance(worldPos.xz, uPlayerPosition.xz);
    float interactRadius = 35.0; 
    if (dist < interactRadius) {
        float pushFactor = (1.0 - dist / interactRadius);
        pushFactor = pow(pushFactor, 2.0) * 12.0 * heightPercent; 
        
        vec3 pushDir = normalize(worldPos.xyz - uPlayerPosition);
        worldPos.x += pushDir.x * pushFactor;
        worldPos.z += pushDir.z * pushFactor;
        worldPos.y -= pushFactor * 0.5; 
    }

    vWorldPosition = worldPos.xyz;
    
    // --- Coloring ---
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
    vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    vec3 lightDir = normalize(uSunPosition - vWorldPosition);
    
    float diff = max(dot(normal, lightDir), 0.0);
    // Simple ambient + diffuse
    vec3 light = vColor * (diff * 0.6 + 0.4);
    
    gl_FragColor = vec4(light, 1.0);
    
    // Distance fog (Matches scene fog)
    float dist = length(vWorldPosition.xz - cameraPosition.xz);
    float fogFactor = smoothstep(500.0, 2500.0, dist); // Increased fog distance for larger world
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.05, 0.05, 0.08), fogFactor);
  }
`;

// --- Weather Shaders ---

const WEATHER_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uSway;
  uniform float uSize;
  
  attribute float aRandom;
  
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    
    // 1. Falling Logic (Y axis)
    float fallOffset = uTime * uSpeed * (0.8 + 0.4 * aRandom); 
    float height = 200.0;
    pos.y = 100.0 - mod((100.0 - pos.y) + fallOffset, height);
    
    // 2. Sway Logic (X/Z axis)
    float swayVal = sin(uTime * uSway + aRandom * 10.0);
    pos.x += swayVal * 5.0 * (0.5 + aRandom);
    pos.z += cos(uTime * uSway * 0.8 + aRandom * 12.0) * 5.0 * (0.5 + aRandom);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    
    // Size attenuation
    gl_PointSize = uSize * (0.8 + 0.4 * aRandom) * (300.0 / -mvPosition.z);
    
    gl_Position = projectionMatrix * mvPosition;
    
    // Fade out at top/bottom of box
    float normY = (pos.y + 100.0) / 200.0;
    vAlpha = smoothstep(0.0, 0.15, normY) * smoothstep(1.0, 0.85, normY);
  }
`;

const WEATHER_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    
    float glow = 1.0 - smoothstep(0.3, 0.5, r);
    gl_FragColor = vec4(uColor, vAlpha * glow * 0.8);
  }
`;

// --- Sun Halo Shader ---
const SUN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(vUv, center);
    
    // Soft glow gradient
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = pow(glow, 2.0); // Make it softer
    
    gl_FragColor = vec4(uColor, glow * uOpacity);
  }
`;


const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({ systemStateRef, isPaused }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const weatherMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const playerRef = useRef<THREE.Mesh | null>(null);
  const weatherSystemRef = useRef<THREE.Points | null>(null);
  
  // New Refs for Sun and Butterfly
  const sunHaloMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const butterflyGroupRef = useRef<THREE.Group | null>(null);
  const leftWingRef = useRef<THREE.Mesh | null>(null);
  const rightWingRef = useRef<THREE.Mesh | null>(null);
  
  // LOD Management
  const lodsRef = useRef<THREE.LOD[]>([]);
  
  const frameIdRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const isPausedRef = useRef(isPaused);
  
  // Physics State
  const playerVelocity = useRef(new THREE.Vector2(0, 0));
  const playerPosition = useRef(new THREE.Vector3(0, 6, 0)); 

  // Weather State
  const currentWeather = useRef({
    color: new THREE.Color(0xffffff),
    speed: 10,
    sway: 1,
    size: 4
  });

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Init Scene ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050508);
    // Increased fog range for larger world
    scene.fog = new THREE.Fog(0x050508, 500, 2500); 
    sceneRef.current = scene;

    // --- Init Camera ---
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 6000);
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

    const sunPos = new THREE.Vector3(100, 300, -100);
    const sunLight = new THREE.DirectionalLight(0xffaa33, 1.5);
    sunLight.position.copy(sunPos);
    sunLight.castShadow = true;
    // Increase shadow map coverage for larger area
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 3000;
    sunLight.shadow.camera.left = -2000;
    sunLight.shadow.camera.right = 2000;
    sunLight.shadow.camera.top = 2000;
    sunLight.shadow.camera.bottom = -2000;
    scene.add(sunLight);

    // --- Sun Halo (Visual Only) ---
    const sunHaloGeo = new THREE.PlaneGeometry(300, 300);
    const sunHaloMat = new THREE.ShaderMaterial({
      vertexShader: SUN_VERTEX_SHADER,
      fragmentShader: SUN_FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(0xffaa33) },
        uOpacity: { value: 0.0 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    sunHaloMatRef.current = sunHaloMat;
    const sunHalo = new THREE.Mesh(sunHaloGeo, sunHaloMat);
    sunHalo.position.copy(sunPos);
    sunHalo.lookAt(camera.position); // Initially look at camera
    scene.add(sunHalo);

    // --- Butterfly Companion ---
    const butterflyGroup = new THREE.Group();
    
    // Wings geometry (Semi-circle)
    const wingGeo = new THREE.CircleGeometry(0.8, 8, 0, Math.PI);
    const wingMat = new THREE.MeshBasicMaterial({ 
      color: 0x88CCFF, // Light Blue
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });

    const lWing = new THREE.Mesh(wingGeo, wingMat);
    lWing.rotation.z = Math.PI / 2; // Orient upright
    lWing.rotation.x = Math.PI / 2; // Flat
    lWing.position.set(-0.1, 0, 0); // Offset from center
    // Adjust pivot visual
    lWing.geometry.translate(0, 0.4, 0); 

    const rWing = new THREE.Mesh(wingGeo, wingMat);
    rWing.rotation.z = -Math.PI / 2;
    rWing.rotation.x = Math.PI / 2;
    rWing.position.set(0.1, 0, 0);
    rWing.geometry.translate(0, 0.4, 0);

    butterflyGroup.add(lWing);
    butterflyGroup.add(rWing);
    
    // Add a tiny glow light to the butterfly
    const butterflyLight = new THREE.PointLight(0x0088ff, 0.8, 20);
    butterflyGroup.add(butterflyLight);

    scene.add(butterflyGroup);
    
    butterflyGroupRef.current = butterflyGroup;
    leftWingRef.current = lWing;
    rightWingRef.current = rWing;

    // --- Ground Plane ---
    // Make ground huge to cover the new extent
    // Changed color from 0x051005 to 0x0c1e0c (slightly lighter natural dark green)
    const groundGeo = new THREE.PlaneGeometry(12000, 12000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0c1e0c, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- Grass Setup (LOD System) ---
    const bladeWidth = 0.7;
    const bladeHeight = 4.5;
    
    // High Detail: 3 vertical segments
    const grassGeoHigh = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, 3);
    grassGeoHigh.translate(0, bladeHeight / 2, 0); 

    // Low Detail: 1 vertical segment (Reduced vertex count)
    const grassGeoLow = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 1, 1);
    grassGeoLow.translate(0, bladeHeight / 2, 0);

    const grassMat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 1.0 },
        uPlayerPosition: { value: new THREE.Vector3(0, 0, 0) },
        uBaseColor: { value: new THREE.Color(0x2a5a2a) }, // Initial Base Color
        uTipColor: { value: new THREE.Color(0xB0D66B) }, // Initial Tip Color
        uSunPosition: { value: sunLight.position },
      },
      side: THREE.DoubleSide,
    });
    materialRef.current = grassMat;

    // --- Chunk Generation ---
    const chunks: THREE.LOD[] = [];
    const dummy = new THREE.Object3D();

    // Iterate over grid
    const halfGrid = TOTAL_CHUNKS_SIDE / 2;
    
    for (let x = -halfGrid; x < halfGrid; x++) {
      for (let z = -halfGrid; z < halfGrid; z++) {
        const lod = new THREE.LOD();
        
        // Calculate Chunk Center
        const centerX = x * CHUNK_SIZE + CHUNK_SIZE / 2;
        const centerZ = z * CHUNK_SIZE + CHUNK_SIZE / 2;
        
        lod.position.set(centerX, 0, centerZ);

        // --- Level 0: High Detail ---
        const meshHigh = new THREE.InstancedMesh(grassGeoHigh, grassMat, INSTANCES_PER_CHUNK);
        meshHigh.castShadow = true;
        meshHigh.receiveShadow = true;

        // --- Level 1: Low Detail ---
        const meshLow = new THREE.InstancedMesh(grassGeoLow, grassMat, INSTANCES_PER_CHUNK);
        meshLow.castShadow = false; 
        meshLow.receiveShadow = true;

        // Populate Instances (Relative to Chunk Center)
        for (let i = 0; i < INSTANCES_PER_CHUNK; i++) {
          // Random pos within chunk size
          const px = (Math.random() - 0.5) * CHUNK_SIZE;
          const pz = (Math.random() - 0.5) * CHUNK_SIZE;
          
          dummy.position.set(px, 0, pz);
          dummy.rotation.y = Math.random() * Math.PI;
          
          // Random scale
          const scale = 0.8 + Math.random() * 0.7;
          dummy.scale.set(scale, scale, scale);
          
          dummy.updateMatrix();
          
          meshHigh.setMatrixAt(i, dummy.matrix);
          meshLow.setMatrixAt(i, dummy.matrix);
        }

        meshHigh.instanceMatrix.needsUpdate = true;
        meshLow.instanceMatrix.needsUpdate = true;
        
        // Add levels to LOD
        lod.addLevel(meshHigh, 0);
        lod.addLevel(meshLow, 800); // Push low detail distance slightly further

        lod.autoUpdate = false; 
        
        scene.add(lod);
        chunks.push(lod);
      }
    }
    lodsRef.current = chunks;

    // --- Weather System ---
    const weatherCount = 2000;
    const weatherGeo = new THREE.BufferGeometry();
    const weatherPos = [];
    const weatherRandom = [];
    
    for(let i=0; i<weatherCount; i++) {
        weatherPos.push(
            (Math.random() - 0.5) * 400,
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 400
        );
        weatherRandom.push(Math.random());
    }
    weatherGeo.setAttribute('position', new THREE.Float32BufferAttribute(weatherPos, 3));
    weatherGeo.setAttribute('aRandom', new THREE.Float32BufferAttribute(weatherRandom, 1));
    
    const weatherMat = new THREE.ShaderMaterial({
        vertexShader: WEATHER_VERTEX_SHADER,
        fragmentShader: WEATHER_FRAGMENT_SHADER,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) },
            uSpeed: { value: 10.0 },
            uSway: { value: 1.0 },
            uSize: { value: 4.0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    weatherMatRef.current = weatherMat;
    
    const weatherSystem = new THREE.Points(weatherGeo, weatherMat);
    scene.add(weatherSystem);
    weatherSystemRef.current = weatherSystem;

    // --- The Player (Orb) ---
    const orbGeo = new THREE.SphereGeometry(2.5, 32, 32);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    scene.add(orb);
    
    const orbLight = new THREE.PointLight(0xffaa00, 2, 60);
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
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (isPausedRef.current) return;

      const state = systemStateRef.current;
      timeRef.current += 0.01;

      // 1. MOVEMENT LOGIC
      const joyX = state.handPosition.x;
      const joyY = state.handPosition.y; 
      const dist = Math.sqrt(joyX * joyX + joyY * joyY);
      const deadzone = 0.15;
      
      let speed = 0;
      let turn = 0;

      if (dist > deadzone) {
          speed = (dist - deadzone) * 2.0; 
          turn = joyX * 2.5;
      }

      const directionZ = state.isFist ? 1.0 : -1.0; 
      
      const targetVelX = turn;
      const targetVelZ = speed * directionZ;

      playerVelocity.current.x = playerVelocity.current.x * 0.9 + targetVelX * 0.1;
      playerVelocity.current.y = playerVelocity.current.y * 0.9 + targetVelZ * 0.1; 

      const moveSpeed = 0.6; 
      playerPosition.current.x += playerVelocity.current.x * moveSpeed;
      playerPosition.current.z += playerVelocity.current.y * moveSpeed;

      // Limit bounds (Updated for larger world)
      const maxRange = WORLD_EXTENT - 100;
      if (playerPosition.current.x > maxRange) playerPosition.current.x = maxRange;
      if (playerPosition.current.x < -maxRange) playerPosition.current.x = -maxRange;
      if (playerPosition.current.z > maxRange) playerPosition.current.z = maxRange;
      if (playerPosition.current.z < -maxRange) playerPosition.current.z = -maxRange;

      const bobHeight = 6 + Math.sin(timeRef.current * 1.5) * 1.0;
      
      if (playerRef.current) {
        playerRef.current.position.set(playerPosition.current.x, bobHeight, playerPosition.current.z);
        
        // Update Weather Position
        if (weatherSystemRef.current) {
            weatherSystemRef.current.position.x = playerPosition.current.x;
            weatherSystemRef.current.position.z = playerPosition.current.z;
            weatherSystemRef.current.position.y = 50; 
        }

        const offsetZ = 60;
        const offsetY = 30;
        const targetCamPos = new THREE.Vector3(
            playerPosition.current.x,
            offsetY,
            playerPosition.current.z + offsetZ 
        );

        if (cameraRef.current) {
            cameraRef.current.position.lerp(targetCamPos, 0.05);
            cameraRef.current.lookAt(
                playerPosition.current.x, 
                bobHeight, 
                playerPosition.current.z - 20 
            );
            
            // Update LODs manually
            lodsRef.current.forEach(lod => lod.update(cameraRef.current!));
            
            // Keep Sun Halo facing camera
            sunHalo.lookAt(cameraRef.current.position);
        }
        
        // --- Butterfly Animation ---
        if (butterflyGroupRef.current && leftWingRef.current && rightWingRef.current) {
           const bf = butterflyGroupRef.current;
           
           // Target position: slightly offset from player
           // Use noise to make it hover/dance
           const hoverX = Math.sin(timeRef.current * 1.2) * 5.0;
           const hoverY = Math.cos(timeRef.current * 2.3) * 3.0 + 5.0; // Higher up
           const hoverZ = Math.cos(timeRef.current * 0.8) * 5.0;
           
           const targetPos = new THREE.Vector3(
             playerPosition.current.x + hoverX + 8, // Offset slightly right
             bobHeight + hoverY,
             playerPosition.current.z + hoverZ
           );
           
           // Smooth follow
           bf.position.lerp(targetPos, 0.05);
           
           // Look at where it's going (approximate by target)
           // Add a slight look ahead
           const lookTarget = targetPos.clone().add(new THREE.Vector3(hoverX, 0, hoverZ));
           bf.lookAt(lookTarget);
           
           // Flap wings
           const flapSpeed = 15.0 + Math.sin(timeRef.current) * 5.0; // Variable speed
           const flapAmp = 0.8;
           leftWingRef.current.rotation.y = Math.sin(timeRef.current * flapSpeed) * flapAmp;
           rightWingRef.current.rotation.y = -Math.sin(timeRef.current * flapSpeed) * flapAmp;
        }
      }

      // 3. Atmosphere & Weather Targets
      let targetBase = new THREE.Color(0x0a3a0a);
      let targetTip = new THREE.Color(0x88cc44);
      let sunColor = new THREE.Color(0xffaa33);
      
      let targetWeatherColor = new THREE.Color(0xffffff);
      let targetWeatherSpeed = 10;
      let targetWeatherSway = 1;
      let targetWeatherSize = 3;
      
      let targetHaloOpacity = 0.0;
      let targetHaloColor = new THREE.Color(0xffaa33);

      if (state.emotion === Emotion.CALM) {
        // Autumn
        targetBase.setHex(0x1a2a0a);
        targetTip.setHex(CONFIG.calmColor);
        sunColor.setHex(0xffaa33);
        
        targetWeatherColor.setHex(0xE6C229);
        targetWeatherSpeed = 6.0;
        targetWeatherSway = 2.0;
        targetWeatherSize = 5.0;
        
        // Gentle warm halo
        targetHaloOpacity = 0.4;
        targetHaloColor.setHex(0xffaa00);
      } else if (state.emotion === Emotion.HAPPY) {
        // Summer
        targetBase.setHex(0x2a5a2a); 
        targetTip.setHex(CONFIG.happyColor);
        sunColor.setHex(0xffffcc);
        
        targetWeatherColor.setHex(0x88FF88); 
        targetWeatherSpeed = 8.0;
        targetWeatherSway = 1.5;
        targetWeatherSize = 4.0;
        
        // Bright Halo for Spring/Summer
        targetHaloOpacity = 0.8;
        targetHaloColor.setHex(0xfffee0);
      } else if (state.emotion === Emotion.SAD) {
        // Winter
        targetBase.setHex(0x05101a);
        targetTip.setHex(CONFIG.sadColor);
        sunColor.setHex(0x8899aa);
        
        targetWeatherColor.setHex(0xDDDDFF); 
        targetWeatherSpeed = 25.0;
        targetWeatherSway = 0.5;
        targetWeatherSize = 2.5;
        
        // No Halo
        targetHaloOpacity = 0.0;
      }

      // Update Grass Uniforms
      if (materialRef.current) {
        const windStrength = 0.5 + (state.soundAmplitude * 5.0);
        materialRef.current.uniforms.uTime.value = timeRef.current;
        materialRef.current.uniforms.uWindStrength.value = windStrength;
        if (playerRef.current) {
          materialRef.current.uniforms.uPlayerPosition.value.copy(playerRef.current.position);
        }
        materialRef.current.uniforms.uBaseColor.value.lerp(targetBase, 0.05);
        materialRef.current.uniforms.uTipColor.value.lerp(targetTip, 0.05);
      }
      sunLight.color.lerp(sunColor, 0.05);
      
      // Update Weather Uniforms
      if (weatherMatRef.current) {
          currentWeather.current.color.lerp(targetWeatherColor, 0.05);
          currentWeather.current.speed += (targetWeatherSpeed - currentWeather.current.speed) * 0.05;
          currentWeather.current.sway += (targetWeatherSway - currentWeather.current.sway) * 0.05;
          currentWeather.current.size += (targetWeatherSize - currentWeather.current.size) * 0.05;

          weatherMatRef.current.uniforms.uTime.value = timeRef.current;
          weatherMatRef.current.uniforms.uColor.value.copy(currentWeather.current.color);
          weatherMatRef.current.uniforms.uSpeed.value = currentWeather.current.speed;
          weatherMatRef.current.uniforms.uSway.value = currentWeather.current.sway;
          weatherMatRef.current.uniforms.uSize.value = currentWeather.current.size;
      }
      
      // Update Sun Halo
      if (sunHaloMatRef.current) {
          sunHaloMatRef.current.uniforms.uColor.value.lerp(targetHaloColor, 0.05);
          // Simple Lerp for float
          const curOp = sunHaloMatRef.current.uniforms.uOpacity.value;
          sunHaloMatRef.current.uniforms.uOpacity.value = curOp + (targetHaloOpacity - curOp) * 0.02;
      }

      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      // Cleanup
      grassGeoHigh.dispose();
      grassGeoLow.dispose();
      grassMat.dispose();
      weatherGeo.dispose();
      weatherMat.dispose();
      groundGeo.dispose();
      groundMat.dispose();
      orbGeo.dispose();
      orbMat.dispose();
      sunHaloGeo.dispose();
      sunHaloMat.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default VisualizerCanvas;