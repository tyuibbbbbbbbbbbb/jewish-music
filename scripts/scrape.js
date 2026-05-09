// סקריפט ראשי – רץ ב-GitHub Actions: סורק YouTube, מתמלל, ושומר ל-data/songs.json
const fs = require("fs");
const path = require("path");
const { scrapeYouTube } = require("../youtube-scraper");
const { transcribeNewSongs, loadAllTranscripts } = require("../transcriber");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "songs.json");

function loadJson(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("שגיאה בטעינת", p, ":", e.message);
  }
  return fallback;
}

(async () => {
  console.log("=== Jewish Music Scanner ===");
  console.log(new Date().toISOString());

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const errors = [];
  let songs = [];

  // === שלב 1: סריקת YouTube ===
  try {
    console.log("\n📺 שלב 1: סריקת YouTube...");
    songs = await scrapeYouTube();
    console.log(`  ✓ נמצאו ${songs.length} שירים`);
  } catch (e) {
    console.error(`  ✗ YouTube: ${e.message}`);
    errors.push({ source: "YouTube", error: e.message });
  }

  // === שלב 2: תמלול שירים חדשים ===
  try {
    console.log("\n🎤 שלב 2: תמלול שירים חדשים...");
    const newSongs = songs.filter(s => s.isNew);
    if (newSongs.length > 0) {
      const transcripts = await transcribeNewSongs(newSongs);
      console.log(`  ✓ תומללו ${transcripts.length} שירים`);
    } else {
      console.log("  ⏭ אין שירים חדשים לתמלול");
    }
  } catch (e) {
    console.error(`  ✗ תמלול: ${e.message}`);
    errors.push({ source: "Transcriber", error: e.message });
  }

  // === שלב 3: טעינת כל התמלולים ושילוב עם השירים ===
  const allTranscripts = loadAllTranscripts();
  for (const song of songs) {
    if (allTranscripts[song.videoId]) {
      song.hasTranscript = true;
      song.lyrics = allTranscripts[song.videoId].lyrics;
      song.language = allTranscripts[song.videoId].language;
      song.hasTranslation = allTranscripts[song.videoId].hasTranslation;
    }
  }

  // === שלב 4: מיזוג עם נתונים קודמים ===
  const prev = loadJson(OUT_FILE, { songs: [] });
  const existingMap = new Map();
  for (const s of prev.songs || []) existingMap.set(s.videoId, s);

  // עדכון קיימים + הוספת חדשים
  for (const song of songs) {
    const existing = existingMap.get(song.videoId);
    if (existing) {
      // שמירה על תמלולים קיימים
      if (!song.hasTranscript && existing.hasTranscript) {
        song.hasTranscript = existing.hasTranscript;
        song.lyrics = existing.lyrics;
        song.language = existing.language;
        song.hasTranslation = existing.hasTranslation;
      }
      song.firstSeen = existing.firstSeen;
    } else {
      song.firstSeen = new Date().toISOString();
    }
    existingMap.set(song.videoId, song);
  }

  // שמירה על שירים ישנים שלא נמצאו בריצה הזו (עד 200)
  const allSongs = [...existingMap.values()]
    .sort((a, b) => new Date(b.publishedAt || b.firstSeen) - new Date(a.publishedAt || a.firstSeen))
    .slice(0, 200);

  const out = {
    generatedAt: new Date().toISOString(),
    totalSongs: allSongs.length,
    totalTranscribed: allSongs.filter(s => s.hasTranscript).length,
    songs: allSongs,
    errors,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✅ נשמרו ${allSongs.length} שירים (${out.totalTranscribed} מתומללים), ${errors.length} שגיאות.`);
})().catch((e) => {
  console.error("שגיאה כללית:", e);
  process.exit(1);
});
