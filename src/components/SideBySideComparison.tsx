import React, { useState, useRef, useEffect } from 'react';
import { VoiceCandidate } from '../types';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import {
  GitCompare,
  ArrowRightLeft,
  Play,
  Pause,
  Download,
  Star,
  Cpu,
  Sliders,
  Check,
  RotateCcw,
  Volume2,
} from 'lucide-react';

interface SideBySideComparisonProps {
  candidates: VoiceCandidate[];
  candidateAId: string;
  candidateBId: string;
  onSelectCandidateA: (id: string) => void;
  onSelectCandidateB: (id: string) => void;
  selectedFavoriteId: string;
  onSelectFavorite: (candidate: VoiceCandidate) => void;
  onClose: () => void;
}

export const SideBySideComparison: React.FC<SideBySideComparisonProps> = ({
  candidates,
  candidateAId,
  candidateBId,
  onSelectCandidateA,
  onSelectCandidateB,
  selectedFavoriteId,
  onSelectFavorite,
  onClose,
}) => {
  const candidateA = candidates.find((c) => c.id === candidateAId) || candidates[0];
  const candidateB = candidates.find((c) => c.id === candidateBId) || candidates[1];

  // Hot-swap A/B player state
  const [activeChannel, setActiveChannel] = useState<'A' | 'B'>('A');
  const [isAbPlaying, setIsAbPlaying] = useState<boolean>(false);
  const [abCurrentTime, setAbCurrentTime] = useState<number>(0);
  const [abDuration, setAbDuration] = useState<number>(0);

  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);

  // Synchronized Hot-swap playback handler
  const handleToggleAbPlay = () => {
    const activeAudio = activeChannel === 'A' ? audioARef.current : audioBRef.current;
    if (!activeAudio) return;

    if (isAbPlaying) {
      audioARef.current?.pause();
      audioBRef.current?.pause();
      setIsAbPlaying(false);
    } else {
      activeAudio.currentTime = abCurrentTime;
      activeAudio.play().then(() => {
        setIsAbPlaying(true);
      }).catch(console.error);
    }
  };

  const handleSwitchChannel = (newChannel: 'A' | 'B') => {
    if (newChannel === activeChannel) return;
    const currentAudio = activeChannel === 'A' ? audioARef.current : audioBRef.current;
    const targetAudio = newChannel === 'A' ? audioARef.current : audioBRef.current;
    const currentSec = currentAudio?.currentTime || abCurrentTime;

    if (targetAudio) {
      targetAudio.currentTime = currentSec;
      if (isAbPlaying) {
        currentAudio?.pause();
        targetAudio.play().catch(console.error);
      }
    }
    setActiveChannel(newChannel);
  };

  const handleAbReplay = () => {
    if (audioARef.current) audioARef.current.currentTime = 0;
    if (audioBRef.current) audioBRef.current.currentTime = 0;
    setAbCurrentTime(0);
    const activeAudio = activeChannel === 'A' ? audioARef.current : audioBRef.current;
    activeAudio?.play().then(() => setIsAbPlaying(true));
  };

  // Keep time updated
  useEffect(() => {
    const handleTimeA = () => {
      if (activeChannel === 'A' && audioARef.current) {
        setAbCurrentTime(audioARef.current.currentTime);
        if (audioARef.current.duration) setAbDuration(audioARef.current.duration);
      }
    };
    const handleTimeB = () => {
      if (activeChannel === 'B' && audioBRef.current) {
        setAbCurrentTime(audioBRef.current.currentTime);
        if (audioBRef.current.duration) setAbDuration(audioBRef.current.duration);
      }
    };

    const elA = audioARef.current;
    const elB = audioBRef.current;
    elA?.addEventListener('timeupdate', handleTimeA);
    elB?.addEventListener('timeupdate', handleTimeB);

    return () => {
      elA?.removeEventListener('timeupdate', handleTimeA);
      elB?.removeEventListener('timeupdate', handleTimeB);
    };
  }, [activeChannel]);

  const hasAudioA = Boolean(candidateA?.audioBase64);
  const hasAudioB = Boolean(candidateB?.audioBase64);

  return (
    <div className="rounded-2xl bg-gradient-to-b from-[#13131c] via-[#0d0d12] to-[#08080a] border border-amber-500/30 p-5 sm:p-7 shadow-2xl space-y-6">
      {/* Hidden audio elements for synchronized hot-swap */}
      {hasAudioA && (
        <audio
          ref={audioARef}
          src={candidateA.audioUrl || (candidateA.audioBase64 ? `data:audio/wav;base64,${candidateA.audioBase64}` : undefined)}
          onEnded={() => setIsAbPlaying(false)}
        />
      )}
      {hasAudioB && (
        <audio
          ref={audioBRef}
          src={candidateB.audioUrl || (candidateB.audioBase64 ? `data:audio/wav;base64,${candidateB.audioBase64}` : undefined)}
          onEnded={() => setIsAbPlaying(false)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <GitCompare className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold font-cinzel text-white flex items-center gap-2">
              <span>A / B Voice Master Rack</span>
              <span className="text-xs font-mono font-normal text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                השוואת ביצועים ראש-בראש
              </span>
            </h2>
            <p className="text-xs text-stone-400">
              החלף בלייב בין שני הקולות באותה שנייה בדיוק כדי לשמוע את ההבדל הדק בניואנסים ובעוקצנות
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="self-end sm:self-auto px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-white text-xs border border-stone-800"
        >
          סגור השוואה
        </button>
      </div>

      {/* Hot-Swap Master Audio Switcher */}
      {hasAudioA && hasAudioB && (
        <div className="rounded-xl bg-stone-950 p-4 border border-amber-500/20 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleAbPlay}
              className="w-12 h-12 rounded-full bg-gradient-to-r from-amber-500 to-amber-300 text-stone-950 flex items-center justify-center font-bold hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
              aria-label={isAbPlaying ? 'Pause comparison' : 'Play comparison'}
            >
              {isAbPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button
              onClick={handleAbReplay}
              title="התחל מחדש מתחילת המבחן"
              className="p-2 rounded-lg text-stone-400 hover:text-amber-300 hover:bg-stone-900"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <div className="space-y-0.5">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>ערוץ פעיל:</span>
                <span className="font-mono text-amber-400 font-bold">
                  {activeChannel === 'A' ? `[A] ${candidateA.name}` : `[B] ${candidateB.name}`}
                </span>
              </div>
              <div className="text-[11px] font-mono text-stone-400">
                {abCurrentTime.toFixed(1)}s / {abDuration.toFixed(1)}s
              </div>
            </div>
          </div>

          {/* Seamless Channel Toggle Buttons */}
          <div className="flex items-center gap-2 bg-stone-900/90 p-1.5 rounded-xl border border-stone-800">
            <button
              onClick={() => handleSwitchChannel('A')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeChannel === 'A'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 shadow-md'
                  : 'text-stone-400 hover:text-white hover:bg-stone-800'
              }`}
            >
              <span>קול א': {candidateA.hebrewName}</span>
              {activeChannel === 'A' && isAbPlaying && (
                <span className="w-2 h-2 rounded-full bg-stone-950 animate-ping" />
              )}
            </button>

            <div className="p-1 text-stone-400">
              <ArrowRightLeft className="w-4 h-4" />
            </div>

            <button
              onClick={() => handleSwitchChannel('B')}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeChannel === 'B'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 shadow-md'
                  : 'text-stone-400 hover:text-white hover:bg-stone-800'
              }`}
            >
              <span>קול ב': {candidateB.hebrewName}</span>
              {activeChannel === 'B' && isAbPlaying && (
                <span className="w-2 h-2 rounded-full bg-stone-950 animate-ping" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Side-by-Side Dual Column Compare */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Candidate A Column */}
        <div className="rounded-xl bg-[#111116] border border-stone-800 p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-amber-400 tracking-wider font-bold">
                CHANNEL A • קול א'
              </span>
              <button
                onClick={() => onSelectFavorite(candidateA)}
                className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 font-semibold ${
                  selectedFavoriteId === candidateA.id
                    ? 'bg-amber-400 text-stone-950 font-bold'
                    : 'bg-stone-900 text-stone-400 hover:text-amber-300 border border-stone-800'
                }`}
              >
                <Star className="w-3 h-3 fill-current" />
                <span>{selectedFavoriteId === candidateA.id ? 'נבחר כמוביל' : 'בחר כמוביל'}</span>
              </button>
            </div>

            <select
              value={candidateA.id}
              onChange={(e) => onSelectCandidateA(e.target.value)}
              className="w-full bg-stone-900 text-white font-bold p-2.5 rounded-lg border border-stone-700 text-sm focus:outline-none focus:border-amber-400"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.hebrewName} (Base: {c.baseVoice})
                </option>
              ))}
            </select>
          </div>

          {/* Acoustic Profile */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-stone-950/80 border border-stone-800">
              <span className="text-stone-400 text-[10px] block">Base Gemini Voice:</span>
              <span className="font-bold text-amber-300 font-mono text-sm">{candidateA.baseVoice}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-950/80 border border-stone-800">
              <span className="text-stone-400 text-[10px] block">גיל והגשה:</span>
              <span className="font-bold text-stone-200">{candidateA.ageRange}</span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-stone-950/60 border border-stone-800/80 space-y-1 text-xs">
            <span className="text-[10px] text-stone-400 font-mono block">אישיות:</span>
            <p className="text-stone-300 leading-relaxed italic">"{candidateA.personality}"</p>
          </div>

          <div className="p-3 rounded-lg bg-stone-950/60 border border-stone-800/80 space-y-1 text-xs">
            <span className="text-[10px] text-amber-400 font-mono block">הוראת סגנון (Speech Style):</span>
            <p className="text-stone-300 text-[11px] leading-relaxed font-mono">
              {candidateA.deliveryStylePrompt}
            </p>
          </div>

          {/* Audio Player */}
          {hasAudioA ? (
            <AudioWaveformPlayer
              audioBase64={candidateA.audioBase64!}
              candidateName={candidateA.name}
              hebrewName={candidateA.hebrewName}
            />
          ) : (
            <div className="p-4 rounded-xl bg-stone-950 border border-dashed border-stone-800 text-center text-xs text-stone-400">
              האודיו לקול זה טרם הופק. הפק אותו במסך הראשי תחילה.
            </div>
          )}
        </div>

        {/* Candidate B Column */}
        <div className="rounded-xl bg-[#111116] border border-stone-800 p-5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-amber-400 tracking-wider font-bold">
                CHANNEL B • קול ב'
              </span>
              <button
                onClick={() => onSelectFavorite(candidateB)}
                className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 font-semibold ${
                  selectedFavoriteId === candidateB.id
                    ? 'bg-amber-400 text-stone-950 font-bold'
                    : 'bg-stone-900 text-stone-400 hover:text-amber-300 border border-stone-800'
                }`}
              >
                <Star className="w-3 h-3 fill-current" />
                <span>{selectedFavoriteId === candidateB.id ? 'נבחר כמוביל' : 'בחר כמוביל'}</span>
              </button>
            </div>

            <select
              value={candidateB.id}
              onChange={(e) => onSelectCandidateB(e.target.value)}
              className="w-full bg-stone-900 text-white font-bold p-2.5 rounded-lg border border-stone-700 text-sm focus:outline-none focus:border-amber-400"
            >
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.hebrewName} (Base: {c.baseVoice})
                </option>
              ))}
            </select>
          </div>

          {/* Acoustic Profile */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-lg bg-stone-950/80 border border-stone-800">
              <span className="text-stone-400 text-[10px] block">Base Gemini Voice:</span>
              <span className="font-bold text-amber-300 font-mono text-sm">{candidateB.baseVoice}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-950/80 border border-stone-800">
              <span className="text-stone-400 text-[10px] block">גיל והגשה:</span>
              <span className="font-bold text-stone-200">{candidateB.ageRange}</span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-stone-950/60 border border-stone-800/80 space-y-1 text-xs">
            <span className="text-[10px] text-stone-400 font-mono block">אישיות:</span>
            <p className="text-stone-300 leading-relaxed italic">"{candidateB.personality}"</p>
          </div>

          <div className="p-3 rounded-lg bg-stone-950/60 border border-stone-800/80 space-y-1 text-xs">
            <span className="text-[10px] text-amber-400 font-mono block">הוראת סגנון (Speech Style):</span>
            <p className="text-stone-300 text-[11px] leading-relaxed font-mono">
              {candidateB.deliveryStylePrompt}
            </p>
          </div>

          {/* Audio Player */}
          {hasAudioB ? (
            <AudioWaveformPlayer
              audioBase64={candidateB.audioBase64!}
              candidateName={candidateB.name}
              hebrewName={candidateB.hebrewName}
            />
          ) : (
            <div className="p-4 rounded-xl bg-stone-950 border border-dashed border-stone-800 text-center text-xs text-stone-400">
              האודיו לקול זה טרם הופק. הפק אותו במסך הראשי תחילה.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
