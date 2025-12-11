import React, { useState, useEffect, useRef } from 'react';
import Overlay from './components/Overlay';
import VisualizerCanvas from './components/VisualizerCanvas';
import { AppStatus, SystemState, Emotion } from './types';
import { CONFIG } from './constants';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string>('');
  
  // Refs for mutable data
  const systemStateRef = useRef<SystemState>({
    emotion: Emotion.CALM,
    mouthOpenness: 0,
    mouthCurvature: 0,
    soundAmplitude: 0,
    soundFrequency: 0,
    handPosition: { x: 0, y: 0 },
    isFist: false,
  });

  const statusRef = useRef<AppStatus>(AppStatus.IDLE);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const videoRef = useRef<HTMLVideoElement>(null);
  
  // --- Generative Audio Engine Refs ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const windFilterRef = useRef<BiquadFilterNode | null>(null);
  const windGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  // AI Model Refs
  const handsRef = useRef<any>(null); 
  const faceMeshRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  // --- Logic: Initialize Tracking (Hands + Face) ---
  const initTracking = async () => {
    try {
      // 1. Hands Setup
      const HandsClass = (window as any).Hands || (window as any).mediapipe?.hands?.Hands;
      const FaceMeshClass = (window as any).FaceMesh || (window as any).mediapipe?.face_mesh?.FaceMesh;

      if (!HandsClass || !FaceMeshClass) {
        throw new Error("AI libraries not loaded. Please check your connection.");
      }

      // --- Hands Config ---
      const hands = new HandsClass({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, // Lite model for performance since we are running two models
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults((results: any) => {
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          const landmarks = results.multiHandLandmarks[0];
          const palmCenter = landmarks[9]; 
          const wrist = landmarks[0];

          // Normalized position (Mirror X)
          const x = (1 - palmCenter.x) * 2 - 1; 
          const y = -(palmCenter.y) * 2 + 1;

          // Fist Detection
          // Check tip distance to MCP (Index 9)
          let tipToMcpDist = 0;
          [8, 12, 16, 20].forEach(idx => {
             const tip = landmarks[idx];
             tipToMcpDist += Math.hypot(tip.x - palmCenter.x, tip.y - palmCenter.y);
          });
          const isFist = tipToMcpDist < 0.35; 

          systemStateRef.current.handPosition = { x, y };
          systemStateRef.current.isFist = isFist;
        }
      });
      handsRef.current = hands;

      // --- FaceMesh Config ---
      const faceMesh = new FaceMeshClass({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults((results: any) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0];

          // Indices:
          // 61: Left Mouth Corner
          // 291: Right Mouth Corner
          // 13: Upper Lip Center
          // 14: Lower Lip Center
          const leftCorner = landmarks[61];
          const rightCorner = landmarks[291];
          const upperLip = landmarks[13];
          const lowerLip = landmarks[14];

          // 1. Calculate Mouth Width (for Normalization)
          const width = Math.hypot(rightCorner.x - leftCorner.x, rightCorner.y - leftCorner.y);

          // 2. Calculate Curvature
          // Y increases downwards.
          // Smile: Corners (small Y) are higher than Center (large Y).
          // Metric = CenterY - CornerY. Positive = Smile.
          const cornersY = (leftCorner.y + rightCorner.y) / 2;
          const centerY = (upperLip.y + lowerLip.y) / 2;
          
          let rawCurvature = (centerY - cornersY) / width;

          // 3. Smoothing (Exponential Moving Average)
          const prevCurvature = systemStateRef.current.mouthCurvature;
          // Apply gentle smoothing
          const curvature = prevCurvature * 0.9 + rawCurvature * 0.1;
          systemStateRef.current.mouthCurvature = curvature;

          // 4. Determine Emotion State
          // Thresholds need to be tuned for normalized values
          // > 0.05 is usually a smile
          // < -0.02 is usually a frown/sadness
          if (curvature > 0.04) {
            systemStateRef.current.emotion = Emotion.HAPPY;
          } else if (curvature < -0.03) {
            systemStateRef.current.emotion = Emotion.SAD;
          } else {
            systemStateRef.current.emotion = Emotion.CALM;
          }
        }
      });
      faceMeshRef.current = faceMesh;

    } catch (err) {
      console.error("AI Init Error:", err);
      throw new Error("Failed to initialize tracking.");
    }
  };

  // --- Logic: Wind Audio Engine ---
  const initAudio = async () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.5;
      masterGainRef.current = masterGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      masterGain.connect(analyser);
      analyser.connect(ctx.destination);

      // --- Wind Synthesis (Pink Noise) ---
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      
      // Generate Pink Noise
      let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11; 
        b6 = white * 0.115926;
      }

      const noiseNode = ctx.createBufferSource();
      noiseNode.buffer = noiseBuffer;
      noiseNode.loop = true;
      noiseNode.start();

      // Wind Filter (Bandpass/Lowpass dynamic)
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 400; // Start low
      windFilter.Q.value = 1;
      windFilterRef.current = windFilter;

      const windGain = ctx.createGain();
      windGain.gain.value = 0.8;
      windGainRef.current = windGain;

      noiseNode.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(masterGain);

      return ctx;
    } catch (err) {
      console.error("Audio Engine Init Error:", err);
      throw new Error("Failed to initialize audio engine.");
    }
  };

  // --- Logic: Generative Update Loop ---
  useEffect(() => {
    if (status !== AppStatus.RUNNING) return;

    let time = 0;
    const interval = setInterval(() => {
      const ctx = audioContextRef.current;
      if (!ctx || !analyserRef.current) return;
      time += 0.05;

      const state = systemStateRef.current;
      
      // 1. Analyze for Visuals
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      const amplitude = sum / (bufferLength * 255);
      
      systemStateRef.current.soundAmplitude = systemStateRef.current.soundAmplitude * 0.9 + amplitude * 0.1;

      // 2. Wind Modulation Logic
      if (windFilterRef.current && windGainRef.current) {
        // Base wind variation
        const baseVariation = Math.sin(time * 0.5) * 200 + Math.cos(time * 1.3) * 100;
        
        let targetFreq = 400 + baseVariation;
        let targetGain = 0.5;

        // Interaction: Fist creates "Gusts" (Volume/Intensity) but Face controls Atmosphere
        if (state.isFist) {
           // Gusty mode
           targetFreq = 800 + Math.random() * 600;
           targetGain = 0.8 + Math.random() * 0.3;
        } else {
           // Gentle mode 
           targetFreq = 400 + baseVariation;
           targetGain = 0.4 + Math.sin(time * 0.2) * 0.1;
        }

        const now = ctx.currentTime;
        windFilterRef.current.frequency.setTargetAtTime(targetFreq, now, 0.2);
        windGainRef.current.gain.setTargetAtTime(targetGain, now, 0.2);
      }

    }, 50);

    return () => clearInterval(interval);
  }, [status]);

  // --- Logic: Start Sequence ---
  const handleStart = async () => {
    setStatus(AppStatus.LOADING);
    setError('');

    try {
      await initAudio(); 
      await initTracking();

      if (videoRef.current && handsRef.current && faceMeshRef.current) {
        const CameraClass = (window as any).Camera || (window as any).mediapipe?.camera_utils?.Camera;
        const camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (statusRef.current !== AppStatus.RUNNING) return;
            // Send to both models. 
            // NOTE: This is heavy. In a production app, we might alternate frames or use a web worker.
            if (videoRef.current) {
               await handsRef.current.send({ image: videoRef.current });
               await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480,
        });
        cameraRef.current = camera;
        await camera.start();
      }

      setStatus(AppStatus.RUNNING);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Initialization failed");
      setStatus(AppStatus.ERROR);
    }
  };

  const togglePause = async () => {
    if (status === AppStatus.RUNNING) {
      if (audioContextRef.current) await audioContextRef.current.suspend();
      setStatus(AppStatus.PAUSED);
    } else if (status === AppStatus.PAUSED) {
      if (audioContextRef.current) await audioContextRef.current.resume();
      setStatus(AppStatus.RUNNING);
    }
  };

  const [uiState, setUiState] = useState<SystemState>(systemStateRef.current);
  useEffect(() => {
    if (status !== AppStatus.RUNNING) return;
    const uiInterval = setInterval(() => setUiState({ ...systemStateRef.current }), 200);
    return () => clearInterval(uiInterval);
  }, [status]);


  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-serif">
      <video
        ref={videoRef}
        className={`absolute bottom-6 right-6 w-48 sm:w-64 aspect-video object-cover rounded-xl border border-white/20 shadow-[0_0_30px_rgba(0,0,0,0.6)] z-30 transition-all duration-700 ${
            status === AppStatus.RUNNING || status === AppStatus.PAUSED ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />
      
      <VisualizerCanvas 
        systemStateRef={systemStateRef} 
        isPaused={status === AppStatus.PAUSED}
      />
      
      <Overlay 
        status={status} 
        onStart={handleStart} 
        onTogglePause={togglePause}
        error={error}
        systemState={uiState}
      />
    </div>
  );
};

export default App;