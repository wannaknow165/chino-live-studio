import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, Download, Volume2, VolumeX, Sparkles } from 'lucide-react';
import { formatTime } from '../utils/audioUtils';

interface AudioWaveformPlayerProps {
  audioBase64: string;
  candidateName: string;
  hebrewName: string;
  accentColor?: string;
  isPlayingExternal?: boolean;
  onPlayStateChange?: (isPlaying: boolean) => void;
  syncCurrentTime?: number;
}

export const AudioWaveformPlayer: React.FC<AudioWaveformPlayerProps> = ({
  audioBase64,
  candidateName,
  hebrewName,
  accentColor = 'amber',
  isPlayingExternal,
  onPlayStateChange,
  syncCurrentTime,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);

  // Generate Blob URL from base64
  useEffect(() => {
    if (!audioBase64) return;
    try {
      const binaryString = atob(audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (e) {
      console.error('Failed to parse audio base64:', e);
    }
  }, [audioBase64]);

  // Synchronize with external time if provided
  useEffect(() => {
    if (syncCurrentTime !== undefined && audioRef.current) {
      if (Math.abs(audioRef.current.currentTime - syncCurrentTime) > 0.5) {
        audioRef.current.currentTime = syncCurrentTime;
        setCurrentTime(syncCurrentTime);
      }
    }
  }, [syncCurrentTime]);

  // External play state
  useEffect(() => {
    if (isPlayingExternal !== undefined && audioRef.current) {
      if (isPlayingExternal && audioRef.current.paused) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else if (!isPlayingExternal && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [isPlayingExternal]);

  // Handle Play/Pause
  const togglePlay = () => {
    if (!audioRef.current) return;

    // Initialize AudioContext on first user gesture
    if (!audioContextRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        sourceNodeRef.current = source;
      } catch (err) {
        // Fallback gracefully without Web Audio visualizer
        console.warn('Web Audio API not supported or already connected', err);
      }
    } else if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
        onPlayStateChange?.(true);
      }).catch((e) => {
        console.error('Playback error:', e);
      });
    }
  };

  const handleReplay = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
      setIsPlaying(true);
      onPlayStateChange?.(true);
    });
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 0.8;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const downloadWav = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    const sanitized = candidateName.toLowerCase().replace(/\s+/g, '-');
    a.download = `the-voice-${sanitized}-hebrew.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Canvas Waveform Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let bars = 36;
    const bufferLength = analyserRef.current?.frequencyBinCount || 32;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyserRef.current && isPlaying) {
        analyserRef.current.getByteFrequencyData(dataArray);
      }

      const barWidth = canvas.width / bars - 2;
      for (let i = 0; i < bars; i++) {
        let barHeight = 4;
        if (isPlaying && analyserRef.current) {
          const sample = dataArray[i % bufferLength] || 0;
          barHeight = Math.max(4, (sample / 255) * (canvas.height - 6));
        } else {
          // Static simulated luxury sound wave curve
          const progress = duration > 0 ? currentTime / duration : 0;
          const isPassed = i / bars <= progress;
          const waveHeight = Math.sin((i / bars) * Math.PI) * (canvas.height * 0.45);
          barHeight = Math.max(4, waveHeight * (isPassed ? 1 : 0.6));
        }

        const x = i * (barWidth + 2);
        const y = (canvas.height - barHeight) / 2;

        const progress = duration > 0 ? currentTime / duration : 0;
        const isPassed = i / bars <= progress;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isPassed || isPlaying) {
          gradient.addColorStop(0, '#fef08a');
          gradient.addColorStop(0.5, '#d4af37');
          gradient.addColorStop(1, '#997d26');
        } else {
          gradient.addColorStop(0, '#475569');
          gradient.addColorStop(1, '#1e293b');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, duration, currentTime]);

  return (
    <div className="rounded-xl bg-black/60 border border-amber-500/20 p-4 space-y-3 backdrop-blur-md">
      <audio
        ref={audioRef}
        src={blobUrl || undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onEnded={() => {
          setIsPlaying(false);
          onPlayStateChange?.(false);
        }}
      />

      {/* Visualizer Waveform Canvas */}
      <div className="relative w-full h-12 bg-stone-950/80 rounded-lg p-1.5 flex items-center border border-stone-800">
        <canvas
          ref={canvasRef}
          width={400}
          height={40}
          className="w-full h-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickPos = (e.clientX - rect.left) / rect.width;
            if (audioRef.current && duration > 0) {
              const newTime = clickPos * duration;
              audioRef.current.currentTime = newTime;
              setCurrentTime(newTime);
            }
          }}
        />
        {isPlaying && (
          <div className="absolute right-2 top-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            24kHz Master
          </div>
        )}
      </div>

      {/* Time Scrubber */}
      <div className="flex items-center gap-2 text-xs font-mono text-stone-400">
        <span className="w-10 text-right">{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 100}
          step="0.05"
          value={currentTime}
          onChange={handleSeek}
          aria-label={`Scrub audio for ${candidateName}`}
          className="flex-1 h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
        />
        <span className="w-10 text-left">{formatTime(duration)}</span>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-800/60">
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            aria-label={isPlaying ? `Pause ${candidateName}` : `Play ${candidateName}`}
            className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-tr from-amber-600 via-amber-500 to-amber-300 text-stone-950 hover:brightness-110 active:scale-95 transition-all shadow-md shadow-amber-500/20"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
          </button>

          {/* Replay */}
          <button
            onClick={handleReplay}
            aria-label={`Replay ${candidateName}`}
            title="הפעל מחדש מתחילת הטקסט"
            className="p-2 rounded-lg text-stone-400 hover:text-amber-300 hover:bg-stone-800/60 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Speed Selectors */}
          <div className="flex items-center bg-stone-900/90 rounded-lg p-0.5 border border-stone-800 text-[11px] font-mono">
            {[0.9, 1.0, 1.15].map((rate) => (
              <button
                key={rate}
                onClick={() => handleRateChange(rate)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  playbackRate === rate
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Volume & Download */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 bg-stone-900/80 px-2 py-1 rounded-lg border border-stone-800">
            <button
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="text-stone-400 hover:text-stone-200"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              aria-label="Volume slider"
              className="w-14 h-1 bg-stone-800 rounded appearance-none cursor-pointer accent-amber-400"
            />
          </div>

          <button
            onClick={downloadWav}
            aria-label={`Download WAV for ${candidateName}`}
            title="הורדת קובץ WAV באיכות מאסטר (24kHz)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-200 hover:text-amber-300 text-xs font-medium border border-stone-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>WAV</span>
          </button>
        </div>
      </div>
    </div>
  );
};
