import { VisualizerConfig } from './types';

export const CONFIG: VisualizerConfig = {
  particleCount: 1500,  // Increased for denser fog effect
  sphereRadius: 80,
  particleRadius: 3.0,  // Slightly larger for glow
  
  // High Saturation / Neon Colors
  happyColor: 0xFF2A00, // Vivid Red-Orange
  calmColor: 0x00FFD5,  // Vivid Cyan/Teal
  sadColor: 0x6200FF,   // Vivid Indigo/Electric Purple

  happySpeed: 0.02,
  sadSpeed: 0.05,
  happyMusicRate: 1.15,
  sadMusicRate: 0.85,
  mouthThreshold: 0.3,
  musicUrl: 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/858/outfoxing.mp3'
};