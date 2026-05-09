// סקרייפר YouTube למוזיקה חרדית – גישת YouTube RSS (ללא מפתח API)
// RSS feeds: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cheerio = require("cheerio");

const GITHUB_USER = "tyuibbbbbbbbbbbb";
const GITHUB_REPO = "jewish-music";
const GITHUB_BRANCH = "main";
const IMAGES_DIR = path.join(__dirname, "data", "images");
const STATE_FILE = path.join(__dirname, "data", "yt-state.json");
const CHANNELS_FILE = path.join(__dirname, "data", "yt-channels.json");

// ערוצי YouTube מאומתים – channelId + שם
const KNOWN_CHANNELS = [
  { id: "UCjbMOEelRjGmq09B6we3Kzg", name: "TYH Nation" },
  { id: "UCCPRfaeyaMMNQ-j5t8sTuag", name: "Ishay Ribo" },
  { id: "UC_m-8GjMY4wd6j3MZB9qNIg", name: "Motty Steinmetz" },
  { id: "UCnz1zGPreB0Bx_QB4sV6B6Q", name: "Benny Friedman" },
  { id: "UC-PJH3S2qQGZbNx5n1KaOCQ", name: "Yaakov Shwekey" },
  { id: "UCCwQnaMBJoHl-oR5cxA4xBQ", name: "Avraham Fried" },
  { id: "UC3PW3aLX7jbpBn1MlPU_ZRA", name: "8th Day" },
  { id: "UCJaJUfUIOl3b43Nxujs_gxA", name: "Simcha Leiner" },
  { id: "UC4RwjhjnXVSjbM-IM0sPwYQ", name: "Zusha" },
  { id: "UCS0FMkJ4oSzhQiR_v89CKtg", name: "Miami Boys Choir" },
  { id: "UCfzrhCqCYVb2Jqh9GC5ONWQ", name: "Mordechai Shapiro" },
  { id: "UCC6_WPuAPw2g7M8qzZL1NKg", name: "Shulem Lemmer" },
  { id: "UCxvYG7rPJlbL4FeHq-UCGsA", name: "Ohad Moskowitz" },
  { id: "UCb_PBqH_0N20GDgwZBIWhdQ", name: "Lipa Schmeltzer" },
  { id: "UC7UXRQxB7oBlZoGaBpMmFDw", name: "Levy Falkowitz" },
  { id: "UCWN4v0Y4FW5PHcO2VfksMBQ", name: "Baruch Levine" },
  { id: "UCuQhP2bHJqEBTiicKPlRh1g", name: "Yonatan Razel" },
  { id: "UC6Bd_6k2UZk9vAiLfjSnYnQ", name: "Aharon Razel" },
  { id: "UCn29_jLfYTGZl5Q8Bwnw3vg", name: "Eitan Katz" },
  { id: "UCB0d7KLQWN1EKq3i-6oq4xQ", name: "MBD" },
  { id: "UCVq8-YG22zJgrsGPD4Ci1cA", name: "Ari Goldwag" },
  { id: "UC1FJGf_YkiWUXNcKQzrQ_QQ", name: "Shmueli Ungar" },
  { id: "UCQ2jVSTExbRNQSJjL6N65WA", name: "Beri Weber" },
  { id: "UCQjzNI4CuCY9Ur7VsGNb2bA", name: "Meilech Kohn" },
  { id: "UCsKk1termFVLGxJE-V0TYzA", name: "Dudi Kalish" },
  { id: "UCAbh1Ky87dTg_kH8YcPh2lg", name: "Yosef Karduner" },
  { id: "UC8vgJMwKTPqMqoL_Wv-bwCw", name: "Nachman Filmer" },
  { id: "UC-FXaYSqzNYJSfExsWO-k-g", name: "Zanvil Weinberger" },
  { id: "UCpTe-F9-39tXCFcxGukKvuw", name: "Isaac Honig" },
  { id: "UCaYJnG9CxBkV-6ypvH_r6JA", name: "Yoni Z" },
];

// כמה ערוצים לבדוק בכל ריצה (רוטציה)
const CHANNELS_PER_RUN = 15;

function hash(s) {
  return crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
}

function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : require("http");
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JewishMusic/1.0)" },
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

// שליפת סרטונים מ-RSS של ערוץ YouTube
async function getChannelRSS(channelId, channelName) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try {
    const buffer = await httpGet(url);
    const xml = buffer.toString("utf8");
    const $ = cheerio.load(xml, { xmlMode: true });

    const videos = [];
    $("entry").each((i, el) => {
      if (i >= 5) return false; // מקסימום 5 סרטונים אחרונים
      const $el = $(el);
      const videoId = $el.find("yt\\:videoId, videoId").text();
      const title = $el.find("title").text();
      const published = $el.find("published").text();
      const thumb = $el.find("media\\:thumbnail, thumbnail").attr("url") || "";

      if (videoId) {
        videos.push({ videoId, title, channelName, channelId, publishedAt: published, thumbnail: thumb });
      }
    });
    return videos;
  } catch (e) {
    console.log(`  ⚠ RSS error for ${channelName}: ${e.message}`);
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
    const buffer = await httpGet(thumbnailUrl, 10000);
    if (buffer.length > 500) {
      fs.writeFileSync(filepath, buffer);
      return `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/images/${filename}`;
    }
  } catch (e) {
    console.log(`  ⚠ Thumbnail error: ${e.message}`);
  }
  return thumbnailUrl;
}

// טעינת/שמירת state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  return { lastIndex: 0, lastRun: null, seenVideoIds: [] };
}

function saveState(state) {
  if (!fs.existsSync(path.dirname(STATE_FILE))) fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  if (state.seenVideoIds.length > 1000) state.seenVideoIds = state.seenVideoIds.slice(-1000);
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// סריקה ראשית
async function scrapeYouTube() {
  const state = loadState();
  const seen = new Set(state.seenVideoIds || []);

  // בחירת batch של ערוצים (רוטציה)
  const startIdx = state.lastIndex % KNOWN_CHANNELS.length;
  const batch = [];
  for (let i = 0; i < CHANNELS_PER_RUN && i < KNOWN_CHANNELS.length; i++) {
    batch.push(KNOWN_CHANNELS[(startIdx + i) % KNOWN_CHANNELS.length]);
  }

  console.log(`  🎵 YouTube RSS: batch ${startIdx}..${startIdx + batch.length} (${batch.length} ערוצים)`);

  const allVideos = [];
  for (const ch of batch) {
    const videos = await getChannelRSS(ch.id, ch.name);
    allVideos.push(...videos);
    await sleep(100);
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
    const thumbUrl = await downloadThumbnail(v.thumbnail);

    items.push({
      id: hash(v.videoId),
      videoId: v.videoId,
      title: v.title,
      artist: v.channelName,
      channel: v.channelName,
      link: `https://www.youtube.com/watch?v=${v.videoId}`,
      thumbnail: thumbUrl,
      description: "",
      publishedAt: v.publishedAt,
      isNew,
    });
  }

  // עדכון state
  state.lastIndex = (startIdx + CHANNELS_PER_RUN) % KNOWN_CHANNELS.length;
  state.lastRun = new Date().toISOString();
  state.seenVideoIds = [...seen];
  saveState(state);

  return items;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { scrapeYouTube };
