import { VoiceCandidate, ProductionExportConfig } from '../types';

export const DEFAULT_TEST_SCRIPT = `יאללה תקשיבו טוב...

מי שבא לו להמשיך להיות כבש, שימשיך לגלול.

מי שלא... שיקשיב לאח שלכם רגע.

Let's talk about something interesting.

דמיינו שאתם נכנסים לחנות שעוני יוקרה.

המוכר מסתכל עליכם ואומר...

״אחי, עזוב אותך, אל תקנה. תשמור על הכסף שלך.״

וואלה... איזה נשמה טובה.

כמעט בא לך לקנות ממנו שעון רק כדי להגיד לו תודה.

אבל חכו שנייה...

בזמן שהוא מסביר לכם כמה חשוב לשמור על הכסף...

היד שלו כבר מוציאה שעון נוסף מהקופסה.

Interesting, right?

עכשיו בואו נעבור לטיקטוק לייב.

״חברים, אל תשלחו לי מתנות. באמת, תשמרו את הכסף שלכם.״

וואו... איזה לב זהב.

רק שהבאטל ממשיך.

הטיימר רץ.

והניצחון עדיין תלוי במתנות שלכם.

Now, here's the funny part.

הם לא בהכרח משקרים לכם.

יכול להיות שהם אפילו מאמינים למה שהם אומרים.

אבל המוח שלכם לא מגיב רק למילים.

הוא מגיב גם למה שקורה מול העיניים.

And that's the trick.

It's not what they say...

It's what they do.

אז בפעם הבאה שמישהו אומר לכם לא לעשות משהו...

תבדקו אם כל מה שמסביבו לא דוחף אתכם לעשות בדיוק את ההפך.

כי בסוף, אח שלכם יגלה לכם סוד קטן...

הפה אומר תפסיק.

והמשחק אומר תמשיך.

Welcome to ACUITY.

מאחורי המובן מאליו.`;

export const AVAILABLE_BASE_VOICES = [
  { id: 'Charon', label: 'Charon', gender: 'Male', tone: 'Deep, Resonant, Controlled' },
  { id: 'Puck', label: 'Puck', gender: 'Male', tone: 'Sharp, Youthful, Expressive' },
  { id: 'Zephyr', label: 'Zephyr', gender: 'Male', tone: 'Magnetic, Warm, Casual' },
  { id: 'Fenrir', label: 'Fenrir', gender: 'Male', tone: 'Grounded, Raspy, Authoritative' },
  { id: 'Orus', label: 'Orus', gender: 'Male', tone: 'Cinematic, Rich, Storyteller' },
  { id: 'Aoede', label: 'Aoede', gender: 'Expressive', tone: 'Melodic, Nuanced' },
  { id: 'Kore', label: 'Kore', gender: 'Clear', tone: 'Articulate, Balanced' },
];

