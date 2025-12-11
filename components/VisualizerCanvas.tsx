import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONFIG } from '../constants';
import { SystemState, Emotion } from '../types';

interface VisualizerCanvasProps {
  systemStateRef: React.MutableRefObject<SystemState>;
  isPaused: boolean;
}

const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({ systemStateRef, isPaused }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const frameIdRef = useRef<number>(0);
  
  // Track hue for color flow
  const colorFlowRef = useRef<number>(0);
  
  // Ref to track pause state
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Init Scene ---
    const scene = new THREE.Scene();
    // Add Volumetric Fog (Exp2 for density gradient)
    scene.fog = new THREE.FogExp2(0x000000, 0.002);
    sceneRef.current = scene;

    // --- Init Camera ---
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1500);
    camera.position.z = 300;
    cameraRef.current = camera;

    // --- Init Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Init Objects ---
    // 1. Sphere - High emissive for Glow effect
    const sphereGeometry = new THREE.SphereGeometry(CONFIG.sphereRadius, 64, 64);
    const sphereMaterial = new THREE.MeshPhongMaterial({
      color: CONFIG.happyColor,
      emissive: CONFIG.happyColor,
      emissiveIntensity: 0.8, // Enhanced glow
      shininess: 100,
      flatShading: false,
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);
    sphereRef.current = sphere;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1.5, 800);
    pointLight.position.set(100, 100, 100);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0x5555ff, 1.0, 800);
    backLight.position.set(-100, -100, -100);
    scene.add(backLight);

    // 3. Particles - Enhanced Size for Bloom-like effect
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(CONFIG.particleCount * 3);
    const colors = new Float32Array(CONFIG.particleCount * 3);
    const sizes = new Float32Array(CONFIG.particleCount);

    const baseColor = new THREE.Color(CONFIG.happyColor);

    for (let i = 0; i < CONFIG.particleCount; i++) {
      const i3 = i * 3;
      // Start slightly further out for fog integration
      const r = 160 + Math.random() * 300; 
      
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      
      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      colors[i3] = baseColor.r;
      colors[i3 + 1] = baseColor.g;
      colors[i3 + 2] = baseColor.b;

      // Varied sizes for depth
      sizes[i] = CONFIG.particleRadius * (0.5 + Math.random() * 2.5);
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const particleMaterial = new THREE.PointsMaterial({
      size: CONFIG.particleRadius,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending, // Enhances glow when particles overlap
      sizeAttenuation: true
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
    particlesRef.current = particles;

    // --- Resize Handler ---
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // --- Animation Loop ---
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      
      if (isPausedRef.current) {
        if (rendererRef.current && sceneRef.current && cameraRef.current) {
           rendererRef.current.render(sceneRef.current, cameraRef.current);
        }
        return;
      }

      const state = systemStateRef.current;
      const { emotion, soundAmplitude, soundFrequency } = state;

      // Determine Target Base Color
      let targetHex = CONFIG.calmColor;
      let targetSpeed = 0.02;

      if (emotion === Emotion.HAPPY) {
        targetHex = CONFIG.happyColor;
        targetSpeed = CONFIG.happySpeed;
      } else if (emotion === Emotion.SAD) {
        targetHex = CONFIG.sadColor;
        targetSpeed = CONFIG.sadSpeed;
      } else {
        targetHex = CONFIG.calmColor;
        targetSpeed = 0.02; // Calm speed
      }

      // RGB Flow Logic: Shift Hue slightly over time
      colorFlowRef.current += 0.002;
      const baseObjColor = new THREE.Color(targetHex);
      const hsl = { h: 0, s: 0, l: 0 };
      baseObjColor.getHSL(hsl);
      // Subtle shift +/- 0.05 on Hue based on sine wave
      const flowingHue = (hsl.h + Math.sin(colorFlowRef.current) * 0.05 + 1) % 1; 
      baseObjColor.setHSL(flowingHue, 1.0, 0.5); // Force high saturation (1.0)

      // Update Sphere
      if (sphereRef.current) {
        const mat = sphereRef.current.material as THREE.MeshPhongMaterial;
        mat.color.lerp(baseObjColor, 0.05);
        
        // Emissive pulse
        const emissiveIntensity = 0.5 + (soundAmplitude * 1.5); // High glow
        mat.emissive.setRGB(
          mat.color.r,
          mat.color.g,
          mat.color.b
        );
        mat.emissiveIntensity = emissiveIntensity;

        // Movement
        sphereRef.current.rotation.y += 0.005 + (soundFrequency * 0.02);
        sphereRef.current.rotation.z += 0.002;
        
        const pulseStrength = 0.8; 
        const targetScale = 1 + (soundAmplitude * pulseStrength);
        sphereRef.current.scale.setScalar(THREE.MathUtils.lerp(sphereRef.current.scale.x, targetScale, 0.2));

        const shakeStrength = 6.0; 
        const jitter = soundAmplitude * shakeStrength;
        sphereRef.current.position.x = (Math.random() - 0.5) * jitter;
        sphereRef.current.position.y = (Math.random() - 0.5) * jitter;
        sphereRef.current.position.z = (Math.random() - 0.5) * jitter;
      }

      // Update Particles
      if (particlesRef.current) {
        const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
        const count = CONFIG.particleCount;
        
        particlesRef.current.rotation.y += targetSpeed * (1 + soundFrequency);
        particlesRef.current.rotation.x += targetSpeed * 0.5;

        // Apply flowing color to particles
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          colors[i3] += (baseObjColor.r - colors[i3]) * 0.03;
          colors[i3 + 1] += (baseObjColor.g - colors[i3 + 1]) * 0.03;
          colors[i3 + 2] += (baseObjColor.b - colors[i3 + 2]) * 0.03;
        }
        particlesRef.current.geometry.attributes.color.needsUpdate = true;
        
        const pScale = 1 + (soundAmplitude * 0.15);
        particlesRef.current.scale.setScalar(pScale);
      }

      // Sync fog color slightly with emotion
      if (sceneRef.current.fog) {
          const fog = sceneRef.current.fog as THREE.FogExp2;
          // Very dark version of the base color for fog
          const fogColor = baseObjColor.clone().multiplyScalar(0.1); 
          fog.color.lerp(fogColor, 0.02);
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
      
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default VisualizerCanvas;