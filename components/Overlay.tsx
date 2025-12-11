import React from 'react';
import { Activity, Mic, Smile, Frown, Volume2, Music, Loader2, Pause, Play, Meh } from 'lucide-react';
import { SystemState, AppStatus, Emotion } from '../types';

interface OverlayProps {
  status: AppStatus;
  systemState: SystemState;
  onStart: () => void;
  onTogglePause: () => void;
  error?: string;
}

const Overlay: React.FC<OverlayProps> = ({ status, systemState, onStart, onTogglePause, error }) => {
  const isRunning = status === AppStatus.RUNNING;
  const isPaused = status === AppStatus.PAUSED;

  if (status === AppStatus.IDLE || status === AppStatus.READY) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="max-w-md p-8 text-center border border-white/10 rounded-2xl bg-white/5 shadow-2xl">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-orange-400 to-blue-400 bg-clip-text text-transparent mb-4">
            MoodMelody 3D
          </h1>
          <p className="text-gray-300 mb-8">
            An interactive audiovisual experience powered by your expressions.
            <br />
            <span className="text-sm text-gray-500 mt-2 block">
              Please enable camera and microphone access.
            </span>
          </p>
          
          <button
            onClick={onStart}
            className="group relative px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-all active:scale-95 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400/20 to-blue-400/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="flex items-center gap-2">
              <Music className="w-5 h-5" />
              Start Experience
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (status === AppStatus.LOADING) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black text-white">
        <Loader2 className="w-12 h-12 animate-spin text-orange-400 mb-4" />
        <p className="text-lg font-light tracking-widest uppercase">Initializing Systems...</p>
        <p className="text-xs text-gray-500 mt-2">Loading FaceMesh & Audio Context</p>
      </div>
    );
  }

  if (status === AppStatus.ERROR) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black text-red-500">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">System Error</h2>
          <p>{error || 'An unexpected error occurred.'}</p>
          <button onClick={() => window.location.reload()} className="mt-4 underline">Reload</button>
        </div>
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm text-white">
        <h2 className="text-3xl font-bold tracking-widest mb-6">PAUSED</h2>
        <button 
          onClick={onTogglePause}
          className="p-6 bg-white/10 rounded-full hover:bg-white/20 hover:scale-110 transition-all border border-white/20 backdrop-blur-md"
        >
          <Play className="w-12 h-12 fill-current" />
        </button>
      </div>
    );
  }

  // Helper to render emotion icon/text
  const renderEmotionStatus = () => {
    switch(systemState.emotion) {
      case Emotion.HAPPY:
        return (
           <div className="text-xl font-mono font-bold flex items-center gap-2 text-orange-500 shadow-orange-500/50 drop-shadow-md">
             <Smile className="w-6 h-6" />
             <span>HAPPY</span>
           </div>
        );
      case Emotion.SAD:
        return (
           <div className="text-xl font-mono font-bold flex items-center gap-2 text-purple-500 shadow-purple-500/50 drop-shadow-md">
             <Frown className="w-6 h-6" />
             <span>ANXIOUS</span>
           </div>
        );
      case Emotion.CALM:
      default:
        return (
           <div className="text-xl font-mono font-bold flex items-center gap-2 text-cyan-400 shadow-cyan-400/50 drop-shadow-md">
             <Meh className="w-6 h-6" />
             <span>CALM</span>
           </div>
        );
    }
  };

  // Running State UI
  return (
    <div className="absolute inset-0 pointer-events-none z-40">
      {/* Top Bar Container */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start">
        
        {/* Left: Stats Panel */}
        <div className="bg-black/40 backdrop-blur-md p-4 rounded-xl border border-white/10 space-y-3 w-64 shadow-xl pointer-events-auto">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Real-time Analysis</span>
            <Activity className="w-4 h-4 text-green-400 animate-pulse" />
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1 text-sm text-gray-300">
                <span>Emotion</span>
              </div>
              {renderEmotionStatus()}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1 text-sm text-gray-300">
                <span className="text-xs uppercase">Mouth Openness</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-white transition-all duration-75 shadow-[0_0_10px_rgba(255,255,255,0.5)]" 
                  style={{ width: `${Math.min(systemState.mouthOpenness * 100, 100)}%` }}
                />
              </div>
              <div className="text-right text-xs font-mono text-gray-500 mt-1">{systemState.mouthOpenness.toFixed(2)}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1 mb-1 text-xs text-gray-400">
                   <Volume2 className="w-3 h-3" /> Amp
                </div>
                <div className="text-lg font-mono">{systemState.soundAmplitude.toFixed(2)}</div>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1 text-xs text-gray-400">
                   <Activity className="w-3 h-3" /> Freq
                </div>
                <div className="text-lg font-mono">{systemState.soundFrequency.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Controls & Info */}
        <div className="flex flex-col items-end gap-4 pointer-events-auto">
          
          {/* Pause Button */}
          <button 
            onClick={onTogglePause}
            className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md border border-white/10 transition-all active:scale-95 group"
            title="Pause Experience"
          >
            <Pause className="w-6 h-6 text-white group-hover:text-orange-400 transition-colors" />
          </button>

          {/* Controls Hint */}
          <div className="hidden md:block bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>Tracking Active</span>
              <span className="w-px h-3 bg-white/20 mx-1" />
              <Mic className="w-3 h-3" />
              <span>Audio Reactive</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Overlay;