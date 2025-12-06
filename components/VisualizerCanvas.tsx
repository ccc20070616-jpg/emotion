import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CONFIG } from '../constants';
import { SystemState } from '../types';

interface VisualizerCanvasProps {
  systemStateRef: React.MutableRefObject<SystemState>;
}

const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({ systemStateRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const frameIdRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- Init Scene ---
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // --- Init Camera ---
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
    // 1. Sphere
    const sphereGeometry = new THREE.SphereGeometry(CONFIG.sphereRadius, 64, 64);
    const sphereMaterial = new THREE.MeshPhongMaterial({
      color: CONFIG.happyColor,
      emissive: 0x111111,
      shininess: 100,
      flatShading: false,
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);
    sphereRef.current = sphere;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 500);
    pointLight.position.set(100, 100, 100);
    scene.add(pointLight);

    const backLight = new THREE.PointLight(0x5555ff, 0.5, 500);
    backLight.position.set(-100, -100, -100);
    scene.add(backLight);

    // 3. Particles
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(CONFIG.particleCount * 3);
    const colors = new Float32Array(CONFIG.particleCount * 3);
    const sizes = new Float32Array(CONFIG.particleCount);

    const baseColor = new THREE.Color(CONFIG.happyColor);

    for (let i = 0; i < CONFIG.particleCount; i++) {
      const i3 = i * 3;
      // Distribute in a spherical shell area
      const r = 100 + Math.random() * 200; 
      // Convert polar to cartesian (2D ring distribution mostly, slightly 3D)
      // Let's make it a cloud around the sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      
      positions[i3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = r * Math.cos(phi);

      colors[i3] = baseColor.r;
      colors[i3 + 1] = baseColor.g;
      colors[i3 + 2] = baseColor.b;

      sizes[i] = CONFIG.particleRadius * (0.5 + Math.random() * 1.5);
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Custom shader material for better particle control or standard PointsMaterial
    const particleMaterial = new THREE.PointsMaterial({
      size: CONFIG.particleRadius,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
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

      const state = systemStateRef.current;
      const { isHappy, soundAmplitude, soundFrequency } = state;

      const targetColorVal = isHappy ? CONFIG.happyColor : CONFIG.sadColor;
      const targetSpeed = isHappy ? CONFIG.happySpeed : CONFIG.sadSpeed;
      
      const targetColor = new THREE.Color(targetColorVal);

      // Update Sphere
      if (sphereRef.current) {
        const mat = sphereRef.current.material as THREE.MeshPhongMaterial;
        mat.color.lerp(targetColor, 0.05);
        
        // Emissive pulse based on audio
        const emissiveIntensity = 0.2 + (soundAmplitude * 0.5);
        mat.emissive.setRGB(
          mat.color.r * emissiveIntensity,
          mat.color.g * emissiveIntensity,
          mat.color.b * emissiveIntensity
        );

        // Rotation
        sphereRef.current.rotation.y += 0.005 + (soundFrequency * 0.02);
        sphereRef.current.rotation.z += 0.002;
        
        // Scale pulse
        const scale = 1 + (soundAmplitude * 0.3);
        sphereRef.current.scale.setScalar(THREE.MathUtils.lerp(sphereRef.current.scale.x, scale, 0.2));
      }

      // Update Particles
      if (particlesRef.current) {
        const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;
        const colors = particlesRef.current.geometry.attributes.color.array as Float32Array;
        const count = CONFIG.particleCount;
        
        const time = Date.now() * 0.001;
        const waveAmp = 20 + (soundAmplitude * 80);
        const waveFreq = 1 + (soundFrequency * 5);

        // Rotate the whole particle system for base movement
        particlesRef.current.rotation.y += targetSpeed * (1 + soundFrequency);
        particlesRef.current.rotation.x += targetSpeed * 0.5;

        // Color update
        for (let i = 0; i < count; i++) {
          const i3 = i * 3;
          // Simple lerp for color
          colors[i3] += (targetColor.r - colors[i3]) * 0.02;
          colors[i3 + 1] += (targetColor.g - colors[i3 + 1]) * 0.02;
          colors[i3 + 2] += (targetColor.b - colors[i3 + 2]) * 0.02;
        }
        particlesRef.current.geometry.attributes.color.needsUpdate = true;
        
        // Pulse particle system size
        const pScale = 1 + (soundAmplitude * 0.1);
        particlesRef.current.scale.setScalar(pScale);
      }

      rendererRef.current?.render(sceneRef.current!, cameraRef.current!);
    };

    animate();

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      
      // Dispose Geometries/Materials
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
    };
  }, []); // Run once on mount

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default VisualizerCanvas;
