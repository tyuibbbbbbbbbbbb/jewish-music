// סקרייפר YouTube למוזיקה חרדית – חיפוש HTTP ישיר (ללא API/yt-dlp)
// מפרסר את ytInitialData מדף חיפוש YouTube
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ARTISTS = require("./artists");

const GITHUB_USER = "tyuibbbbbbbbbbbb";
const GITHUB_REPO = "jewish-music";
const GITHUB_BRANCH = "main";
const IMAGES_DIR = path.join(__dirname, "data", "images");
const STATE_FILE = path.join(__dirname, "data", "yt-state.json");

const ARTISTS_PER_RUN = 8;
const RESULTS_PER_SEARCH = 5;

const BROAD_QUERIES = [
  "jewish hasidic music new 2026",
  "מוזיקה חרדית שיר חדש",
];

function hash(s) {
  return crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
}

function httpGetText(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
        "Accept": "text/html,application/xhtml+xml",
      },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetText(res.headers.location, timeout).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

function httpGetBuffer(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetBuffer(res.headers.location, timeout).then(resolve, reject);
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

// חיפוש ביוטיוב דרך פרסינג HTML (מהיר, בלי API)
async function searchYouTube(query, maxResults = RESULTS_PER_SEARCH) {
  try {
    const q = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${q}&sp=EgIQAQ%253D%253D`; // sp = Videos filter
    const html = await httpGetText(url);

    // חיפוש ytInitialData בתוך ה-HTML
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!match) {
      // ניסיון חלופי
      const match2 = html.match(/ytInitialData"\s*>\s*(\{.+?\})\s*<\/script>/s);
      if (!match2) {
        console.log(`  ⚠ No ytInitialData found for "${query}"`);
        return [];
      }
      return parseYTData(JSON.parse(match2[1]), maxResults);
    }
    return parseYTData(JSON.parse(match[1]), maxResults);
  } catch (e) {
    console.log(`  ⚠ YouTube search error for "${query}": ${e.message.slice(0, 120)}`);
    return [];
  }
}

function parseYTData(data, maxResults) {
  const videos = [];
  try {
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents || [];

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (!vr || !vr.videoId) continue;

        // סינון: דילוג על שידורים חיים
        if (vr.badges?.some(b => b?.metadataBadgeRenderer?.label === "LIVE")) continue;

        // משך בשניות (אם זמין)
        let duration = 0;
        const durText = vr.lengthText?.simpleText || "";
        if (durText) {
          const parts = durText.split(":").map(Number);
          if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) duration = parts[0] * 60 + parts[1];
        }

        // סינון: 30s-20min
        if (duration > 0 && (duration < 30 || duration > 1200)) continue;

        const thumb = vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";

        videos.push({
          videoId: vr.videoId,
          title: vr.title?.runs?.map(r => r.text).join("") || "",
          channel: vr.ownerText?.runs?.map(r => r.text).join("") || "",
          publishedAt: vr.publishedTimeText?.simpleText || "",
          thumbnail: thumb,
          duration,
        });

        if (videos.length >= maxResults) break;
      }
      if (videos.length >= maxResults) break;
    }
  } catch (e) {
    console.log(`  ⚠ Parse error: ${e.message}`);
  }
  return videos;
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
    const buffer = await httpGetBuffer(url);
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// סריקה ראשית
async function scrapeYouTube() {
  const state = loadState();
  const seen = new Set(state.seenVideoIds || []);

  const startIdx = state.lastIndex % ARTISTS.length;
  const batch = [];
  for (let i = 0; i < ARTISTS_PER_RUN && i < ARTISTS.length; i++) {
    batch.push(ARTISTS[(startIdx + i) % ARTISTS.length]);
  }

  console.log(`  🎵 YouTube HTTP: batch ${startIdx}..${startIdx + batch.length} (${batch.length} אמנים) + ${BROAD_QUERIES.length} כלליים`);

  const allVideos = [];

  // חיפושים כלליים
  for (const q of BROAD_QUERIES) {
    const results = await searchYouTube(q, 5);
    allVideos.push(...results.map(r => ({ ...r, artist: "" })));
    await sleep(500);
  }

  // חיפוש לפי אמן
  for (const artist of batch) {
    const query = `${artist.searchName} official music`;
    const results = await searchYouTube(query, RESULTS_PER_SEARCH);
    allVideos.push(...results.map(r => ({ ...r, artist: artist.name })));
    await sleep(500);
  }

  // סינון כפילויות
  const unique = [];
  const videoIds = new Set();
  for (const v of allVideos) {
    if (!v.videoId || videoIds.has(v.videoId)) continue;
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

    items.push({
      id: hash(v.videoId),
      videoId: v.videoId,
      title: v.title,
      artist: v.artist || v.channel,
      channel: v.channel,
      link: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: thumbUrl,
      description: "",
      publishedAt: v.publishedAt || "",
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
