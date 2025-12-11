import React, { useState, useEffect, useRef } from 'react';
import Overlay from './components/Overlay';
import VisualizerCanvas from './components/VisualizerCanvas';
import { AppStatus, SystemState, Emotion } from './types';
import { CONFIG } from './constants';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string>('');
  
  // Refs for mutable data to avoid re-renders in the loop
  const systemStateRef = useRef<SystemState>({
    emotion: Emotion.CALM,
    mouthOpenness: 0,
    soundAmplitude: 0,
    soundFrequency: 0,
  });

  // Track status in a ref for access inside camera callbacks
  const statusRef = useRef<AppStatus>(AppStatus.IDLE);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const faceMeshRef = useRef<any>(null); 
  const cameraRef = useRef<any>(null);

  // --- Advanced Face Detection State Refs ---
  const smoothMouthRef = useRef(0);
  const smoothCurvatureRef = useRef(0); // Track mouth curvature
  const emotionTimerRef = useRef(0);
  const stableEmotionRef = useRef<Emotion>(Emotion.CALM);

  // --- Logic: Initialize FaceMesh ---
  const initFaceMesh = async () => {
    try {
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
          
          // Indices: 
          // 61: Left Corner
          // 291: Right Corner
          // 13: Upper Lip Inner
          // 14: Lower Lip Inner
          const left = landmarks[61];
          const right = landmarks[291];
          const top = landmarks[13];
          const bottom = landmarks[14];

          // 1. Calculate Basic Geometry
          const mouthW = Math.hypot(right.x - left.x, right.y - left.y);
          const mouthH = Math.hypot(bottom.x - top.x, bottom.y - top.y);
          const rawRatio = mouthW > 0 ? mouthH / mouthW : 0;

          // 2. Emotion Detection based on Corners (Curvature)
          // Y increases downwards in screen coordinates.
          // Center Y of the mouth
          const centerY = (top.y + bottom.y) / 2;
          // Average Y of corners
          const cornersY = (left.y + right.y) / 2;
          
          // Calculate curvature relative to width (normalization)
          // Positive val: Corners are LOWER than center (Frown/Sad)
          // Negative val: Corners are HIGHER than center (Smile/Happy)
          const rawCurvature = (cornersY - centerY) / (mouthW * 0.5 || 1); // Normalize

          // 3. Smooth Filtering
          const smoothFactor = 0.15;
          smoothMouthRef.current += (rawRatio - smoothMouthRef.current) * smoothFactor;
          smoothCurvatureRef.current += (rawCurvature - smoothCurvatureRef.current) * smoothFactor;
          
          const smoothedOpenness = smoothMouthRef.current;
          const curvature = smoothCurvatureRef.current;

          // 4. Determine Emotion Candidate
          // Thresholds tuned for "slight downward = calm", "downward = sad", "upward = happy"
          let currentEmotion = Emotion.CALM;

          // Thresholds:
          // <-0.02: Happy (Corners clearly up)
          // -0.02 to 0.05: Calm (Neutral or slight down)
          // > 0.05: Sad/Anxious (Corners clearly down)
          
          if (curvature < -0.02) {
            currentEmotion = Emotion.HAPPY;
          } else if (curvature > 0.05) {
            currentEmotion = Emotion.SAD;
          } else {
            currentEmotion = Emotion.CALM;
          }

          // 5. Emotion Debounce
          if (currentEmotion !== stableEmotionRef.current) {
            emotionTimerRef.current++;
            if (emotionTimerRef.current > 5) { // Confirm change after 5 frames
              stableEmotionRef.current = currentEmotion;
              emotionTimerRef.current = 0;
            }
          } else {
            emotionTimerRef.current = 0;
          }

          // Update System State
          systemStateRef.current.mouthOpenness = Math.min(Math.max(smoothedOpenness, 0), 1);
          systemStateRef.current.emotion = stableEmotionRef.current;
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
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(analyser);
      } catch (e) {
        console.warn("Microphone access failed:", e);
      }

      // 2. Music
      const audioElem = new Audio();
      audioElem.src = CONFIG.musicUrl;
      audioElem.loop = true;
      audioElem.crossOrigin = "anonymous";
      
      const musicSource = ctx.createMediaElementSource(audioElem);
      musicSource.connect(analyser);
      musicSource.connect(ctx.destination);
      
      await audioElem.play();
      audioElementRef.current = audioElem;

      return ctx;
    } catch (err) {
      console.error("Audio Init Error:", err);
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

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const amplitude = sum / (bufferLength * 255);

      let numerator = 0;
      let denominator = 0;
      for (let i = 0; i < bufferLength; i++) {
        numerator += i * dataArray[i];
        denominator += dataArray[i];
      }
      const centroid = denominator > 0 ? numerator / denominator : 0;
      const normalizedFreq = centroid / bufferLength;

      systemStateRef.current.soundAmplitude = amplitude;
      systemStateRef.current.soundFrequency = normalizedFreq;

      // Update Music Speed based on Emotion
      if (audioElementRef.current) {
        const emotion = systemStateRef.current.emotion;
        let targetRate = 1.0;
        
        if (emotion === Emotion.HAPPY) targetRate = CONFIG.happyMusicRate;
        else if (emotion === Emotion.SAD) targetRate = CONFIG.sadMusicRate;
        else targetRate = 1.0; // Calm

        const currentRate = audioElementRef.current.playbackRate;
        audioElementRef.current.playbackRate = currentRate + (targetRate - currentRate) * 0.05;
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
      const faceMesh = await initFaceMesh();

      if (videoRef.current && faceMesh) {
        const CameraClass = (window as any).Camera || (window as any).mediapipe?.camera_utils?.Camera;
        
        if (!CameraClass) {
            throw new Error("Camera library not loaded.");
        }

        const camera = new CameraClass(videoRef.current, {
          onFrame: async () => {
            if (statusRef.current !== AppStatus.RUNNING) return;
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

  // --- Logic: Toggle Pause ---
  const togglePause = async () => {
    if (status === AppStatus.RUNNING) {
      if (audioContextRef.current && audioContextRef.current.state === 'running') {
        await audioContextRef.current.suspend();
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
      }
      setStatus(AppStatus.PAUSED);
    } else if (status === AppStatus.PAUSED) {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      if (audioElementRef.current) {
        await audioElementRef.current.play();
      }
      setStatus(AppStatus.RUNNING);
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
      {/* Video Feed */}
      <video
        ref={videoRef}
        className={`absolute bottom-6 right-6 w-48 sm:w-64 aspect-video object-cover rounded-xl border-2 border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.6)] z-30 transition-all duration-700 ${
            status === AppStatus.RUNNING || status === AppStatus.PAUSED ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
        }`}
        playsInline
        muted
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Visualizer */}
      <VisualizerCanvas 
        systemStateRef={systemStateRef} 
        isPaused={status === AppStatus.PAUSED}
      />

      {/* Overlay */}
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