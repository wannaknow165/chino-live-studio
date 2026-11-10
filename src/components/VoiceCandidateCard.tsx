import React, { useState } from 'react';
import { VoiceCandidate } from '../types';
import { AudioWaveformPlayer } from './AudioWaveformPlayer';
import { AVAILABLE_BASE_VOICES } from '../utils/audioUtils';
import {
  Mic,
  Star,
  Sparkles,
  Sliders,
  Check,
  AlertCircle,
  Layers,
  ChevronDown,
  ChevronUp,
  Cpu,
  RefreshCw,
  GitCompare,
} from 'lucide-react';

interface VoiceCandidateCardProps {
  candidate: VoiceCandidate;
  isSelectedFavorite: boolean;
  onSelectFavorite: (candidate: VoiceCandidate) => void;
  onGenerateAudio: (candidateId: string) => Promise<void>;
  onUpdateStylePrompt: (candidateId: string, newPrompt: string) => void;
  onUpdateBaseVoice: (candidateId: string, newVoice: string) => void;
  onAddToComparison: (candidate: VoiceCandidate) => void;
  isInComparison: boolean;
  script: string;
}

export const VoiceCandidateCard: React.FC<VoiceCandidateCardProps> = ({
  candidate,
  isSelectedFavorite,
  onSelectFavorite,
  onGenerateAudio,
  onUpdateStylePrompt,
  onUpdateBaseVoice,
  onAddToComparison,
  isInComparison,
  script,
}) => {
  const [isPromptExpanded, setIsPromptExpanded] = useState<boolean>(false);
  const [editedPrompt, setEditedPrompt] = useState<string>(candidate.deliveryStylePrompt);
  const [hasPromptChanged, setHasPromptChanged] = useState<boolean>(false);
  const [elapsedTimer, setElapsedTimer] = useState<number>(0);

  // Timer while generating
  React.useEffect(() => {
    let interval: any;
    if (candidate.status === 'generating') {
      setElapsedTimer(0);
      interval = setInterval(() => {
        setElapsedTimer((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [candidate.status]);

  const handlePromptSave = () => {
    onUpdateStylePrompt(candidate.id, editedPrompt);
    setHasPromptChanged(false);
  };

  const handlePromptReset = () => {
    setEditedPrompt(candidate.deliveryStylePrompt);
    setHasPromptChanged(false);
  };

  return (
    <div
      className={`relative rounded-2xl transition-all duration-300 flex flex-col justify-between overflow-hidden ${
        isSelectedFavorite
          ? 'bg-gradient-to-b from-[#181824] via-[#121218] to-[#0a0a0e] ring-2 ring-amber-400 shadow-2xl shadow-amber-500/15'
          : 'bg-[#101015] border border-stone-800/80 hover:border-amber-500/30 shadow-lg'
      }`}
    >
      {/* Top Banner Accent */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${candidate.avatarColor}`} />

      {/* Main Card Content */}
      <div className="p-5 sm:p-6 space-y-5">
        {/* Header: Title, Archetype & Favorite Button */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-400 to-amber-500 text-stone-950 font-bold font-mono text-xs shadow-sm">
                אפשרות #{candidate.voiceNumber}
              </span>
              <span className="text-xl font-bold font-cinzel tracking-wide text-white">
                {candidate.name}
              </span>
            </div>
            <div className="text-base font-bold font-hebrew text-amber-300">
              {candidate.hebrewName}
            </div>
            <p className="text-xs text-stone-300 line-clamp-1">
              {candidate.archetype}
            </p>
          </div>

          {/* Favorite / Lock Master Voice Button */}
          <button
            onClick={() => onSelectFavorite(candidate)}
            aria-label={isSelectedFavorite ? `Deselect ${candidate.name}` : `Select ${candidate.name} as primary`}
            title={isSelectedFavorite ? 'נבחר וננעל כקול הקבוע לסדרה' : 'בחר ונעל כקול הקבוע לסדרה'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 cursor-pointer ${
              isSelectedFavorite
                ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-stone-950 shadow-md shadow-amber-500/30 font-bold ring-2 ring-amber-300'
                : 'bg-stone-900/90 text-stone-300 hover:text-amber-300 border border-stone-800 hover:border-amber-500/40'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${isSelectedFavorite ? 'fill-current text-stone-950' : 'text-amber-400'}`} />
            <span>{isSelectedFavorite ? 'הקול הנבחר הקבוע ✓' : 'בחר כקול קבוע'}</span>
          </button>
        </div>

        {/* Identity & Base Voice Architecture (Crucial prompt requirement: distinguishing base voice from style prompt) */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-stone-950/70 p-2.5 rounded-xl border border-stone-800/70 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-stone-400">
              <span className="flex items-center gap-1 font-mono">
                <Cpu className="w-3 h-3 text-amber-400" />
                Base Voice:
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded">
                Gemini Model
              </span>
            </div>
            <div className="flex items-center justify-between">
              <select
                value={candidate.baseVoice}
                onChange={(e) => onUpdateBaseVoice(candidate.id, e.target.value)}
                aria-label={`Base Voice for ${candidate.name}`}
                className="bg-transparent text-sm font-bold text-white focus:outline-none cursor-pointer hover:text-amber-300"
              >
                {AVAILABLE_BASE_VOICES.map((v) => (
                  <option key={v.id} value={v.id} className="bg-stone-900 text-stone-100">
                    {v.id} ({v.tone})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-stone-400">
              קול האב הבסיסי של המודל
            </p>
          </div>

          <div className="bg-stone-950/70 p-2.5 rounded-xl border border-stone-800/70 space-y-1">
            <div className="text-[11px] text-stone-400 flex items-center justify-between">
              <span>גיל והגשה:</span>
              <span className="font-mono text-stone-300">{candidate.ageRange}</span>
            </div>
            <div className="text-xs font-semibold text-stone-200 truncate">
              {candidate.vocalProfile.pitch}
            </div>
            <p className="text-[10px] text-stone-400 truncate">
              {candidate.vocalProfile.timbre}
            </p>
          </div>
        </div>

        {/* Personality & Hebrew Direction */}
        <div className="bg-stone-950/50 rounded-xl p-3 border border-stone-800/60 space-y-2">
          <div className="text-xs text-stone-300 italic leading-relaxed">
            "{candidate.personality}"
          </div>
          <div className="text-xs text-amber-200/90 font-hebrew bg-amber-500/5 px-2.5 py-1.5 rounded-lg border border-amber-500/10 flex items-start gap-1.5" dir="rtl">
            <span className="font-bold text-amber-400 shrink-0">הנחיית במאי:</span>
            <span>{candidate.hebrewDirectionGuide}</span>
          </div>
        </div>

        {/* Expandable Style Prompt Inspector */}
        <div className="border border-stone-800/80 rounded-xl overflow-hidden bg-stone-950/40">
          <button
            onClick={() => setIsPromptExpanded(!isPromptExpanded)}
            className="w-full flex items-center justify-between p-2.5 text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-900/40 transition-colors"
          >
            <span className="flex items-center gap-1.5 font-mono">
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              Gemini Delivery Style Prompt
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              {isPromptExpanded ? (
                <>
                  סגור <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  הצג וערוך פרומפט <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </button>

          {isPromptExpanded && (
            <div className="p-3 border-t border-stone-800 space-y-2 bg-stone-950">
              <p className="text-[11px] text-stone-400">
                זהו הפרומפט המדויק שנשלח ל-Gemini TTS תחת <code className="text-amber-300">speechMetadata.style</code>:
              </p>
              <textarea
                value={editedPrompt}
                onChange={(e) => {
                  setEditedPrompt(e.target.value);
                  setHasPromptChanged(e.target.value !== candidate.deliveryStylePrompt);
                }}
                rows={3}
                aria-label={`Delivery style prompt for ${candidate.name}`}
                className="w-full bg-stone-900 text-stone-200 text-xs p-2.5 rounded-lg border border-stone-700 focus:border-amber-400 focus:outline-none font-mono"
              />
              <div className="flex items-center justify-end gap-2 pt-1">
                {hasPromptChanged && (
                  <button
                    onClick={handlePromptReset}
                    className="px-2.5 py-1 text-xs text-stone-400 hover:text-white"
                  >
                    בטל שינויים
                  </button>
                )}
                <button
                  onClick={handlePromptSave}
                  disabled={!hasPromptChanged}
                  className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 ${
                    hasPromptChanged
                      ? 'bg-amber-400 text-stone-950 hover:bg-amber-300'
                      : 'bg-stone-800 text-stone-500 cursor-not-allowed'
                  }`}
                >
                  <Check className="w-3 h-3" />
                  שמור הנחיה
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Audio Player or Generation State */}
        <div className="pt-1">
          {candidate.status === 'generating' ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-5 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-amber-300">
                <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                <span className="font-semibold text-sm">יוצר ביצוע קולי אותנטי עם Gemini TTS...</span>
              </div>
              <p className="text-xs text-amber-200/70 font-mono">
                מעבד קול בעברית • {elapsedTimer} שניות חלפו
              </p>
              <div className="w-full bg-stone-900 h-1.5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-600 to-amber-300 w-2/3 animate-pulse" />
              </div>
            </div>
          ) : candidate.status === 'error' ? (
            <div className="rounded-xl bg-red-950/40 border border-red-500/30 p-4 space-y-2 text-red-200 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-red-400">
                <AlertCircle className="w-4 h-4" />
                <span>שגיאה בהפקת האודיו</span>
              </div>
              <p className="text-red-300/80">{candidate.errorMessage || 'ארעה תקלה בעת הפנייה למודל Gemini.'}</p>
              <button
                onClick={() => onGenerateAudio(candidate.id)}
                className="mt-2 px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 font-semibold transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                נסה שוב
              </button>
            </div>
          ) : candidate.audioBase64 ? (
            <div className="space-y-2">
              <AudioWaveformPlayer
                audioBase64={candidate.audioBase64}
                candidateName={candidate.name}
                hebrewName={candidate.hebrewName}
              />
              <div className="flex items-center justify-between px-1 text-[11px] text-stone-400">
                <span>
                  הוקלט ב: {candidate.generatedAt ? new Date(candidate.generatedAt).toLocaleTimeString() : 'עכשיו'}
                </span>
                <button
                  onClick={() => onGenerateAudio(candidate.id)}
                  title="הפק מחדש ביצוע חדש עם הטקסט או ההנחיות המעודכנות"
                  className="hover:text-amber-300 flex items-center gap-1 text-stone-400 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  הקלט מחדש
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => onGenerateAudio(candidate.id)}
                aria-label={`Generate audio for ${candidate.name}`}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-stone-950 hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                <span>הפק ביצוע קולי לטקסט המבחן</span>
              </button>
              <p className="text-[11px] text-stone-400 text-center font-mono">
                Gemini 3.8 Flash Lite TTS • 24kHz Master
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Card Footer: Compare Action */}
      <div className="p-3 bg-stone-950/80 border-t border-stone-850 flex items-center justify-between text-xs text-stone-400">
        <button
          onClick={() => onAddToComparison(candidate)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors ${
            isInComparison
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'hover:text-stone-200 hover:bg-stone-900'
          }`}
        >
          <GitCompare className="w-3.5 h-3.5" />
          <span>{isInComparison ? 'נמצא בהשוואת A/B' : 'הוסף להשוואת A/B'}</span>
        </button>

        <span className="text-[10px] text-stone-400 font-mono">
          ID: {candidate.id}
        </span>
      </div>
    </div>
  );
};
