// Frontend – Jewish Music Hub – נגן אודיו אחיד
const DATA_URL = "https://raw.githubusercontent.com/tyuibbbbbbbbbbbb/jewish-music/main/data/songs.json";

let allSongs = [];
let activeFilter = "all";
let searchQuery = "";

// === מצב הנגן ===
let ytPlayer = null;
let ytReady = false;
let currentSong = null;
let currentIndex = -1;
let playlist = [];
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0; // 0=off, 1=all, 2=one
let progressInterval = null;
let savedVolume = 80;

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

function formatTime(sec) {
  if (!sec || isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// === YouTube IFrame API ===
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player("yt-player", {
    height: "1",
    width: "1",
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      rel: 0,
    },
    events: {
      onReady: () => {
        ytReady = true;
        ytPlayer.setVolume(savedVolume);
      },
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    },
  });
};

function onPlayerStateChange(event) {
  const state = event.data;
  if (state === YT.PlayerState.PLAYING) {
    isPlaying = true;
    updatePlayBtn();
    startProgressUpdate();
  } else if (state === YT.PlayerState.PAUSED) {
    isPlaying = false;
    updatePlayBtn();
    stopProgressUpdate();
  } else if (state === YT.PlayerState.ENDED) {
    isPlaying = false;
    updatePlayBtn();
    stopProgressUpdate();
    onSongEnded();
  }
}

function onPlayerError(event) {
  console.warn("YouTube player error:", event.data);
  // דילוג לשיר הבא
  setTimeout(() => playNext(), 1500);
}

function onSongEnded() {
  if (repeatMode === 2) {
    // חזרה על אותו שיר
    ytPlayer.seekTo(0);
    ytPlayer.playVideo();
  } else {
    playNext();
  }
}

// === שליטה בנגן ===
function playSong(song, index) {
  if (!ytReady || !song) return;

  currentSong = song;
  currentIndex = index >= 0 ? index : playlist.findIndex(s => s.videoId === song.videoId);

  // טעינת הסרטון (אודיו בלבד – הנגן מוסתר)
  ytPlayer.loadVideoById(song.videoId);

  // עדכון UI
  updatePlayerBar();
  updatePlayingCard();
  document.getElementById("player-bar").classList.remove("hidden");

  // שמירת MediaSession (עבור notification)
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || song.channel,
      artwork: song.thumbnail ? [{ src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => togglePlay());
    navigator.mediaSession.setActionHandler('pause', () => togglePlay());
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrev());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
  }
}

function togglePlay() {
  if (!ytReady || !currentSong) return;
  if (isPlaying) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
}

function playNext() {
  if (playlist.length === 0) return;
  let nextIdx;
  if (isShuffle) {
    nextIdx = Math.floor(Math.random() * playlist.length);
  } else {
    nextIdx = (currentIndex + 1) % playlist.length;
    if (nextIdx === 0 && repeatMode === 0 && currentIndex === playlist.length - 1) {
      // סוף הפלייליסט, לא חוזר
      isPlaying = false;
      updatePlayBtn();
      return;
    }
  }
  playSong(playlist[nextIdx], nextIdx);
}

function playPrev() {
  if (playlist.length === 0) return;
  // אם יותר מ-3 שניות – חזרה לתחילת השיר
  if (ytReady && ytPlayer.getCurrentTime && ytPlayer.getCurrentTime() > 3) {
    ytPlayer.seekTo(0);
    return;
  }
  let prevIdx;
  if (isShuffle) {
    prevIdx = Math.floor(Math.random() * playlist.length);
  } else {
    prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
  }
  playSong(playlist[prevIdx], prevIdx);
}

function setVolume(val) {
  savedVolume = parseInt(val);
  if (ytReady) ytPlayer.setVolume(savedVolume);
  updateVolBtn();
}

function toggleMute() {
  if (!ytReady) return;
  if (ytPlayer.isMuted()) {
    ytPlayer.unMute();
    document.getElementById("volume-slider").value = savedVolume;
  } else {
    ytPlayer.mute();
    document.getElementById("volume-slider").value = 0;
  }
  updateVolBtn();
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById("btn-shuffle").classList.toggle("active", isShuffle);
}

function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  const btn = document.getElementById("btn-repeat");
  btn.classList.toggle("active", repeatMode > 0);
  btn.textContent = repeatMode === 2 ? "🔂" : "🔁";
}

// === עדכון UI ===
function updatePlayerBar() {
  if (!currentSong) return;
  document.getElementById("player-title").textContent = currentSong.title;
  document.getElementById("player-artist").textContent = currentSong.artist || currentSong.channel;
  const thumb = document.getElementById("player-thumb");
  if (currentSong.thumbnail) {
    thumb.src = currentSong.thumbnail;
    thumb.style.display = "";
  } else {
    thumb.style.display = "none";
  }
}

function updatePlayBtn() {
  document.getElementById("btn-play").textContent = isPlaying ? "⏸" : "▶";
}

function updateVolBtn() {
  if (!ytReady) return;
  const muted = ytPlayer.isMuted();
  document.getElementById("btn-vol").textContent = muted ? "🔇" : savedVolume > 50 ? "🔊" : savedVolume > 0 ? "🔉" : "🔇";
}

