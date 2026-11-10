import React, { useState } from 'react';
import { VoiceCandidate } from '../types';
import { DEFAULT_TEST_SCRIPT } from '../utils/audioUtils';
import {
  Crown,
  Play,
  Pause,
  Sparkles,
  Volume2,
  Flame,
  CheckCircle2,
  Mic,
  RefreshCw,
  Download,
  ScrollText,
} from 'lucide-react';

interface LionVoiceStudioProps {
  lionCandidate: VoiceCandidate;
  onSelectCandidate: (candidate: VoiceCandidate) => void;
  onGenerateAudio: (candidateId: string) => Promise<void>;
  onLoadScript: (scriptText: string) => void;
  onGoToPostMarriage?: () => void;
}

export const LION_ORIGINAL_SCRIPT = `תמיד צריך לזוז ואז לדבר.
תסתכל ת׳פרויקט פה, אתה תיקח אותו אליי.
צ׳אט, כולם ללחוץ עכשיו.
תסתכלו על הצד שלהם, אין להם כלום.
דאבל טאפ וורדים... יאללה!`;

export const LionVoiceStudio: React.FC<LionVoiceStudioProps> = ({
  lionCandidate,
  onSelectCandidate,
  onGenerateAudio,
  onLoadScript,
  onGoToPostMarriage,
}) => {
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isRenderingVideo, setIsRenderingVideo] = useState(false);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<'original' | 'dubbed'>('original');
  const [renderError, setRenderError] = useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const toggleVideoPlayback = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlayingVideo(true);
    } else {
      videoRef.current.pause();
      setIsPlayingVideo(false);
    }
  };

  const toggleAudioPlayback = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play();
      setIsPlayingAudio(true);
    } else {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  };

  const handleRenderVideo = async () => {
    setIsRenderingVideo(true);
    setRenderError(null);
    try {
      let audioBase64 = lionCandidate.audioBase64;
      if (!audioBase64) {
        // Need to generate audio first
        await onGenerateAudio(lionCandidate.id);
        // If not available immediately in state, we wait a moment or notify
      }

      // Fetch with current candidate audio
      const res = await fetch('/api/video/render-with-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: lionCandidate.audioBase64 || audioBase64,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'נכשלה הפקת הוידאו עם הקול');
      }

      setRenderedVideoUrl(data.videoUrl);
      setVideoMode('dubbed');
      setIsPlayingVideo(false);

      // Trigger auto download of the rendered video
      const a = document.createElement('a');
      a.href = data.videoUrl;
      a.download = `Acuity_Lion_King_Dubbed_Video_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Render video error:', err);
      setRenderError(err?.message || 'שגיאה במיזוג הוידאו והאודיו');
    } finally {
      setIsRenderingVideo(false);
    }
  };

  return (
    <div className="rounded-2xl bg-gradient-to-r from-[#18150e] via-[#121118] to-[#0c0c10] border-2 border-amber-500/40 p-5 sm:p-6 shadow-2xl relative overflow-hidden">
      {/* Background ambient gold aura */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {lionCandidate.audioBase64 && (
        <audio
          ref={audioRef}
          src={lionCandidate.audioUrl || `data:audio/wav;base64,${lionCandidate.audioBase64}`}
          onPlay={() => setIsPlayingAudio(true)}
          onPause={() => setIsPlayingAudio(false)}
          onEnded={() => setIsPlayingAudio(false)}
        />
      )}

      <div className="relative flex flex-col lg:flex-row items-center gap-6">
        {/* Video Player Box */}
        <div className="w-full lg:w-80 shrink-0 rounded-2xl overflow-hidden border-2 border-amber-400/50 bg-black shadow-2xl relative group flex flex-col">
          <div className="relative">
            <video
              ref={videoRef}
              key={videoMode === 'dubbed' && renderedVideoUrl ? 'dubbed' : 'original'}
              src={
                videoMode === 'dubbed' && renderedVideoUrl
                  ? renderedVideoUrl
                  : '/assets/aistudio/VID-20261106-WA0057_1__fae7bb56.mp4'
              }
              className="w-full h-52 sm:h-64 object-cover"
              playsInline
              loop
              onPlay={() => setIsPlayingVideo(true)}
              onPause={() => setIsPlayingVideo(false)}
            />

            <button
              onClick={toggleVideoPlayback}
              className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-all cursor-pointer"
              aria-label={isPlayingVideo ? 'Pause Lion Video' : 'Play Lion Video'}
            >
              <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-amber-500 to-amber-300 text-stone-950 flex items-center justify-center shadow-xl transform group-hover:scale-110 transition-transform">
                {isPlayingVideo ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-1" />
                )}
              </div>
            </button>

            <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-md bg-black/85 text-[11px] text-amber-300 font-mono flex items-center gap-1.5 border border-amber-500/40 backdrop-blur-sm">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {videoMode === 'dubbed'
                  ? '🎬 וידאו מדובב: האריה עם קול Fenrir'
                  : '🦁 סרטון מקור: האריה בבאטל לייב'}
              </span>
            </div>
          </div>

          {/* Mode Switcher & Download if rendered */}
          {renderedVideoUrl && (
            <div className="p-2.5 bg-stone-950 border-t border-amber-500/30 flex items-center justify-between text-xs gap-2">
              <button
                onClick={() => {
                  setVideoMode(videoMode === 'original' ? 'dubbed' : 'original');
                  setIsPlayingVideo(false);
                }}
                className="text-[11px] font-bold text-amber-300 hover:text-white flex items-center gap-1 bg-stone-900 px-2 py-1 rounded border border-stone-800"
              >
                <span>החלף:</span>
                <span className="text-white underline">
                  {videoMode === 'dubbed' ? 'הצג מקור' : 'הצג מדובב עם הקול'}
                </span>
              </button>

              <a
                href={renderedVideoUrl}
                download="Acuity_Lion_King_Dubbed_Video.mp4"
                className="text-[11px] font-bold bg-amber-400 text-stone-950 hover:bg-amber-300 px-2.5 py-1 rounded flex items-center gap-1 shadow-sm"
              >
                <Download className="w-3 h-3" />
                <span>הורד MP4</span>
              </a>
            </div>
          )}
        </div>

        {/* Content & Action Hub */}
        <div className="flex-1 space-y-4 text-right w-full" dir="rtl">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-stone-950 text-xs font-black tracking-wider uppercase flex items-center gap-1 shadow-sm">
                <Crown className="w-3.5 h-3.5" />
                <span>The Lion King Voice Studio</span>
              </span>
              <span className="text-xs text-amber-300 font-mono bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                קול בסיס: Fenrir (בס נמוך עמוק + צרידות מחוספסת)
              </span>
            </div>

            <h3 className="text-lg sm:text-xl font-black text-white font-hebrew">
              קול האריה: ״יאללה תקשיבו טוב... מי שבא לו להיות כבש, שימשיך לגלול״
            </h3>
            <p className="text-xs text-stone-300 leading-relaxed">
              התאמנו את מודל Gemini TTS לקול הבס הנמוך ביותר בפורטפוליו (קול הבסיס <strong>Fenrir</strong>)
              עם הנחיית סגנון מותאמת אישית: דיבור כבד, איטי, בס רועם בחזה, חיוך סרקסטי ומעבר טבעי בין עברית של הרחוב לביטויים באנגלית מתוך הסרטון.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {/* Primary Action 1: Generate Voice Audio */}
            <button
              onClick={() => onGenerateAudio(lionCandidate.id)}
              disabled={lionCandidate.status === 'generating' || isRenderingVideo}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-stone-950 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-lg shadow-amber-500/20 hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
            >
              {lionCandidate.status === 'generating' ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>מפיק קול אריה...</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span>הפק ביצוע קולי</span>
                </>
              )}
            </button>

            {/* Primary Action 2: Render Video with Lion Voice */}
            <button
              onClick={handleRenderVideo}
              disabled={isRenderingVideo || lionCandidate.status === 'generating'}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-yellow-500 via-amber-300 to-yellow-600 text-stone-950 font-black text-xs sm:text-sm flex items-center gap-2 shadow-xl shadow-amber-400/25 hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50 ring-2 ring-amber-300/60"
              title="ממזג את סרטון האריה עם רצועת הקול של Gemini TTS לקובץ וידאו MP4 מלא"
            >
              {isRenderingVideo ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>ממזג וידאו + קול ב-FFmpeg...</span>
                </>
              ) : (
                <>
                  <Crown className="w-4 h-4" />
                  <span>תפיק לי את הוידאו עם הקול (MP4)</span>
                </>
              )}
            </button>

            {/* If audio is already generated for Lion King, show quick play button */}
            {lionCandidate.audioBase64 && (
              <button
                onClick={toggleAudioPlayback}
                className="px-3.5 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold text-xs border border-emerald-500/40 flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
              >
                {isPlayingAudio ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>עצור האזנה</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>האזן לקול האריה ▶</span>
                  </>
                )}
              </button>
            )}

            <button
              onClick={() => onLoadScript(DEFAULT_TEST_SCRIPT)}
              className="px-3 py-2 rounded-xl bg-stone-900 hover:bg-stone-850 text-amber-300 font-semibold text-xs border border-amber-500/30 hover:border-amber-400 flex items-center gap-1.5 transition-all cursor-pointer"
              title="טען את תסריט האריה המלא (יאללה תקשיבו טוב...)"
            >
              <ScrollText className="w-3.5 h-3.5 text-amber-400" />
              <span>טען תסריט מלא</span>
            </button>

            <button
              onClick={() => onLoadScript(LION_ORIGINAL_SCRIPT)}
              className="px-3 py-2 rounded-xl bg-stone-900 hover:bg-stone-850 text-stone-300 hover:text-amber-200 font-semibold text-xs border border-stone-800 hover:border-amber-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
              title="טען את המשפט המדויק מהסרטון"
            >
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>טקסט מקור מהסרטון</span>
            </button>

            <button
              onClick={() => onSelectCandidate(lionCandidate)}
              className="px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-semibold text-xs border border-amber-500/30 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              <span>נעל כקול קבוע</span>
            </button>

            {onGoToPostMarriage && (
              <button
                onClick={onGoToPostMarriage}
                className="px-3 py-2 rounded-xl bg-gradient-to-r from-amber-600/30 to-amber-500/20 hover:from-amber-600/40 hover:to-amber-500/30 text-amber-300 font-bold text-xs border border-amber-400/40 flex items-center gap-1.5 transition-all cursor-pointer shadow-md mr-auto"
                title="עבור למחולל מריאז׳ פוסטים ואופטימיזציה לסושיאל"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>מריאז׳ פוסטים ואופטימיזציה</span>
              </button>
            )}
          </div>

          {renderError && (
            <div className="text-xs text-red-300 bg-red-950/60 p-2.5 rounded-lg border border-red-500/30">
              {renderError}
            </div>
          )}

          <div className="text-[11px] text-stone-400 font-mono bg-stone-950/80 p-2.5 rounded-lg border border-stone-850 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold">התחלת התסריט:</span>
              <span className="text-stone-200 font-bold">״יאללה תקשיבו טוב... מי שבא לו להמשיך להיות כבש, שימשיך לגלול...״</span>
            </div>
            <span className="text-amber-400 text-[10px]">Gemini 3.8 Flash TTS • 24kHz</span>
          </div>
        </div>
      </div>
    </div>
  );
};
