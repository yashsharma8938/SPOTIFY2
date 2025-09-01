// client/app.js
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const loginBtn = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const meEl = $('#me');
const navBtns = document.querySelectorAll('.nav-btn');
const topSearch = $('#topSearch');

const homeView = $('#homeView');
const playlistsView = $('#playlistsView');
const libraryView = $('#libraryView');
const searchView = $('#searchView');
const contentViews = [homeView, playlistsView, libraryView, searchView];

const playBtn = $('#playBtn');
const prevBtn = $('#prevBtn');
const nextBtn = $('#nextBtn');
const nowMeta = $('#nowMeta');
const seek = $('#seek');
const volume = $('#volume');

let deviceId = null;
let player = null;
let isPlaying = false;
let previewAudio = new Audio();

// Navigation
navBtns.forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.view;
  showView(v);
}));

function showView(name) {
  contentViews.forEach(v => v.classList.remove('active'));
  if (name === 'home') homeView.classList.add('active');
  if (name === 'playlists') playlistsView.classList.add('active');
  if (name === 'library') libraryView.classList.add('active');
  if (name === 'search') searchView.classList.add('active');
}

// Auth
loginBtn.onclick = () => location.href = '/login';
logoutBtn.onclick = () => location.href = '/logout';

// small helper api
async function api(path) {
  const r = await fetch(path);
  if (r.status === 401) return null;
  return r.json();
}

// Load user and playlists
async function loadMe() {
  const me = await api('/api/me');
  if (!me) {
    meEl.textContent = 'Not logged in';
    return false;
  }
  meEl.textContent = me.display_name || me.id;
  return true;
}

async function loadPlaylists() {
  const data = await api('/api/playlists');
  playlistsView.innerHTML = '<h2>Your Playlists</h2>';
  if (!data) { playlistsView.innerHTML += '<p>Please login.</p>'; return; }
  const grid = document.createElement('div'); grid.className = 'grid';
  for (const p of data.items) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<img src="${p.images?.[0]?.url || 'https://placehold.co/300x300?text=Playlist'}"><div class="title">${p.name}</div><div class="sub">${p.tracks.total} tracks</div>`;
    c.onclick = () => showPlaylist(p);
    grid.appendChild(c);
  }
  playlistsView.appendChild(grid);
}

async function showPlaylist(p) {
  playlistsView.innerHTML = `<h2>${p.name}</h2>`;
  const d = await api(`/api/playlist/${p.id}`);
  const grid = document.createElement('div'); grid.className = 'grid';
  for (const it of d.tracks.items) {
    const t = it.track;
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<img src="${t.album.images?.[0]?.url || 'https://placehold.co/300x300?text=Track'}"><div class="title">${t.name}</div><div class="sub">${t.artists.map(a=>a.name).join(', ')}</div>`;
    c.onclick = () => playTrack(t);
    grid.appendChild(c);
  }
  playlistsView.appendChild(grid);
}

async function loadLibrary() {
  const d = await api('/api/library/albums');
  libraryView.innerHTML = '<h2>Your Library (Saved Albums)</h2>';
  if (!d) { libraryView.innerHTML += '<p>Please login.</p>'; return; }
  const grid = document.createElement('div'); grid.className = 'grid';
  for (const item of d.items) {
    const alb = item.album;
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<img src="${alb.images?.[0]?.url || 'https://placehold.co/300x300?text=Album'}"><div class="title">${alb.name}</div><div class="sub">${alb.artists.map(a=>a.name).join(', ')}</div>`;
    grid.appendChild(c);
  }
  libraryView.appendChild(grid);
}

// Search
topSearch.addEventListener('keypress', async (e) => {
  if (e.key !== 'Enter') return;
  const q = topSearch.value.trim();
  if (!q) return;
  searchView.innerHTML = `<h2>Search: ${q}</h2>`;
  const res = await api(`/api/search?q=${encodeURIComponent(q)}&type=track`);
  if (!res) { searchView.innerHTML += '<p>Login to search.</p>'; return; }
  const grid = document.createElement('div'); grid.className = 'grid';
  for (const t of res.tracks.items) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<img src="${t.album.images?.[0]?.url || 'https://placehold.co/300x300?text=Track'}"><div class="title">${t.name}</div><div class="sub">${t.artists.map(a=>a.name).join(', ')}</div>`;
    c.onclick = () => playTrack(t);
    grid.appendChild(c);
  }
  searchView.appendChild(grid);
  showView('search');
});

