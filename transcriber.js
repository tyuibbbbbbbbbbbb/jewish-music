// תמלול שירים דרך Gemini API + תרגום אנגלית לעברית
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GEMINI_KEY = process.env.GEMINI_KEY || "AIzaSyB52wOQveTGV3L4yaTVB4yeBq58R463TCo";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

const AUDIO_DIR = path.join(__dirname, "data", "audio");
const TRANSCRIPTS_DIR = path.join(__dirname, "data", "transcripts");

// כמה שירים לתמלל בכל ריצה (הגבלת זמן)
const MAX_TRANSCRIPTIONS_PER_RUN = 5;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// הורדת אודיו מיוטיוב דרך yt-dlp
function downloadAudio(videoId) {
  ensureDir(AUDIO_DIR);
  const outPath = path.join(AUDIO_DIR, `${videoId}.opus`);
  if (fs.existsSync(outPath)) return outPath;

  try {
    console.log(`    🔽 מוריד אודיו: ${videoId}`);
    execSync(
      `yt-dlp -x --audio-format opus --audio-quality 5 -o "${outPath}" "https://www.youtube.com/watch?v=${videoId}"`,
      { timeout: 60000, stdio: "pipe" }
    );
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return outPath;
  } catch (e) {
    console.log(`    ⚠ שגיאה בהורדת אודיו ${videoId}: ${e.message.slice(0, 100)}`);
  }
  // ניסיון עם פורמט אחר
  const outMp3 = path.join(AUDIO_DIR, `${videoId}.mp3`);
  try {
    execSync(
      `yt-dlp -x --audio-format mp3 --audio-quality 9 -o "${outMp3}" "https://www.youtube.com/watch?v=${videoId}"`,
      { timeout: 60000, stdio: "pipe" }
    );
    if (fs.existsSync(outMp3) && fs.statSync(outMp3).size > 1000) return outMp3;
  } catch {}
  return null;
}

// שליחת אודיו ל-Gemini API
function geminiRequest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(GEMINI_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 120000,
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Invalid JSON from Gemini: " + body.slice(0, 300))); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Gemini timeout")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// תמלול שיר בודד
async function transcribeSong(videoId, title) {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  if (fs.existsSync(transcriptPath)) {
    console.log(`    ✓ תמלול קיים: ${videoId}`);
    return JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
  }

  ensureDir(TRANSCRIPTS_DIR);

  // הורדת אודיו
  const audioPath = downloadAudio(videoId);
  if (!audioPath) return null;

  // בדיקת גודל (מקסימום 10MB לשליחה ל-Gemini)
  const stats = fs.statSync(audioPath);
  if (stats.size > 10 * 1024 * 1024) {
    console.log(`    ⚠ קובץ אודיו גדול מדי (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
    cleanup(audioPath);
    return null;
  }

  // המרה ל-base64
  const audioBuffer = fs.readFileSync(audioPath);
  const base64Audio = audioBuffer.toString("base64");
  const mimeType = audioPath.endsWith(".mp3") ? "audio/mpeg" : "audio/ogg";

  console.log(`    🤖 שולח ל-Gemini לתמלול: ${title || videoId}`);

  try {
    const result = await geminiRequest({
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            }
          },
          {
            text: `תמלל את מילות השיר הזה (lyrics transcription).
הוראות:
1. כתוב רק את מילות השיר, ללא הסברים או הערות.
2. הפרד בין בתים עם שורה ריקה.
3. אם השיר באנגלית, כתוב קודם את המילים באנגלית, ואחר כך הוסף סעיף "--- תרגום לעברית ---" עם תרגום מלא לעברית.
4. אם השיר בעברית/ארמית, כתוב רק את המילים.
5. אם יש חלקים באנגלית וחלקים בעברית, תמלל הכל ותרגם רק את החלקים באנגלית.
6. אם אתה לא בטוח במילה, כתוב [?] לידה.`
          }
        ]
      }]
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.log(`    ⚠ Gemini לא החזיר תוצאה`);
      cleanup(audioPath);
      return null;
    }

    // זיהוי שפה
    const hasHebrew = /[\u0590-\u05FF]/.test(text);
    const hasTranslation = text.includes("תרגום לעברית");
    const lang = hasHebrew && !hasTranslation ? "he" : "en";

    const transcript = {
      videoId,
      title: title || "",
      lyrics: text,
      language: lang,
      hasTranslation,
      transcribedAt: new Date().toISOString(),
    };

    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
    console.log(`    ✅ תמלול הושלם: ${title || videoId} (${lang})`);

    cleanup(audioPath);
    return transcript;
  } catch (e) {
    console.log(`    ⚠ Gemini error: ${e.message}`);
    cleanup(audioPath);
    return null;
  }
}

function cleanup(audioPath) {
  try { if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
}

// תמלול batch של שירים חדשים
async function transcribeNewSongs(songs) {
  let count = 0;
  const results = [];

  for (const song of songs) {
    if (count >= MAX_TRANSCRIPTIONS_PER_RUN) {
      console.log(`    ⏱ הגבלת ${MAX_TRANSCRIPTIONS_PER_RUN} תמלולים בריצה`);
      break;
    }

    const existing = path.join(TRANSCRIPTS_DIR, `${song.videoId}.json`);
    if (fs.existsSync(existing)) continue;

    const result = await transcribeSong(song.videoId, song.title);
    if (result) results.push(result);
    count++;
  }

  return results;
}

// טעינת כל התמלולים הקיימים
function loadAllTranscripts() {
  const transcripts = {};
  ensureDir(TRANSCRIPTS_DIR);
  for (const file of fs.readdirSync(TRANSCRIPTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), "utf8"));
      transcripts[data.videoId] = data;
    } catch {}
  }
  return transcripts;
}

module.exports = { transcribeSong, transcribeNewSongs, loadAllTranscripts };
