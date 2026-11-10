import React, { useState } from 'react';
import { VoiceCandidate } from '../types';
import {
  Sparkles,
  Copy,
  Check,
  Layers,
  Volume2,
  Music,
  Type,
  Hash,
  MessageSquare,
  Flame,
  Zap,
  TrendingUp,
  Video,
  Sliders,
  Eye,
  Bookmark,
  Share2,
  FileText,
  AlertCircle,
  Play,
  Clock,
  Radio,
} from 'lucide-react';

interface PostMarriageStudioProps {
  currentScript: string;
  selectedVoice: VoiceCandidate;
  onLoadScript?: (script: string) => void;
  onGoToVideo?: () => void;
}

export const PostMarriageStudio: React.FC<PostMarriageStudioProps> = ({
  currentScript,
  selectedVoice,
  onLoadScript,
  onGoToVideo,
}) => {
  const [platform, setPlatform] = useState<'tiktok' | 'reels' | 'shorts'>('tiktok');
  const [hookStyle, setHookStyle] = useState<'provocative' | 'curiosity' | 'philosophical' | 'brother'>(
    'brother'
  );
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleCopy = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 3000);
  };

  // Dynamic Hooks based on the selected tone
  const hooksConfig = {
    brother: {
      tag: 'שיחת אחים / מועדון סגור',
      hook1: 'מי שרוצה להמשיך להיות כבש שימשיך לגלול... 🦁',
      hook2: 'עזבו הכל ותקשיבו לאח שלכם 30 שניות.',
      hook3: 'הטריק ששעוני יוקרה וטיקטוק לייב לא רוצים שתבינו.',
    },
    provocative: {
      tag: 'אגרוף לבטן / שבירת מוסכמות',
      hook1: 'הם לא דואגים לך. הם רק רוצים את הכסף שלך.',
      hook2: 'למה האנשים שאומרים לך ״תשמור על הכסף״ הם הכי מסוכנים?',
      hook3: 'הפה אומר תפסיק. המשחק אומר תמשיך. תתעוררו.',
    },
    curiosity: {
      tag: 'סקרנות ומסתורין תודעתי',
      hook1: 'תארו לכם שמוכר בחנות אומר לכם: ״אל תקנו״...',
      hook2: 'הסוד הפסיכולוגי שגורם לאנשים לזרוק אלפי שקלים בלייב.',
      hook3: 'איך לדעת בשנייה אחת אם אדם באמת דואג לך?',
    },
    philosophical: {
      tag: 'עומק, סמכות וספרות (ACUITY)',
      hook1: 'ACUITY — פרק 001: אשליית הדאגה המזויפת.',
      hook2: 'לא צריך לבדוק אם אדם משקר. צריך לבדוק את זה...',
      hook3: 'מה קורה כשהמילים אומרות דבר אחד, אבל הידיים עושות את ההפך?',
    },
  };

  const currentHooks = hooksConfig[hookStyle];

  // Post Captions optimized for each platform
  const getSocialPostCopy = () => {
    if (platform === 'tiktok') {
      return `מי שרוצה להמשיך להיות כבש שימשיך לגלול... 🦁👀

שמתם לב שמי שאומר לכם ״תשמרו את הכסף״, היד שלו כבר מוציאה את השעון הבא מהקופסה?

בטיקטוק לייב, בעסקים, או בחיים:
הפה אומר תפסיק.
המשחק אומר תמשיך.

תשמרו את הפוסט הזה לפעם הבאה שמישהו ״דואג לכם יותר מדי״.

ספרו לי בתגובות: נפלתם בזה פעם? 👇

#אקואיטי #פסיכולוגיה #עסקים #חשיבה_אחרת #טיקטוקישראל #מלךהאריות #ACUITY`;
    } else if (platform === 'reels') {
      return `״עזוב אחי, אל תקנה. תשמור את הכסף שלך.״ 
נשמע כמו אדם שאכפת לו ממך, נכון?

אבל בזמן שהוא מדבר, השעון הבא כבר על השולחן. 
ובזמן שהיוצר בלייב אומר ״אל תשלחו מתנות״, הטיימר ממשיך לרוץ והבאטל לא עוצר.

חוק ברזל שלמדנו בחיים:
לא תמיד צריך לבדוק אם אדם משקר במילים.
מספיק לבדוק אם ההתנהגות שלו משרתת בדיוק את ההפך.

מתוך הספר ״אקואיטי״ — מאחורי המובן מאליו.

שתפו את זה לסטורי אם גם אתם מכירים אנשים כאלה. 🔗

#mindset #psychology #israel #acuity #reelsisrael #חשיבה_ביקורתית #עסקים #התפתחותאישית`;
    } else {
      return `הטריק הפסיכולוגי של שעוני היוקרה וטיקטוק לייב | ACUITY פרק 001

למה לפעמים האנשים שאומרים לנו ״אל תקנו״ גורמים לנו לקנות פי שניים?
בסרטון קצר זה אנחנו חושפים את אשליית הדאגה: הפער שבין מה שהפה אומר, לבין מה שהמשחק מייצר.

קריינות: מלך האריות (קול בס סמכותי ישראלי).
מתוך הספר ״אקואיטי״ — מאחורי המובן מאליו.

הרשמו לערוץ לפרקים נוספים בסדרה.

#Shorts #Acuity #Psychology #Hebrew #טיקטוק`;
    }
  };

  const postCopy = getSocialPostCopy();

  const completePackageText = `=== מריאז' פוסט מלא: סדרת ACUITY (פרק 001) ===
פלטפורמה מיועדת: ${platform.toUpperCase()}
סגנון הוק ראשי: ${currentHooks.tag}

[1. כותרת ענקית / הוק במסך ב-3 שניות הראשונות]:
${currentHooks.hook1}

[2. כתוביות קינטיות ומבנה וידאו]:
- פונט: Heebo ExtraBold 800 / Assistant Black
- צבע טקסט: לבן נקי + מילה מודגשת בזהב זוהר (#F59E0B)
- מיקום: מרכז-תחתון (מעל ה-UI של טיקטוק)
- קצב: 1-2 מילים בכל רגע בסנכרון מלא לקול הבס

[3. אפקטי סאונד ומוזיקה (Audio Cues)]:
- 00:00: כניסת Sub-Bass Riser + קול האריה (ווליום 100%)
- 00:08: אפקט Whoosh חד במעבר לחנות השעונים
- 00:19: סאונד שעון מתקתק (Clock Tick) עדין במעבר לטיקטוק לייב
- 00:35: שתיקה של שנייה אחת (Hard Silence) לפני ״הפה אומר תפסיק״
- 00:38: מכת סאב בס (Sub Boom) על המילים ״והמשחק אומר תמשיך״

[4. טקסט פוסט (Caption) להדבקה]:
${postCopy}
`;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero Explainer Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-stone-900 via-[#101017] to-stone-950 border border-amber-500/30 p-6 sm:p-8 shadow-2xl shadow-black/80">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-amber-300 to-amber-600" />
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>נוסחת המריאז׳ הוויראלי (The Viral Post Marriage Architecture)</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-black font-cinzel text-white tracking-wide">
              איך בונים ״מריאז׳״ מושלם של פוסטים?
            </h2>

            <p className="text-sm sm:text-base text-stone-300 leading-relaxed font-hebrew" dir="rtl">
              <strong>״מריאז׳״ (Marriage)</strong> בעולם הווידאו והתוכן הוא השילוב המסונכרן ב-100% שבין{' '}
              <span className="text-amber-400 font-bold">4 מרכיבים חיוניים</span>: הקול הסמכותי שפותח את האוזן, הוויז׳ואל המהפנט שמונע גלילה, אפקטי הסאונד שמחזיקים את המתח, והאופטימיזציה שגורמת לאלגוריתם להעיף את הפוסט בפיד.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch lg:items-center gap-3 shrink-0">
            {onGoToVideo && (
              <button
                onClick={onGoToVideo}
                className="px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 font-black text-sm shadow-lg shadow-amber-500/25 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Video className="w-4 h-4 fill-current" />
                <span>צפה בווידאו האריה המדובב</span>
              </button>
            )}

            <button
              onClick={() => handleCopy(completePackageText, 'complete-bundle')}
              className="px-5 py-3 rounded-2xl bg-stone-900 hover:bg-stone-850 text-amber-300 border border-amber-500/40 text-sm font-bold shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {copiedSection === 'complete-bundle' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">הועתקה כל החבילה!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-amber-400" />
                  <span>העתק חבילת מריאז׳ מלאה</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 4 Pillars of the Marriage (Interactive Visual Breakdown) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pillar 1: The Voice */}
        <div className="p-5 rounded-2xl bg-stone-900/60 border border-amber-500/20 hover:border-amber-500/40 transition-all space-y-3 relative overflow-hidden group">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Volume2 className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-mono text-amber-400/80 uppercase tracking-wider block">
            נדבך 1 • הקול והאינטונציה
          </span>
          <h4 className="text-base font-bold text-white">קול האריה (The Voice)</h4>
          <p className="text-xs text-stone-300 leading-relaxed font-hebrew" dir="rtl">
            בס נמוך ועמוק (Fenrir). קצב לא ממהר. שילוב בין עברית חצופה (״וואלה איזה נשמה טובה״) לאנגלית חלקה (״Let's talk about something interesting״). הקול בונה אמינות וסמכות מוחלטת.
          </p>
          <div className="pt-2 text-[11px] font-mono text-amber-300 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            <span>ננעל כקול קבוע: {selectedVoice.hebrewName}</span>
          </div>
        </div>

        {/* Pillar 2: The Visual Anchor */}
        <div className="p-5 rounded-2xl bg-stone-900/60 border border-amber-500/20 hover:border-amber-500/40 transition-all space-y-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Video className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-mono text-amber-400/80 uppercase tracking-wider block">
            נדבך 2 • הוויז׳ואל והלופ
          </span>
          <h4 className="text-base font-bold text-white">דמות האריה והלופ המושלם</h4>
          <p className="text-xs text-stone-300 leading-relaxed font-hebrew" dir="rtl">
            סרטון האריה היוקרתי בכיסא עור עם עשן הסיגר. הלופ החלק (Seamless Loop) גורם לאנשים לצפות פעמיים בלי לשים לב, מה שמקפיץ את ה-Watch Time ואת ה-Retention Rate באלגוריתם.
          </p>
          <div className="pt-2 text-[11px] font-mono text-stone-400">
            פורמט: 9:16 אנכי • 60 FPS / H.264
          </div>
        </div>

        {/* Pillar 3: Audio Effects & Music */}
        <div className="p-5 rounded-2xl bg-stone-900/60 border border-amber-500/20 hover:border-amber-500/40 transition-all space-y-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Music className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-mono text-amber-400/80 uppercase tracking-wider block">
            נדבך 3 • סאונדטרק ואפקטים
          </span>
          <h4 className="text-base font-bold text-white">אפקטים קוליים (SFX)</h4>
          <p className="text-xs text-stone-300 leading-relaxed font-hebrew" dir="rtl">
            מוזיקת רקע Dark Cinematic במינוס 20dB. הוספת תקתוק שעון ברגע שמדברים על השעונים, ושתיקה מוחלטת (Hard Cut) של חצי שנייה לפני הפאנץ׳ (״והמשחק אומר תמשיך״) כדי לייצר צמרמורת.
          </p>
          <div className="pt-2 text-[11px] font-mono text-stone-400">
            תבנית סאונד: Dark Mystery / Sub Riser
          </div>
        </div>

        {/* Pillar 4: Algorithm Optimization */}
        <div className="p-5 rounded-2xl bg-stone-900/60 border border-amber-500/20 hover:border-amber-500/40 transition-all space-y-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <TrendingUp className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-mono text-amber-400/80 uppercase tracking-wider block">
            נדבך 4 • הוקים וכיתוב מסודר
          </span>
          <h4 className="text-base font-bold text-white">אופטימיזציה לסושיאל</h4>
          <p className="text-xs text-stone-300 leading-relaxed font-hebrew" dir="rtl">
            ההוק בשלוש השניות הראשונות קובע 80% מההצלחה. טקסט מרווח עם כוכביות, שאלה שמייצרת תגובות וויכוח (Comment Bait מוסרי), וחבילת תגיות SEO ממוקדות.
          </p>
          <div className="pt-2 text-[11px] font-mono text-stone-400">
            יחס שיתופים / שמירות גבוה במיוחד
          </div>
        </div>
      </div>

      {/* Main Interactive Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left/Main Column: Post Optimizer & Copy Generator */}
        <div className="lg:col-span-7 space-y-6">
          {/* Controls Panel */}
          <div className="p-5 rounded-2xl bg-[#0e0e14] border border-stone-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs font-bold font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" />
                <span>הגדרות אופטימיזציה לפוסט</span>
              </span>

              {/* Platform Selector Tabs */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-stone-950 border border-stone-800">
                <button
                  onClick={() => setPlatform('tiktok')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    platform === 'tiktok'
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  טיקטוק (TikTok)
                </button>
                <button
                  onClick={() => setPlatform('reels')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    platform === 'reels'
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  רילס (Reels)
                </button>
                <button
                  onClick={() => setPlatform('shorts')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    platform === 'shorts'
                      ? 'bg-amber-400 text-stone-950 shadow'
                      : 'text-stone-400 hover:text-white'
                  }`}
                >
                  שורטס (Shorts)
                </button>
              </div>
            </div>

            {/* Hook Style Selector */}
            <div className="space-y-2">
              <label className="text-xs text-stone-300 font-bold block">
                בחר סגנון פתיח (הוק שובר גלילה ב-3 שניות הראשונות):
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'brother', label: 'שיחת אחים' },
                  { id: 'provocative', label: 'אגרוף לבטן' },
                  { id: 'curiosity', label: 'סקרנות ומסתורין' },
                  { id: 'philosophical', label: 'סמכותי (ACUITY)' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setHookStyle(item.id as any)}
                    className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                      hookStyle === item.id
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm'
                        : 'bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-850'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 1: 3 Scroll-Stopping Hooks */}
          <div className="p-6 rounded-2xl bg-[#0c0c12] border border-amber-500/30 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white font-hebrew">
                  3 אפשרויות להוק ראשי שמופיע על המסך ב-3 שניות הראשונות
                </h3>
              </div>
              <span className="text-[11px] font-mono text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/20">
                {currentHooks.tag}
              </span>
            </div>

            <p className="text-xs text-stone-400 font-hebrew">
              שים את המשפט הזה בגדול במרכז המסך בשניות הראשונות כדי לעצור 100% מהגוללים:
            </p>

            <div className="space-y-2.5">
              {[currentHooks.hook1, currentHooks.hook2, currentHooks.hook3].map((hook, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-stone-900/90 border border-stone-800 hover:border-amber-500/40 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-white font-hebrew" dir="rtl">
                      {hook}
                    </span>
                  </div>

                  <button
                    onClick={() => handleCopy(hook, `hook-${idx}`)}
                    className="p-1.5 rounded-lg bg-stone-800 text-stone-300 hover:text-amber-400 hover:bg-stone-700 transition-colors cursor-pointer shrink-0"
                    title="העתק הוק"
                  >
                    {copiedSection === `hook-${idx}` ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Complete Formatted Post Caption */}
          <div className="p-6 rounded-2xl bg-[#0c0c12] border border-stone-800 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white font-hebrew">
                  טקסט הפוסט המעוצב והמסודר (Post Caption)
                </h3>
              </div>

              <button
                onClick={() => handleCopy(postCopy, 'caption')}
                className="px-3.5 py-1.5 rounded-xl bg-amber-400/15 text-amber-300 border border-amber-400/30 hover:bg-amber-400/25 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSection === 'caption' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>הועתק ללוח!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>העתק טקסט פוסט</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-stone-400 font-hebrew">
              מותאם לכללי האלגוריתם של {platform.toUpperCase()} עם מרווחי שורות, שאלת מעורבות (CTA) והאשטאגים:
            </p>

            <div
              className="p-4 rounded-xl bg-stone-950/80 border border-stone-800 text-stone-200 text-sm font-hebrew leading-relaxed whitespace-pre-line select-all"
              dir="rtl"
            >
              {postCopy}
            </div>
          </div>
        </div>

        {/* Right Column: Audio & Effects Cue Sheet + Kinetic Subtitles Guide */}
        <div className="lg:col-span-5 space-y-6">
          {/* Audio & SFX Cue Sheet */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-stone-900 to-[#12121b] border border-amber-500/20 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                <Sliders className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-white font-hebrew">
                לוח אפקטים וסאונד (Audio Cue Sheet)
              </h3>
            </div>

            <p className="text-xs text-stone-300 font-hebrew" dir="rtl">
              כדי שהקול ישב בתוך הווידאו כמו הפקה הוליוודית, שלב את האפקטים הבאים בעריכה (CapCut / Premiere):
            </p>

            <div className="space-y-3 font-hebrew text-xs" dir="rtl">
              {/* Cue 1 */}
              <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 flex items-start gap-3">
                <span className="font-mono text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 shrink-0">
                  00:00
                </span>
                <div>
                  <span className="font-bold text-white block">סאב-בס עמוק + פתיחת האריה</span>
                  <span className="text-stone-400 text-[11px]">
                    כניסה עם Low Riser אפל בווליום 100%. בלי מוזיקה רועשת — רק תדר נמוך שמרעיד את האוזניות.
                  </span>
                </div>
              </div>

              {/* Cue 2 */}
              <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 flex items-start gap-3">
                <span className="font-mono text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 shrink-0">
                  00:10
                </span>
                <div>
                  <span className="font-bold text-white block">סאונד טיק שעון (Clock Tick)</span>
                  <span className="text-stone-400 text-[11px]">
                    כשהוא אומר ״חנות שעוני יוקרה״ — מכניסים טיק-טק עדין של שעון מכני בווליום של 30%.
                  </span>
                </div>
              </div>

              {/* Cue 3 */}
              <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 flex items-start gap-3">
                <span className="font-mono text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 shrink-0">
                  00:22
                </span>
                <div>
                  <span className="font-bold text-white block">מעבר לטיקטוק לייב (Whoosh / Glitch)</span>
                  <span className="text-stone-400 text-[11px]">
                    מעבר חד עם גליץ׳ סאונד קל להדגשת הניגוד בין חנות יוקרה לטיקטוק.
                  </span>
                </div>
              </div>

              {/* Cue 4 */}
              <div className="p-3 rounded-xl bg-stone-950/80 border border-stone-800 flex items-start gap-3">
                <span className="font-mono text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20 shrink-0">
                  סוף
                </span>
                <div>
                  <span className="font-bold text-white block">שתיקה מוחלטת (Hard Silence) + בום בס</span>
                  <span className="text-stone-400 text-[11px]">
                    שתיקה של שנייה אחת בין ״הפה אומר תפסיק״ לבין ״והמשחק אומר תמשיך״ — זה מייצר 100% מהוויראליות.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Kinetic Subtitles Guide */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-stone-900 to-[#12121b] border border-amber-500/20 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
                <Type className="w-4 h-4" />
              </div>
              <h3 className="text-base font-bold text-white font-hebrew">
                כללי כתוביות קינטיות (Kinetic Subtitles)
              </h3>
            </div>

            <div className="space-y-3 font-hebrew text-xs" dir="rtl">
              <div className="p-3 rounded-xl bg-stone-950/60 border border-stone-800">
                <span className="font-bold text-amber-300 block mb-1">1. מקסימום 1–3 מילים במסך בכל רגע</span>
                <span className="text-stone-400">
                  אל תשים שורות ארוכות. העין קוראת מהר בהרבה כשהמילים קופצות בקצב הדיבור של האריה.
                </span>
              </div>

              <div className="p-3 rounded-xl bg-stone-950/60 border border-stone-800">
                <span className="font-bold text-amber-300 block mb-1">2. פלטת צבעים: לבן וזהב מודגש</span>
                <span className="text-stone-400">
                  רוב המילים בצבע לבן בוהק (#FFFFFF) עם צל שחור עבה. המילה החשובה בכל משפט (״כבש״, ״יוקרה״, ״תמשיך״) מודגשת בצהוב-זהב זוהר (#F59E0B).
                </span>
              </div>

              <div className="p-3 rounded-xl bg-stone-950/60 border border-stone-800">
                <span className="font-bold text-amber-300 block mb-1">3. מיקום בטוח בטיקטוק</span>
                <span className="text-stone-400">
                  שים את הכתוביות בדיוק ב-45% גובה של המסך (מעל הכפתורים והכיתוב של טיקטוק מימין ולמטה).
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
