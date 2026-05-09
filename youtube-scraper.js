// סקרייפר YouTube למוזיקה חרדית – YouTube Data API v3 Search
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ARTISTS = require("./artists");

const API_KEY = process.env.YT_API_KEY || "AIzaSyB52wOQveTGV3L4yaTVB4yeBq58R463TCo";
const GITHUB_USER = "tyuibbbbbbbbbbbb";
const GITHUB_REPO = "jewish-music";
const GITHUB_BRANCH = "main";
const IMAGES_DIR = path.join(__dirname, "data", "images");
const STATE_FILE = path.join(__dirname, "data", "yt-state.json");

// כמה אמנים לחפש בכל ריצה (שמירה על quota)
const ARTISTS_PER_RUN = 8;
// תוצאות לכל חיפוש
const RESULTS_PER_SEARCH = 5;

function hash(s) {
  return crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
}

function apiGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "JewishMusic/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return apiGet(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON: " + data.slice(0, 200))); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    lib.get(url, { headers: { "User-Agent": "JewishMusic/1.0" }, timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("timeout", () => reject(new Error("timeout"))).on("error", reject);
  });
}

// טעינת מצב (איזה אמנים נבדקו לאחרונה)
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { lastIndex: 0, lastRun: null, seenVideoIds: [] };
}

function saveState(state) {
  if (!fs.existsSync(path.dirname(STATE_FILE))) fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // שמירה על רשימת seenVideoIds מוגבלת ל-500
  if (state.seenVideoIds.length > 500) state.seenVideoIds = state.seenVideoIds.slice(-500);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// חיפוש סרטוני YouTube לפי שאילתה
async function searchYouTube(query, maxResults = RESULTS_PER_SEARCH) {
  const q = encodeURIComponent(query);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=${maxResults}&order=date&q=${q}&key=${API_KEY}`;

  try {
    const data = await apiGet(url);
    if (data.error) {
      console.log(`  ⚠ YouTube API error: ${data.error.message}`);
      return [];
    }
    if (!data.items) return [];
    return data.items.map(item => ({
      videoId: item.id.videoId,
      title: item.snippet.title || "",
      channelTitle: item.snippet.channelTitle || "",
      publishedAt: item.snippet.publishedAt || "",
      thumbnail: item.snippet.thumbnails?.high?.url ||
                 item.snippet.thumbnails?.medium?.url ||
                 item.snippet.thumbnails?.default?.url || "",
      description: (item.snippet.description || "").slice(0, 200),
    }));
  } catch (e) {
    console.log(`  ⚠ YouTube search error for "${query}": ${e.message}`);
    return [];
  }
}

// הורדת thumbnail לריפו
async function downloadThumbnail(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  try {
    const filename = hash(thumbnailUrl) + ".jpg";
    const filepath = path.join(IMAGES_DIR, filename);
    if (fs.existsSync(filepath)) {
      return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/images/${filename}`;
    }
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    const buffer = await downloadFile(thumbnailUrl);
    if (buffer.length > 500) {
      fs.writeFileSync(filepath, buffer);
      return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/images/${filename}`;
    }
  } catch (e) {
    console.log(`  ⚠ Thumbnail download error: ${e.message}`);
  }
  return thumbnailUrl;
}

// סריקה ראשית
async function scrapeYouTube() {
  const state = loadState();
  const seen = new Set(state.seenVideoIds || []);

  // בחירת batch של אמנים לחיפוש (רוטציה)
  const startIdx = state.lastIndex % ARTISTS.length;
  const batch = [];
  for (let i = 0; i < ARTISTS_PER_RUN && i < ARTISTS.length; i++) {
    batch.push(ARTISTS[(startIdx + i) % ARTISTS.length]);
  }

  // חיפוש כללי של מוזיקה חרדית חדשה (תמיד)
  const broadQueries = ["jewish hasidic music new song 2026", "שיר חדש מוזיקה חרדית"];

  console.log(`  🎵 YouTube: חוצה batch ${startIdx}-${startIdx + batch.length} (${batch.length} אמנים) + ${broadQueries.length} חיפושים כלליים`);

  const allVideos = [];

  // חיפושים כלליים
  for (const q of broadQueries) {
    const results = await searchYouTube(q);
    allVideos.push(...results);
    await sleep(200);
  }

  // חיפוש לפי אמן
  for (const artist of batch) {
    const query = `${artist.searchName} official music`;
    const results = await searchYouTube(query, 3);
    for (const r of results) {
      r.artistName = artist.name;
    }
    allVideos.push(...results);
    await sleep(200);
  }

  // סינון כפילויות
  const unique = [];
  const videoIds = new Set();
  for (const v of allVideos) {
    if (!v.videoId || videoIds.has(v.videoId)) continue;
    videoIds.add(v.videoId);
    unique.push(v);
  }

  console.log(`  🎵 YouTube: ${unique.length} סרטונים ייחודיים (${unique.filter(v => !seen.has(v.videoId)).length} חדשים)`);

  // הורדת thumbnails ובניית פריטים
  const items = [];
  for (const v of unique) {
    const isNew = !seen.has(v.videoId);
    seen.add(v.videoId);

    const thumbUrl = await downloadThumbnail(v.thumbnail);

    items.push({
      id: hash(v.videoId),
      videoId: v.videoId,
      title: v.title,
      artist: v.artistName || v.channelTitle,
      channel: v.channelTitle,
      link: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: thumbUrl,
      description: v.description,
      publishedAt: v.publishedAt,
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { scrapeYouTube };