function updatePlayingCard() {
  document.querySelectorAll(".song-card.playing").forEach(c => c.classList.remove("playing"));
  if (currentSong) {
    const card = document.querySelector(`.song-card[data-video-id="${currentSong.videoId}"]`);
    if (card) card.classList.add("playing");
  }
}

function startProgressUpdate() {
  stopProgressUpdate();
  progressInterval = setInterval(() => {
    if (!ytReady || !ytPlayer.getCurrentTime) return;
    const current = ytPlayer.getCurrentTime();
    const duration = ytPlayer.getDuration();
    if (duration > 0) {
      const pct = (current / duration) * 100;
      document.getElementById("progress-bar").style.width = pct + "%";
      document.getElementById("player-time").textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    }
  }, 500);
}

function stopProgressUpdate() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// לחיצה על פס ההתקדמות
document.getElementById("progress-wrap").addEventListener("click", (e) => {
  if (!ytReady || !currentSong) return;
  const rect = e.currentTarget.getBoundingClientRect();
  // RTL: הפוך
  const clickX = e.clientX - rect.left;
  const pct = clickX / rect.width;
  const duration = ytPlayer.getDuration();
  if (duration > 0) {
    ytPlayer.seekTo(pct * duration, true);
  }
});

// === יצירת כרטיס שיר ===
function createSongCard(song, index) {
  const card = document.createElement("div");
  card.className = "song-card";
  if (currentSong && currentSong.videoId === song.videoId) card.className += " playing";
  card.dataset.videoId = song.videoId;

  const thumbSrc = song.thumbnail || "";
  const isNew = song.isNew;
  const hasLyrics = song.hasTranscript;
  const time = relTime(song.publishedAt || song.firstSeen);
  const isCurrentPlaying = currentSong && currentSong.videoId === song.videoId && isPlaying;

  card.innerHTML = `
    <div class="song-thumb">
      ${isNew ? '<span class="new-badge">חדש!</span>' : ''}
      <img src="${escapeHtml(thumbSrc)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="play-overlay">
        <div class="play-overlay-icon">${isCurrentPlaying ? '⏸' : '▶'}</div>
      </div>
    </div>
    <div class="song-info">
      <div class="song-title">${escapeHtml(song.title)}</div>
      <div class="song-artist">${escapeHtml(song.artist || song.channel)}</div>
      <div class="song-meta">
        <span>${time}</span>
        ${hasLyrics ? '<span>📝 תמלול</span>' : ''}
      </div>
    </div>
    <div class="song-actions">
      ${hasLyrics
        ? `<button class="btn btn-accent" onclick="event.stopPropagation(); showLyrics('${escapeHtml(song.videoId)}')">📝 תמלול</button>`
        : ''
      }
      <a href="https://www.youtube.com/watch?v=${escapeHtml(song.videoId)}" target="_blank" class="btn" onclick="event.stopPropagation()">🔗 YouTube</a>
    </div>
  `;

  // לחיצה על הכרטיס מנגנת את השיר
  card.addEventListener("click", () => {
    const playlistIdx = playlist.findIndex(s => s.videoId === song.videoId);
    if (currentSong && currentSong.videoId === song.videoId) {
      togglePlay();
    } else {
      playSong(song, playlistIdx >= 0 ? playlistIdx : index);
    }
  });

  return card;
}

// === הצגת תמלול ===
function showLyrics(videoId) {
  const song = allSongs.find(s => s.videoId === videoId);
  if (!song || !song.lyrics) return;

  document.getElementById("modal-title").textContent = song.title;
  document.getElementById("modal-artist").textContent = song.artist || song.channel;

  const lyricsEl = document.getElementById("modal-lyrics");

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

// === סינון + חיפוש ===
function filterSongs() {
  const q = searchQuery.toLowerCase();
  return allSongs.filter(song => {
    if (activeFilter === "new" && !song.isNew) return false;
    if (activeFilter === "transcribed" && !song.hasTranscript) return false;

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

  // עדכון הפלייליסט
  playlist = filtered;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="icon">🎵</div><p>לא נמצאו שירים${searchQuery ? ' עבור "' + escapeHtml(searchQuery) + '"' : ''}</p></div>`;
    return;
  }

  grid.innerHTML = "";
  filtered.forEach((song, i) => {
    grid.appendChild(createSongCard(song, i));
  });
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

// === אירועי מקלדת ===
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  // מקש רווח – play/pause (אם לא בשדה חיפוש)
  if (e.key === " " && e.target.tagName !== "INPUT" && currentSong) {
    e.preventDefault();
    togglePlay();
  }
});

// חיפוש עם debounce
let searchTimeout;
document.getElementById("search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchQuery = e.target.value.trim();
    render();
  }, 200);
});

// סגירת מודל בלחיצה על הרקע
document.getElementById("lyrics-modal").addEventListener("click", (e) => {
  if (e.target.id === "lyrics-modal") closeModal();
});

// טעינה ראשונית + רענון כל 5 דקות
loadData();
setInterval(loadData, 5 * 60 * 1000);
