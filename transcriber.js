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
      timeout: 30000,
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

// חיפוש מילות שיר לפי שם + אמן דרך Gemini
async function fetchLyrics(videoId, title, artist) {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, `${videoId}.json`);
  if (fs.existsSync(transcriptPath)) {
    return JSON.parse(fs.readFileSync(transcriptPath, "utf8"));
  }

  if (!GEMINI_KEY) return null;
  ensureDir(TRANSCRIPTS_DIR);

  console.log(`    🎤 Gemini lyrics: ${title} - ${artist || "?"}`);

  try {
    const prompt = `Find the lyrics for this Jewish/Hasidic song:
Title: "${title}"
Artist: ${artist || "Unknown"}

Instructions:
1. Write ONLY the song lyrics, no explanations or notes.
2. Separate verses with an empty line.
3. If the song is in English, write the English lyrics first, then add a section "--- תרגום לעברית ---" with a full Hebrew translation.
4. If the song is in Hebrew/Aramaic, write only the lyrics.
5. If you have mixed Hebrew and English parts, transcribe all and translate only the English parts.
6. If you don't know this specific song, respond with exactly: UNKNOWN
7. Do NOT make up lyrics. Only provide them if you know the actual song.`;

    const result = await geminiRequest({
      contents: [{ parts: [{ text: prompt }] }],
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || text.trim() === "UNKNOWN" || text.length < 20) {
      console.log(`    ⚠ Gemini: שיר לא ידוע`);
      // שומר placeholder כדי לא לנסות שוב
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
    console.log(`    ✅ מילים נמצאו: ${title} (${lang})`);
    return transcript;
  } catch (e) {
    console.log(`    ⚠ Gemini error: ${e.message.slice(0, 100)}`);
    return null;
  }
}

// חיפוש מילות שירים עבור batch
async function transcribeNewSongs(songs) {
  let count = 0;
  const results = [];

  for (const song of songs) {
    if (count >= MAX_PER_RUN) {
      console.log(`    ⏱ הגבלת ${MAX_PER_RUN} שירים בריצה`);
      break;
    }

    const existing = path.join(TRANSCRIPTS_DIR, `${song.videoId}.json`);
    if (fs.existsSync(existing)) continue;

    const result = await fetchLyrics(song.videoId, song.title, song.artist);
    if (result) results.push(result);
    count++;
    await sleep(500); // rate limiting
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
