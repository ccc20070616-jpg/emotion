import { VisualizerConfig } from './types';

export const CONFIG: VisualizerConfig = {
  particleCount: 80000, // Increased for a larger world density
  sphereRadius: 80,
  particleRadius: 3.0,
  
  // Nature / Healing Colors
  happyColor: 0xB0D66B, // Lighter, more realistic Yellow-Green (was 0x66FF66)
  calmColor: 0xE6C229,  // Golden Hour / Warm Wheat
  sadColor: 0x4A6B8A,   // Stormy Blue-Grey

  happySpeed: 0.02,
  sadSpeed: 0.05,
  happyMusicRate: 1.15,
  sadMusicRate: 0.85,
  mouthThreshold: 0.3,
  musicUrl: 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/858/outfoxing.mp3'
};