export function getDefaultCandidates(): VoiceCandidate[] {
  return [
    {
      id: 'mastermind',
      voiceNumber: 1,
      name: 'The Lion King',
      hebrewName: 'קול 1: מלך האריות (The Lion King)',
      archetype: 'קול הבס העמוק והמחוספס של האריה מהסרטון — יושב על כס המלכות, מעשן סיגר ושולט במשחק',
      ageRange: '35–40',
      baseVoice: 'Fenrir',
      model: 'gemini-3.8-flash-lite-tts',
      vocalProfile: {
        pitch: 'Ultra-deep rumbling bass with thick vocal fry and growl',
        tempo: 'Slow, calculated, predatory timing, heavy authority',
        timbre: 'Smoke-textured, gravelly, menacing chest resonance',
        texture: 'An alpha lion kingpin smoking a cigar on a gold throne. Every word weighs a ton',
      },
      personality: 'בוס מאפיונרי ומלך האריות מהסרטון. יושב על כסא זהב, מעשן סיגר, צוחק צחוק פנימי עמוק ומנהל את הבאטל והחיים בביטחון בלתי מעורער.',
      deliveryStylePrompt: "You are the imposing, ultra-deep male lion king and mafia boss from the video, sitting on a golden royal throne smoking a thick cigar. Speak in an ultra-low, gravelly, menacing bass register with heavy vocal fry and resonant chest depth. Deliver the lines with supreme predatory authority, slow pacing, and deliberate cynical smirks. Seamlessly and effortlessly transition between authentic Israeli street Hebrew and gritty, deep, confident English phrases ('Let's talk about something interesting', 'Interesting, right?', 'Now, here's the funny part', 'And that's the trick. It's not what they say... It's what they do.', 'Welcome to ACUITY'). Zero radio announcer enthusiasm; speak with raw alpha dominance and deep psychological weight that rumbles in the chest.",
      hebrewDirectionGuide: 'קול בס עמוק ורועם במיוחד, מחוספס, מלווה בכובד נשימה ואיטיות מחושבת של מלך אריות ובוס מאפיונרי. טון של מי ששולט בבאטל ובמשחק, בלי לצעוק ובלי להתרגש. אותנטיות ישראלית מחוספסת של מי שיושב על כס המלכות ומעשן סיגר.',
      avatarColor: 'from-amber-400 via-yellow-700 to-stone-950',
      status: 'idle',
    },
    {
      id: 'gentleman',
      voiceNumber: 2,
      name: 'The Gentleman',
      hebrewName: 'קול 2: הג׳נטלמן האריסטוקרטי',
      archetype: 'בריטון עמוק, רגוע וקטיפתי. אריסטוקרטי עם סרקזם שקט ומדויק',
      ageRange: '32–35',
      baseVoice: 'Charon',
      model: 'gemini-3.8-flash-lite-tts',
      vocalProfile: {
        pitch: 'Deep baritone with rich resonance',
        tempo: 'Measured, unhurried, deliberate pauses',
        timbre: 'Smooth, polished with a subtle cynical smirk',
        texture: 'Rich, velvet, effortlessly commanding',
      },
      personality: 'איש עסקים מתוחכם שמכיר כל תרגיל בספר. שקט, רגוע, חיוך קולי של מישהו שמבין את המשחק עוד לפני שכולם התחילו לשחק.',
      deliveryStylePrompt: 'Israeli male narrator, early 30s. Deep, calm, aristocratic and sophisticated tone. Dry, subtle Israeli sarcasm with a relaxed smirk. Authentic native Hebrew flow, never radio-announcer theatrical. Intimate, perceptive, confident delivery that sounds like a man who mastered the game years ago.',
      hebrewDirectionGuide: 'קול בריטון עמוק ומאופק. אירוניה שקטה של מישהו שכבר ראה הכל. קצב דיבור נינוח, בלי פאתוס.',
      avatarColor: 'from-amber-600/40 via-amber-900/30 to-stone-950',
      status: 'idle',
    },
    {
      id: 'street-genius',
      voiceNumber: 3,
      name: 'The Street Genius',
      hebrewName: 'קול 3: גאון הרחוב והשווקים',
      archetype: 'צעיר (28–30), חד, מהיר וקצבי עם עוקצנות תל-אביבית טבעית',
      ageRange: '28–30',
      baseVoice: 'Puck',
      model: 'gemini-3.8-flash-lite-tts',
      vocalProfile: {
        pitch: 'Medium-high tenor, rapid dynamic inflections',
        tempo: 'Snappy, punchy, quick street rhythm',
        timbre: 'Bright, vibrant with authentic Tel Aviv wit',
        texture: 'Electric, nimble, unapologetically sharp',
      },
      personality: 'הבחור שגדל ברחוב, מכיר את כל הטריקים בשוק, ומפרק מניפולציות פסיכולוגיות בגובה העיניים כמו חבר גאון על אספרסו.',
      deliveryStylePrompt: 'Sharp, street-smart 28-year-old Israeli man. Fast-paced, punchy, naturally sarcastic with authentic Israeli cadence and casual dry humor. Native Hebrew with modern rhythm, genuine conversational smirk, absolutely no fake news-anchor stiffness. Sounds like an extremely clever friend exposing a hustle.',
      hebrewDirectionGuide: 'חד, מהיר וקצבי. עוקצנות תל-אביבית טבעית. מדבר בגובה העיניים כמו חבר גאון שקולט את התרגיל בשנייה.',
      avatarColor: 'from-emerald-600/40 via-emerald-900/30 to-stone-950',
      status: 'idle',
    },
    {
      id: 'charming-devil',
      voiceNumber: 4,
      name: 'The Magnetic Realist',
      hebrewName: 'קול 4: הריאליסט הממגנט',
      archetype: 'קול חם ומפתה עם חספוס קל. כריזמה ממגנטת שמספרת את האמת כסוד',
      ageRange: '30–33',
      baseVoice: 'Zephyr',
      model: 'gemini-3.8-flash-lite-tts',
      vocalProfile: {
        pitch: 'Warm tenor with a hint of gravelly rasp',
        tempo: 'Dynamic, teasing, seductive pauses before punchlines',
        timbre: 'Silky, magnetic, mischievous',
        texture: 'Slightly raspy, warm, whispering secrets in your ear',
      },
      personality: 'כריזמה מהפנטת. הוא גורם לצופה להסכים עם האמיתות הכי כואבות על חמדנות ואשליות אנושיות בחיוך שאי אפשר לסרב לו.',
      deliveryStylePrompt: 'Magnetic, charismatic Israeli man around 31. Seductive, playful, slightly raspy vocal texture. Deeply warm yet mischievous. Speaks like he is letting the listener in on an exclusive secret. Authentic Israeli Hebrew, natural cadence with playful irony and effortless swagger.',
      hebrewDirectionGuide: 'קול חם עם חספוס קל ומפתה. כריזמה ממגנטת, חיוך קולי שאי אפשר לסרב לו. סקרנות שובבה ומתוחכמת.',
      avatarColor: 'from-purple-600/40 via-purple-900/30 to-stone-950',
      status: 'idle',
    },
    {
      id: 'ice-man',
      voiceNumber: 5,
      name: 'The Cold Observer',
      hebrewName: 'קול 5: הצופה הקר (שחמטאי)',
      archetype: 'שקט, קר, דיוק כירורגי. אינטליגנציה מאיימת שמפרקת את המניפולציה',
      ageRange: '33–36',
      baseVoice: 'Orus',
      model: 'gemini-3.8-flash-lite-tts',
      vocalProfile: {
        pitch: 'Low, steady, unfluctuating gravity',
        tempo: 'Slow, precise, surgically timed articulation',
        timbre: 'Chilled, dry, razor-sharp authority',
        texture: 'Granular, dark, chillingly confident',
      },
      personality: 'שחמטאי פסיכולוגי. לא צריך להרים את הקול; הדיוק הקר והשקט של האבחנות שלו משאיר צמרמורת.',
      deliveryStylePrompt: 'Cold, surgical, deeply perceptive Israeli male narrator, mid-30s. Low-pitched, controlled, unhurried articulation. Intimidatingly intelligent with razor-sharp psychological insight. Deadpan Israeli sarcasm, absolutely zero artificial drama or radio shouting. Quiet power that commands total attention.',
      hebrewDirectionGuide: 'שקט, קר, מחושב כמו שחמטאי. דיוק כירורגי בכל מילה. אירוניה יבשה ועוצמה פנימית ללא מאמץ.',
      avatarColor: 'from-cyan-600/40 via-slate-900/40 to-stone-950',
      status: 'idle',
    },
  ];
}

