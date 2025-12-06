export interface SystemState {
  isHappy: boolean;
  mouthOpenness: number;
  soundAmplitude: number;
  soundFrequency: number;
}

export interface VisualizerConfig {
  particleCount: number;
  sphereRadius: number;
  particleRadius: number;
  happyColor: number;
  sadColor: number;
  happySpeed: number;
  sadSpeed: number;
  happyMusicRate: number;
  sadMusicRate: number;
  mouthThreshold: number;
  musicUrl: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  READY = 'READY',
  RUNNING = 'RUNNING',
  ERROR = 'ERROR'
}
