import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Shared Gemini client with required User-Agent and v1beta apiVersion for TTS speechConfig support
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    apiVersion: 'v1beta',
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Endpoint: Health & Config check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    supportedModels: ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'],
    serverTime: new Date().toISOString(),
  });
});

// Endpoint: TTS Generation
app.post('/api/tts/generate', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      text,
      voiceName = 'Charon',
      style = '',
      model = 'gemini-3.8-flash-lite-tts',
      candidateId = '',
    } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing or empty text script for audio generation.',
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(401).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured on the server. Please attach your API key in the AI Studio Settings > Secrets panel.',
      });
    }

    // Call Gemini TTS with v1beta speechConfig
    const speechConfig: any = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voiceName.trim(),
        },
      },
    };

    const parts: any[] = [
      {
        text: text.trim(),
        ...(style ? { speechMetadata: { style: style.trim() } } : {}),
      },
    ];

    const response = await ai.models.generateContent({
      model: model || 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig,
      },
    });

    const candidate = response.candidates?.[0];
    const audioPart = candidate?.content?.parts?.find(
      (p: any) => p.inlineData && p.inlineData.data
    );

    const base64Audio = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || 'audio/wav';

    if (!base64Audio) {
      const finishReason = candidate?.finishReason;
      const textFallback = candidate?.content?.parts?.[0]?.text;
      return res.status(502).json({
        success: false,
        error: `Model did not return audio data (Finish reason: ${finishReason || 'Unknown'}). ${textFallback ? `Model note: ${textFallback}` : ''}`,
      });
    }

    const elapsedMs = Date.now() - startTime;

    return res.json({
      success: true,
      audioBase64: base64Audio,
      mimeType,
      voiceName,
      style,
      model,
      candidateId,
      elapsedMs,
    });
  } catch (error: any) {
    console.error('TTS Generation error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to generate speech with Gemini TTS.',
      status: error?.status,
    });
  }
});

// Endpoint: Generate Next Episode Script in Hebrew
app.post('/api/generate-episode', async (req, res) => {
  try {
    const { topic = 'The Illusion of Scarcity', concept = '', seriesVibe = 'Charismatic cynical Israeli psychology mentor' } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is missing on server.',
      });
    }

    const prompt = `אתה תסריטאי ראשי לסדרת טיקטוק סינמטית יוקרתית על פסיכולוגיה אנושית, מניפולציות, כסף והתנהגות חברתית.
הקריין הוא גבר ישראלי בן 28–35: שנון, חכם-רחוב, חד-מחשבה, בעל הומור ציני יבש ועוקצני, כריזמטי, אמין ולא מטיף.
הנושא לפרק הבא: "${topic}".
קונספט נוסף: "${concept || 'חשיפת הטקטיקה הפסיכולוגית הסמויה שכולם נופלים בה'}".

כתוב תסריט קצר, מהודק ומושלם לקריאה קולית (כ-60 עד 90 מילים בעברית טבעית ומדוברת).
מבנה התסריט:
1. פתיחה קולנועית וממגנטת ("תכירו את..." / סיטואציה מוכרת מהחיים)
2. טקסט אותנטי של מניפולציה יומיומית
3. משפט אירוני שקולט את הבלוף
4. התפנית הפסיכולוגית
5. החוק הבלתי כתוב (למשל "חוק מספר שתיים. ...")
6. פאנץ' בלתי נשכח שמשאיר את הצופה המום.

כתוב אך ורק את התסריט עצמו בעברית נקייה וטבעית, ללא כותרות, ללא הערות במאי בסוגריים, וללא הוראות הפקה.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const script = response.text?.trim() || '';

    return res.json({
      success: true,
      topic,
      script,
    });
  } catch (error: any) {
    console.error('Episode generation error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to generate script.',
    });
  }
});

// Endpoint: Merge Video with Custom Audio using ffmpeg
app.post('/api/video/render-with-audio', async (req, res) => {
  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'Missing audio data for video merging.' });
    }

    const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');
    const audioBuffer = Buffer.from(cleanBase64, 'base64');

    const timestamp = Date.now();
    const assetsDir = path.resolve(__dirname, 'public/assets/aistudio');
    const tempAudioPath = path.join(assetsDir, `temp_voice_${timestamp}.wav`);
    const outputVideoFilename = `lion_with_voice_${timestamp}.mp4`;
    const outputVideoPath = path.join(assetsDir, outputVideoFilename);
    const sourceVideoPath = path.join(assetsDir, 'VID-20261106-WA0057_1__fae7bb56.mp4');

    if (!fs.existsSync(sourceVideoPath)) {
      return res.status(404).json({ success: false, error: 'Source lion video file not found on server.' });
    }

    // Write temp audio WAV
    await fs.promises.writeFile(tempAudioPath, audioBuffer);

    // Run ffmpeg: loop video if needed, replace audio with our generated voice, shortest to audio duration
    const cmd = `ffmpeg -y -stream_loop -1 -i "${sourceVideoPath}" -i "${tempAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "${outputVideoPath}"`;
    await execAsync(cmd);

    // Clean up temporary audio file
    fs.unlink(tempAudioPath, () => {});

    return res.json({
      success: true,
      videoUrl: `/assets/aistudio/${outputVideoFilename}`,
      filename: outputVideoFilename,
    });
  } catch (err: any) {
    console.error('Video rendering error:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to render video with audio' });
  }
});

// Mount Vite or static server
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`THE VOICE Narrator Studio server listening on port ${port}`);
  });
}

startServer();