export const MIND_BENDING_QUOTES = [
  {
    title: 'אשליית העושר מול השקט',
    quote: `העניים קונים דברים כדי להיראות עשירים.
העשירים באמת קונים שקט.
ואלה ששולטים בשניהם...
מוכרים להם את האשליה.`,
  },
  {
    title: 'הפוקר של החיים והפראייר',
    quote: `בפוקר של החיים,
אם אחרי חמש דקות אתה עדיין לא מבין מי הפראייר סביב השולחן...
אחי, הפראייר זה אתה.`,
  },
  {
    title: 'למה הכסף בורח ממך',
    quote: `אתה חושב שאתה רודף אחרי כסף?
הכסף לא בורח ממך...
הוא פשוט יודע שאתה מוכן למכור את הזמן שלך בחינם.`,
  },
  {
    title: 'האמת מאחורי שעון היוקרה',
    quote: `אף אחד לא קונה שעון של מאה אלף דולר בשביל לדעת מה השעה.
קונים אותו כדי שאחרים ידעו...
כמה הזמן שלהם זול ליד שלך.`,
  },
  {
    title: 'החיוך המסוכן ביותר בעסקים',
    quote: `האנשים הכי מסוכנים בעולם העסקים הם לא אלה שצועקים עליך.
הם אלה שמחייכים, שותקים...
וכבר קנו את החוב שלך לפני שעה.`,
  },
];

