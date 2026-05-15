// מילות שירים דרך Gemini API – לפי שם שיר + אמן (ללא הורדת אודיו)
const https = require("https");
const fs = require("fs");
const path = require("path");

const GEMINI_KEY = process.env.GEMINI_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

const TRANSCRIPTS_DIR = path.join(__dirname, "data", "transcripts");

// כמה שירים לחפש בכל ריצה
const MAX_PER_RUN = 10;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function geminiRequest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(GEMINI_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 60000,
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// תמלול שיר ישירות מסרטון YouTube דרך Gemini
async function fetchLyrics(videoId, title, artist) {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  if (fs.existsSync(transcriptPath)) {
    const cached = JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
    if (cached.lyrics) return cached;
    // אם זה placeholder ישן (ללא lyrics), ננסה שוב רק אם עברו 7 ימים
    if (cached.transcribedAt) {
      const age = Date.now() - new Date(cached.transcribedAt).getTime();
      if (age < 4 * 3600 * 1000) return null;
    }
  }

  if (!GEMINI_KEY) return null;
  ensureDir(TRANSCRIPTS_DIR);

  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`    🎤 Gemini transcribe: ${title} - ${artist || "?"}`);

  try {
    // Gemini 2.0 Flash יכול לעבד YouTube URLs ישירות
    const result = await geminiRequest({
      contents: [{
        parts: [
          {
            fileData: {
              mimeType: "video/*",
              fileUri: ytUrl,
            }
          },
          {
            text: `Transcribe the song lyrics from this music video.

Instructions:
1. Write ONLY the song lyrics, no explanations, timestamps, or notes.
2. Separate verses with an empty line.
3. If the song is in English, write the English lyrics first, then add a section "--- תרגום לעברית ---" with a full Hebrew translation.
4. If the song is in Hebrew/Aramaic, write only the lyrics as-is.
5. If there are mixed Hebrew and English parts, transcribe all and translate only the English parts.
6. If this is not a song or has no discernible lyrics (instrumental, etc.), respond with exactly: INSTRUMENTAL`
          }
        ]
      }]
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    // בדיקה אם Gemini החזיר שגיאה
    if (result?.error) {
      console.log(`    ⚠ Gemini API error: ${result.error.message || JSON.stringify(result.error).slice(0, 100)}`);
      return null;
    }

    if (!text || text.trim() === "INSTRUMENTAL" || text.length < 20) {
      console.log(`    ⚠ Gemini: אין מילים (instrumental / לא ניתן לתמלל)`);
      const empty = { videoId, title, artist, lyrics: null, language: null, transcribedAt: new Date().toISOString() };
      fs.writeFileSync(transcriptPath, JSON.stringify(empty, null, 2), "utf8");
      return null;
    }

    const hasHebrew = /[\u0590-\u05FF]/.test(text);
    const hasTranslation = text.includes("תרגום לעברית");
    const lang = hasHebrew && !hasTranslation ? "he" : "en";

    const transcript = {
      videoId,
      title: title || "",
      artist: artist || "",
      lyrics: text.trim(),
      language: lang,
      hasTranslation,
      transcribedAt: new Date().toISOString(),
    };

    fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf8");
    console.log(`    ✅ תמלול הושלם: ${title} (${lang})`);
    return transcript;
  } catch (e) {
    console.log(`    ⚠ Gemini error: ${e.message.slice(0, 150)}`);
    return null;
  }
}

// חיפוש מילות שירים עבור batch
async function transcribeNewSongs(songs) {
  if (!GEMINI_KEY) {
    console.log("    ⚠ GEMINI_KEY לא מוגדר – מדלג על תמלול");
    return [];
  }

  let count = 0;
  let consecutiveErrors = 0;
  const results = [];

  for (const song of songs) {
    if (count >= MAX_PER_RUN) {
      console.log(`    ⏱ הגבלת ${MAX_PER_RUN} שירים בריצה`);
      break;
    }
    // אם 3 שגיאות רצופות – API כנראה חסום, נפסיק
    if (consecutiveErrors >= 3) {
      console.log("    ⚠ Gemini API חסום/לא זמין – מפסיק תמלול");
      break;
    }

    const existing = path.join(TRANSCRIPTS_DIR, `${song.videoId}.json`);
    if (fs.existsSync(existing)) continue;

    const result = await fetchLyrics(song.videoId, song.title, song.artist);
    if (result) {
      results.push(result);
      consecutiveErrors = 0;
    } else {
      consecutiveErrors++;
    }
    count++;
    await sleep(1000); // rate limiting
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
      if (data.lyrics) transcripts[data.videoId] = data;
    } catch {}
  }
  return transcripts;
}

module.exports = { fetchLyrics, transcribeNewSongs, loadAllTranscripts };
