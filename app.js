// Frontend – Jewish Music Hub
const DATA_URL = "https://raw.githubusercontent.com/tyuibbbbbbbbbbbb/jewish-music/main/data/songs.json";

let allSongs = [];
let activeFilter = "all";
let searchQuery = "";

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function relTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `לפני ${mins} דקות`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שעות`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

// יצירת כרטיס שיר
function createSongCard(song) {
  const card = document.createElement("div");
  card.className = "song-card";
  card.dataset.videoId = song.videoId;

  const thumbSrc = song.thumbnail || "";
  const isNew = song.isNew;
  const hasLyrics = song.hasTranscript;
  const time = relTime(song.publishedAt || song.firstSeen);

  card.innerHTML = `
    <div class="song-thumb" onclick="playVideo(this, '${escapeHtml(song.videoId)}')">
      ${isNew ? '<span class="new-badge">חדש!</span>' : ''}
      <img src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="play-overlay">▶</div>
    </div>
    <div class="song-info">
      <div class="song-title">${escapeHtml(song.title)}</div>
      <div class="song-artist">${escapeHtml(song.artist || song.channel)}</div>
      <div class="song-meta">
        <span>${time}</span>
        ${hasLyrics ? '<span>📝 יש תמלול</span>' : '<span style="opacity:0.4">⏳ ממתין לתמלול</span>'}
      </div>
    </div>
    <div class="song-actions">
      <a href="https://www.youtube.com/watch?v=${escapeHtml(song.videoId)}" target="_blank" class="btn">🔗 YouTube</a>
      ${hasLyrics
        ? `<button class="btn btn-accent" onclick="showLyrics('${escapeHtml(song.videoId)}')">📝 תמלול</button>`
        : `<button class="btn btn-disabled" disabled>⏳ תמלול בקרוב</button>`
      }
    </div>
  `;

  return card;
}

// הפעלת סרטון (הטמעה באתר)
function playVideo(thumbEl, videoId) {
  // החלפת thumbnail ב-iframe
  thumbEl.innerHTML = `<iframe class="yt-embed" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" 
    allow="accelerometer;autoplay;encrypted-media;gyroscope;picture-in-picture" 
    allowfullscreen></iframe>`;
  thumbEl.onclick = null;
}

// הצגת תמלול במודל
function showLyrics(videoId) {
  const song = allSongs.find(s => s.videoId === videoId);
  if (!song || !song.lyrics) return;

  document.getElementById("modal-title").textContent = song.title;
  document.getElementById("modal-artist").textContent = song.artist || song.channel;

  const lyricsEl = document.getElementById("modal-lyrics");

  // בדיקה אם יש תרגום
  if (song.hasTranslation && song.lyrics.includes("תרגום לעברית")) {
    const parts = song.lyrics.split(/---\s*תרגום לעברית\s*---/);
    lyricsEl.innerHTML = `
      <div style="direction:ltr;text-align:left">${escapeHtml(parts[0].trim())}</div>
      <div class="translation">
        <strong>🔄 תרגום לעברית:</strong><br><br>
        ${escapeHtml((parts[1] || "").trim())}
      </div>
    `;
  } else {
    lyricsEl.textContent = song.lyrics;
  }

  document.getElementById("lyrics-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("lyrics-modal").classList.add("hidden");
}

// סינון + חיפוש
function filterSongs() {
  const q = searchQuery.toLowerCase();
  return allSongs.filter(song => {
    // סינון לפי קטגוריה
    if (activeFilter === "new" && !song.isNew) return false;
    if (activeFilter === "transcribed" && !song.hasTranscript) return false;

    // חיפוש
    if (q) {
      const text = `${song.title} ${song.artist} ${song.channel} ${song.description}`.toLowerCase();
      return text.includes(q);
    }
    return true;
  });
}

function render() {
  const grid = document.getElementById("songs-grid");
  const filtered = filterSongs();

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">🎵</div><p>לא נמצאו שירים${searchQuery ? ' עבור "' + escapeHtml(searchQuery) + '"' : ''}</p></div>`;
    return;
  }

  grid.innerHTML = "";
  for (const song of filtered) {
    grid.appendChild(createSongCard(song));
  }
}

function renderFilters() {
  const total = allSongs.length;
  const newCount = allSongs.filter(s => s.isNew).length;
  const transcribedCount = allSongs.filter(s => s.hasTranscript).length;

  const filters = [
    { id: "all", label: `🎵 הכל (${total})` },
    { id: "new", label: `🆕 חדשים (${newCount})` },
    { id: "transcribed", label: `📝 מתומללים (${transcribedCount})` },
  ];

  document.getElementById("filters").innerHTML = filters.map(f =>
    `<button class="filter-btn ${activeFilter === f.id ? 'active' : ''}" onclick="setFilter('${f.id}')">${f.label}</button>`
  ).join("");
}

function setFilter(id) {
  activeFilter = id;
  renderFilters();
  render();
}

function updateStats() {
  const el = document.getElementById("stats");
  const transcribed = allSongs.filter(s => s.hasTranscript).length;
  el.textContent = `${allSongs.length} שירים | ${transcribed} מתומללים`;
}

async function loadData() {
  try {
    const res = await fetch(DATA_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    allSongs = data.songs || [];
    updateStats();
    renderFilters();
    render();
  } catch (e) {
    document.getElementById("songs-grid").innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <p>שגיאה בטעינת נתונים</p>
        <p style="font-size:0.8rem;margin-top:8px">${escapeHtml(e.message)}</p>
      </div>`;
  }
}

// חיפוש עם debounce
let searchTimeout;
document.getElementById("search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = e.target.value.trim();
    render();
  }, 200);
});

// סגירת מודל עם ESC
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// סגירת מודל בלחיצה על הרקע
document.getElementById("lyrics-modal").addEventListener("click", (e) => {
  if (e.target.id === "lyrics-modal") closeModal();
});

// טעינה ראשונית + רענון כל 5 דקות
loadData();
setInterval(loadData, 5 * 60 * 1000);