// Player / Web Playback SDK
async function ensurePlayer() {
  if (player) return player;
  await new Promise(r => { if (window.Spotify) r(); else window.onSpotifyWebPlaybackSDKReady = r; });
  const tRes = await fetch('/token');
  if (tRes.status !== 200) return null;
  player = new Spotify.Player({
    name: 'Web Player Clone',
    getOAuthToken: cb => fetch('/token').then(r=>r.json()).then(j=>cb(j.access_token)),
    volume: 0.5
  });

  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    console.log('Player ready', device_id);
    // transfer playback
    fetch('/api/transfer', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ device_id }) });
  });

  player.addListener('player_state_changed', state => {
    if (!state) return;
    isPlaying = !state.paused;
    playBtn.textContent = isPlaying ? '⏸' : '▶️';
    const cur = state.track_window?.current_track;
    if (cur) nowMeta.textContent = `${cur.name} — ${cur.artists.map(a=>a.name).join(', ')}`;
    seek.value = state.duration ? Math.floor(state.position / state.duration * 100) : 0;
  });

  await player.connect();
  return player;
}

async function playTrack(t) {
  nowMeta.textContent = `${t.name} — ${t.artists.map(a=>a.name).join(', ')}`;
  previewAudio.pause(); previewAudio.currentTime = 0;
  const p = await ensurePlayer();
  if (!p || !deviceId) {
    if (t.preview_url) {
      previewAudio.src = t.preview_url; previewAudio.play(); playBtn.textContent = '⏸'; isPlaying = true;
    } else {
      alert('Playback requires Premium or track preview not available.');
    }
    return;
  }
  await fetch('/api/play', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ uris: [t.uri] }) });
}

// play/pause handling
playBtn.onclick = async () => {
  const p = await ensurePlayer();
  if (!p) {
    if (previewAudio.src) {
      if (previewAudio.paused) { previewAudio.play(); playBtn.textContent='⏸'; } else { previewAudio.pause(); playBtn.textContent='▶️'; }
    }
    return;
  }
  // check state
  const state = await p.getCurrentState();
  if (!state || state.paused) { await fetch('/api/play', { method:'PUT' }); } else { await fetch('/api/pause', { method:'PUT' }); }
};

// next/prev
nextBtn.onclick = async () => {
  const p = await ensurePlayer();
  if (!p) return alert('Use SDK / Premium to control.');
  // Spotify SDK doesn't expose next via Web API easily here; use Web API endpoint:
  // (For simplicity we just call next via API)
  const tokenRes = await fetch('/token'); if (tokenRes.status !== 200) return;
  const j = await tokenRes.json();
  fetch('https://api.spotify.com/v1/me/player/next', { method:'POST', headers:{ Authorization: `Bearer ${j.access_token}` } });
};
prevBtn.onclick = async () => {
  const tokenRes = await fetch('/token'); if (tokenRes.status !== 200) return;
  const j = await tokenRes.json();
  fetch('https://api.spotify.com/v1/me/player/previous', { method:'POST', headers:{ Authorization: `Bearer ${j.access_token}` } });
};

// volume
volume.oninput = async () => {
  const p = await ensurePlayer();
  if (!p) return;
  p.setVolume(Number(volume.value));
};

// initial load
(async function init() {
  showView('home');
  const logged = await loadMe();
  if (logged) {
    await loadPlaylists();
    await loadLibrary();
    await ensurePlayer();
  }
})();
