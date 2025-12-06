import React, { useState, useEffect, useRef } from 'react';
import Overlay from './components/Overlay';
import VisualizerCanvas from './components/VisualizerCanvas';
import { AppStatus, SystemState } from './types';
import { CONFIG } from './constants';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string>('');
  
  // Refs for mutable data to avoid re-renders in the loop
  const systemStateRef = useRef<SystemState>({
    isHappy: false,
    mouthOpenness: 0,
    soundAmplitude: 0,
    soundFrequency: 0,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const faceMeshRef = useRef<any>(null); // Use any for global lib
  const cameraRef = useRef<any>(null);    // Use any for global lib

  // --- Logic: Initialize FaceMesh ---
  const initFaceMesh = async () => {
    try {
      // Access global FaceMesh loaded via script tag
      // It might be on window.FaceMesh or window.mediapipe.face_mesh.FaceMesh depending on the version/build
      const FaceMeshClass = (window as any).FaceMesh || (window as any).mediapipe?.face_mesh?.FaceMesh;

      if (!FaceMeshClass) {
        throw new Error("FaceMesh library not loaded. Please check your connection.");
      }

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
          // Indices: 61=LeftCorner, 291=RightCorner, 13=UpperLip, 14=LowerLip
          const left = landmarks[61];
          const right = landmarks[291];
          const top = landmarks[13];
          const bottom = landmarks[14];

          const width = Math.hypot(right.x - left.x, right.y - left.y);
          const height = Math.hypot(bottom.x - top.x, bottom.y - top.y);
          
          // Avoid divide by zero
          const ratio = width > 0 ? height / width : 0;
          const openness = Math.min(Math.max(ratio, 0), 1); // Clamp 0-1

          systemStateRef.current.mouthOpenness = openness;
          systemStateRef.current.isHappy = openness > CONFIG.mouthThreshold;
        }
      });

      faceMeshRef.current = faceMesh;
      return faceMesh;
    } catch (err) {
      console.error("FaceMesh Init Error:", err);
      throw new Error("Failed to initialize face tracking.");
    }
  };

  // --- Logic: Initialize Audio ---
  const initAudio = async () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      // 1. Microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micSource = ctx.createMediaStreamSource(stream);
      micSource.connect(analyser);

      // 2. Music
      const response = await fetch(CONFIG.musicUrl);
      if (!response.ok) {
        throw new Error(`Failed to download music: ${response.status} ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(buffer);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.loop = true;
      source.connect(ctx.destination); // Connect music to speakers
      
      source.start(0);
      musicSourceRef.current = source;

      return ctx;
    } catch (err) {
      console.error("Audio Init Error:", err);
      // Simplify error message for UI
      if (err instanceof Error) {
         throw err;
      }
      throw new Error("Failed to access microphone or load music.");
    }
  };

  // --- Logic: Audio Analysis Loop ---
  useEffect(() => {
    if (status !== AppStatus.RUNNING) return;

    const interval = setInterval(() => {
      if (!analyserRef.current || !audioContextRef.current) return;

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Calc Amplitude
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const amplitude = sum / (bufferLength * 255);

      // Calc Frequency Centroid
      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < bufferLength; i++) {
        numerator += i * dataArray[i];
        denominator += dataArray[i];
      }
      const centroid = denominator > 0 ? numerator / denominator : 0;
      const normalizedFreq = centroid / bufferLength;

      // Update Ref
      systemStateRef.current.soundAmplitude = amplitude;
      systemStateRef.current.soundFrequency = normalizedFreq;

      // Update Music Speed based on Emotion
      if (musicSourceRef.current) {
        const targetRate = systemStateRef.current.isHappy ? CONFIG.happyMusicRate : CONFIG.sadMusicRate;
        // Smooth transition
        const currentRate = musicSourceRef.current.playbackRate.value;
        musicSourceRef.current.playbackRate.value = currentRate + (targetRate - currentRate) * 0.05;
      }

    }, 50);

    return () => clearInterval(interval);
  }, [status]);

  // --- Logic: Start Sequence ---
  const handleStart = async () => {
    setStatus(AppStatus.LOADING);
    setError('');

    try {
      // 1. Init Audio (needs user gesture)
      await initAudio();

      // 2. Init FaceMesh
      const faceMesh = await initFaceMesh();

      // 3. Start Camera
      if (videoRef.current && faceMesh) {
        const CameraClass = (window as any).Camera || (window as any).mediapipe?.camera_utils?.Camera;
        
        if (!CameraClass) {
            throw new Error("Camera library not loaded.");
        }

        const camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current) {
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

  // --- Sync State for Overlay ---
  const [uiState, setUiState] = useState<SystemState>(systemStateRef.current);
  
  useEffect(() => {
    if (status !== AppStatus.RUNNING) return;
    const uiInterval = setInterval(() => {
        setUiState({ ...systemStateRef.current });
    }, 200);
    return () => clearInterval(uiInterval);
  }, [status]);


  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Video Feed (Visible) */}
      <video
        ref={videoRef}
        className={`absolute bottom-6 right-6 w-48 sm:w-64 aspect-video object-cover rounded-xl border-2 border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.6)] z-30 transition-all duration-700 ${
            status === AppStatus.RUNNING ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* 3D Visualizer Background */}
      <VisualizerCanvas systemStateRef={systemStateRef} />

      {/* UI Overlay */}
      <Overlay 
        status={status} 
        onStart={handleStart} 
        error={error}
        systemState={uiState}
      />
    </div>
  );
};

export default App;