/**
 * Estimates Hebrew speech duration in seconds.
 * Average Hebrew voiceover cadence for TikTok/cinematic storytelling is ~110-130 words per minute.
 */
export function estimateHebrewSpeechDuration(text: string, wordsPerMinute = 120): number {
  if (!text || text.trim().length === 0) return 0;
  // Clean whitespace and count words
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  // Account for punctuation pauses (commas, ellipses, periods)
  const ellipsesCount = (text.match(/\.\.\./g) || []).length;
  const periodsCount = (text.match(/[.?!]/g) || []).length;
  const baseSeconds = (wordCount / wordsPerMinute) * 60;
  const pauseSeconds = ellipsesCount * 0.4 + periodsCount * 0.25;
  return Math.round((baseSeconds + pauseSeconds) * 10) / 10;
}

/**
 * Formats time in seconds to mm:ss or mm:ss.s
 */
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Validates whether a base64 string starts with the standard RIFF/WAVE header
 */
export function isValidWavBase64(base64: string): boolean {
  if (!base64 || typeof base64 !== 'string') return false;
  try {
    const binaryPrefix = atob(base64.slice(0, 32));
    const isRiff = binaryPrefix.slice(0, 4) === 'RIFF';
    const isWave = binaryPrefix.slice(8, 12) === 'WAVE';
    return isRiff && isWave;
  } catch {
    return false;
  }
}

/**
 * Converts a base64 WAV string to an audio Blob URL
 */
export function base64ToWavBlobUrl(base64: string): string {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Compiles a JSON production configuration for export
 */
export function buildProductionExport(
  candidate: VoiceCandidate,
  script: string
): ProductionExportConfig {
  const durationEst = estimateHebrewSpeechDuration(script);
  return {
    studio: 'ACUITY VOICE STUDIO — סטודיו קריינות',
    seriesTitle: 'ACUITY — מאחורי המובן מאליו (פרק 001: אשליית הדאגה)',
    exportDate: new Date().toISOString(),
    selectedCandidate: {
      id: candidate.id,
      name: candidate.name,
      hebrewName: candidate.hebrewName,
      baseVoice: candidate.baseVoice,
      model: candidate.model,
      deliveryStylePrompt: candidate.deliveryStylePrompt,
      vocalProfile: candidate.vocalProfile,
    },
    script,
    audioMetadata: {
      format: 'WAV 16-bit PCM Mono',
      sampleRate: 24000,
      channels: 1,
      durationEstimateSec: durationEst,
    },
    notes: 'Official voice casting selection. Reuse baseVoice and deliveryStylePrompt across all episodes for consistent vocal branding.',
  };
}
