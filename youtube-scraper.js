// סקרייפר YouTube למוזיקה חרדית – דרך yt-dlp search (ללא מפתח API)
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const ARTISTS = require("./artists");

const GITHUB_USER = "tyuibbbbbbbbbbbb";
const GITHUB_REPO = "jewish-music";
const GITHUB_BRANCH = "main";
const IMAGES_DIR = path.join(__dirname, "data", "images");
const STATE_FILE = path.join(__dirname, "data", "yt-state.json");

// כמה אמנים לחפש בכל ריצה (רוטציה)
const ARTISTS_PER_RUN = 5;
// תוצאות לכל חיפוש
const RESULTS_PER_SEARCH = 3;

// שאילתות כלליות שרצות תמיד
const BROAD_QUERIES = [
  "jewish hasidic music new song 2026",
];

function hash(s) {
  return crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
}

// חיפוש ביוטיוב דרך yt-dlp (ללא API key)
function ytdlpSearch(query, maxResults = RESULTS_PER_SEARCH) {
  try {
    const cmd = `yt-dlp --flat-playlist --no-warnings -j "ytsearch${maxResults}:${query.replace(/"/g, '\\"')}"`;
    const output = execSync(cmd, { timeout: 30000, maxBuffer: 5 * 1024 * 1024, encoding: "utf8" });
    const lines = output.trim().split("\n").filter(Boolean);
    return lines.map(line => {
      try {
        const d = JSON.parse(line);
        return {
          videoId: d.id || "",
          title: d.title || "",
          channel: d.channel || d.uploader || "",
          uploadDate: d.upload_date || "",
          thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
          duration: d.duration || 0,
        };
      } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    console.log(`  ⚠ yt-dlp search error for "${query}": ${e.message.slice(0, 100)}`);
    return [];
  }
}

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

// הורדת thumbnail לריפו
async function downloadThumbnail(videoId, thumbnailUrl) {
  if (!thumbnailUrl && !videoId) return null;
  const url = thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const filename = hash(videoId || url) + ".jpg";
    const filepath = path.join(IMAGES_DIR, filename);
    if (fs.existsSync(filepath)) {
      return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/images/${filename}`;
    }
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const buffer = await httpGet(url);
    if (buffer.length > 500) {
      fs.writeFileSync(filepath, buffer);
      return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/images/${filename}`;
    }
  } catch (e) {
    console.log(`  ⚠ Thumbnail error: ${e.message}`);
  }
  return url;
}

// טעינת/שמירת state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { lastIndex: 0, lastRun: null, seenVideoIds: [] };
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (state.seenVideoIds.length > 1000) state.seenVideoIds = state.seenVideoIds.slice(-1000);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// סריקה ראשית
async function scrapeYouTube() {
  const state = loadState();
  const seen = new Set(state.seenVideoIds || []);

  // בחירת batch של אמנים (רוטציה)
  const startIdx = state.lastIndex % ARTISTS.length;
  const batch = [];
  for (let i = 0; i < ARTISTS_PER_RUN && i < ARTISTS.length; i++) {
    batch.push(ARTISTS[(startIdx + i) % ARTISTS.length]);
  }

  console.log(`  🎵 yt-dlp: batch ${startIdx}..${startIdx + batch.length} (${batch.length} אמנים) + ${BROAD_QUERIES.length} כלליים`);

  const allVideos = [];

  // חיפושים כלליים
  for (const q of BROAD_QUERIES) {
    const results = ytdlpSearch(q, 5);
    allVideos.push(...results.map(r => ({ ...r, artist: "" })));
  }

  // חיפוש לפי אמן
  for (const artist of batch) {
    const query = `${artist.searchName} official music video`;
    const results = ytdlpSearch(query, RESULTS_PER_SEARCH);
    allVideos.push(...results.map(r => ({ ...r, artist: artist.name })));
  }

  // סינון כפילויות + סרטונים קצרים מדי (shorts) או ארוכים מדי (שיעורים)
  const unique = [];
  const videoIds = new Set();
  for (const v of allVideos) {
    if (!v.videoId || videoIds.has(v.videoId)) continue;
    if (v.duration && (v.duration < 30 || v.duration > 1200)) continue; // 30s-20min
    videoIds.add(v.videoId);
    unique.push(v);
  }

  console.log(`  🎵 YouTube: ${unique.length} סרטונים (${unique.filter(v => !seen.has(v.videoId)).length} חדשים)`);

  // הורדת thumbnails ובניית items
  const items = [];
  for (const v of unique) {
    const isNew = !seen.has(v.videoId);
    seen.add(v.videoId);
    const thumbUrl = await downloadThumbnail(v.videoId, v.thumbnail);

    // המרת uploadDate מ-YYYYMMDD ל-ISO
    let publishedAt = "";
    if (v.uploadDate && v.uploadDate.length === 8) {
      publishedAt = `${v.uploadDate.slice(0,4)}-${v.uploadDate.slice(4,6)}-${v.uploadDate.slice(6,8)}T00:00:00Z`;
    }

    items.push({
      id: hash(v.videoId),
      videoId: v.videoId,
      title: v.title,
      artist: v.artist || v.channel,
      channel: v.channel,
      link: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: thumbUrl,
      description: "",
      publishedAt,
      isNew,
    });
  }

  // עדכון state
  state.lastIndex = (startIdx + ARTISTS_PER_RUN) % ARTISTS.length;
  state.lastRun = new Date().toISOString();
  state.seenVideoIds = [...seen];
  saveState(state);

  return items;
}

module.exports = { scrapeYouTube };
