import React from 'react';
import { Loader2, Pause, Play, Hand, Mic, Activity, Sun, CloudRain, Wind, Volume2, Smile, Move, Gamepad2 } from 'lucide-react';
import { SystemState, AppStatus, Emotion } from '../types';

interface OverlayProps {
  status: AppStatus;
  systemState: SystemState;
  onStart: () => void;
  onTogglePause: () => void;
  error?: string;
}

const Overlay: React.FC<OverlayProps> = ({ status, systemState, onStart, onTogglePause, error }) => {
  const isPaused = status === AppStatus.PAUSED;
  const isRunning = status === AppStatus.RUNNING;

  // --- Intro Screen ---
  if (status === AppStatus.IDLE || status === AppStatus.READY) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-stone-900/90 text-amber-50 font-serif">
        <div className="max-w-lg text-center p-8">
          <h1 className="text-6xl italic font-light tracking-wide mb-6 bg-gradient-to-br from-amber-100 to-amber-600 bg-clip-text text-transparent">
            心灵草甸
          </h1>
          <p className="text-stone-400 text-lg leading-relaxed mb-12 font-light">
            一个由你的存在塑造的数字避难所。<br/>
            <span className="text-amber-200">微笑</span> 唤来阳光，<span className="text-blue-300">皱眉</span> 召集风雨。<br/>
            <span className="text-amber-200">张开</span>手掌前进，<span className="text-red-300">握拳</span>后退。<br/>
            手偏离画面中心越远，飞行速度越快。
          </p>
          
          <button
            onClick={onStart}
            className="group px-10 py-3 border border-amber-500/30 rounded-full hover:bg-amber-500/10 transition-all duration-500 ease-out backdrop-blur-md"
          >
            <span className="text-sm tracking-[0.2em] uppercase font-sans font-light group-hover:tracking-[0.3em] transition-all text-amber-100">
              进入草甸
            </span>
          </button>
          
          <div className="mt-8 flex items-center justify-center gap-6 text-xs text-stone-500 font-sans tracking-widest uppercase">
            <span className="flex items-center gap-1"><Hand className="w-3 h-3"/> 张开前进 / 握拳后退</span>
            <span className="flex items-center gap-1"><Smile className="w-3 h-3"/> 面部表情</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Loading ---
  if (status === AppStatus.LOADING) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-stone-900 text-amber-50 font-serif">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600 mb-4 font-thin" />
        <p className="text-sm tracking-[0.2em] uppercase text-stone-500">正在播种...</p>
      </div>
    );
  }

  // --- Error ---
  if (status === AppStatus.ERROR) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-stone-900 text-white font-serif">
        <div className="text-center">
          <p className="text-red-400 italic mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="border-b border-white/30 text-sm">重新加载</button>
        </div>
      </div>
    );
  }

  // --- Paused ---
  if (isPaused) {
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm text-white">
        <button 
          onClick={onTogglePause}
          className="p-8 rounded-full border border-white/10 hover:border-white/40 transition-all duration-500 group"
        >
          <Play className="w-8 h-8 fill-white/80 text-transparent group-hover:scale-110 transition-transform" />
        </button>
      </div>
    );
  }

  // --- Active Art Status Helper ---
  const getEmotionText = () => {
    switch(systemState.emotion) {
      case Emotion.HAPPY: return "生长 (夏)";
      case Emotion.SAD: return "风暴 (冬)";
      case Emotion.CALM: default: return "宁静 (秋)";
    }
  };

  const renderEmotionIcon = () => {
    switch(systemState.emotion) {
      case Emotion.HAPPY:
        return (
           <div className="text-lg font-serif italic flex items-center gap-2 text-green-300 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]">
             <Sun className="w-5 h-5" />
             <span>生机勃勃</span>
           </div>
        );
      case Emotion.SAD:
        return (
           <div className="text-lg font-serif italic flex items-center gap-2 text-blue-300 drop-shadow-[0_0_10px_rgba(147,197,253,0.5)]">
             <CloudRain className="w-5 h-5" />
             <span>风雨交加</span>
           </div>
        );
      case Emotion.CALM:
      default:
        return (
           <div className="text-lg font-serif italic flex items-center gap-2 text-amber-300 drop-shadow-[0_0_10px_rgba(252,211,77,0.5)]">
             <Wind className="w-5 h-5" />
             <span>平静祥和</span>
           </div>
        );
    }
  };

  return (
    <div className="absolute inset-0 pointer-events-none z-40 font-serif">
      {/* Top Left: Stats Panel */}
      {isRunning && (
        <div className="absolute top-6 left-6 pointer-events-auto">
          <div className="bg-stone-900/30 backdrop-blur-md p-5 rounded-lg border border-amber-500/10 space-y-4 w-60 shadow-2xl transition-all hover:bg-stone-900/50">
            <div className="flex items-center justify-between border-b border-amber-500/10 pb-2">
              <span className="text-[10px] font-sans font-bold uppercase tracking-[0.2em] text-stone-400">环境参数</span>
              <Activity className="w-3 h-3 text-amber-500/50 animate-pulse" />
            </div>

            <div className="space-y-4">
              {/* Emotion / Weather */}
              <div>
                <div className="flex items-center gap-2 mb-1 text-[10px] uppercase tracking-wider text-stone-500 font-sans">
                  <span>季节 (面部)</span>
                </div>
                {renderEmotionIcon()}
                <div className="text-[9px] text-stone-600 mt-1 font-mono">
                  曲率: {systemState.mouthCurvature.toFixed(3)}
                </div>
              </div>
              
              {/* Hand State */}
              <div>
                 <div className="flex items-center gap-2 mb-1 text-[10px] uppercase tracking-wider text-stone-500 font-sans">
                  <span>物理 (手势)</span>
                </div>
                <div className="text-amber-100 text-sm flex items-center gap-2">
                    <Hand className="w-4 h-4 text-amber-500" />
                    <span>{systemState.isFist ? "后退 / 握拳" : "前进 / 张开"}</span>
                </div>
                <div className="text-[9px] text-stone-500 mt-1 font-sans">
                   偏移: X:{systemState.handPosition.x.toFixed(2)} Y:{systemState.handPosition.y.toFixed(2)}
                </div>
              </div>

              {/* Wind Strength */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 text-[10px] uppercase tracking-wider text-stone-500 font-sans">
                  <span>音频强度</span>
                  <span className="font-mono text-amber-100/70">{systemState.soundAmplitude.toFixed(2)}</span>
                </div>
                <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-amber-200/80 transition-all duration-100 shadow-[0_0_10px_rgba(255,255,255,0.3)]" 
                    style={{ width: `${Math.min(systemState.soundAmplitude * 200, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Center Title/Status */}
      <div className="absolute bottom-10 left-0 w-full text-center">
        <div className="inline-block px-6 py-2">
          <span className="block text-2xl italic font-light text-amber-50/80 drop-shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all duration-1000">
            {getEmotionText()}
          </span>
        </div>
      </div>

      {/* Top Right Pause */}
      <div className="absolute top-6 right-6 pointer-events-auto">
        <button 
          onClick={onTogglePause}
          className="p-3 text-amber-100/30 hover:text-amber-100 transition-colors"
        >
          <Pause className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

export default Overlay;