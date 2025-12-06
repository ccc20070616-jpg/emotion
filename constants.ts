import { VisualizerConfig } from './types';

export const CONFIG: VisualizerConfig = {
  particleCount: 1200,
  sphereRadius: 40,
  particleRadius: 2.5,
  happyColor: 0xff6633, // Warm Orange
  sadColor: 0x3399ff,   // Cool Blue
  happySpeed: 0.015,
  sadSpeed: 0.04,
  happyMusicRate: 1.1,  // Upbeat
  sadMusicRate: 0.85,   // Slow/Melancholic
  mouthThreshold: 0.3,
  // Using a reliable static asset for demo purposes (Kevin MacLeod - Outfoxing)
  // This source allows CORS and is stable.
  musicUrl: 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/858/outfoxing.mp3'
};