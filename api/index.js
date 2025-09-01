// server.js
const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const querystring = require('querystring');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'client')));

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  REDIRECT_URI,
  PORT = 3000
} = process.env;

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

function cookieOpts() {
  return { httpOnly: true, sameSite: 'lax' };
}

function expired(req) {
  const e = Number(req.cookies.expires_at || 0);
  return !e || Date.now() > e - 10_000;
}

async function refreshAccessToken(refresh_token) {
  const body = querystring.stringify({
    grant_type: 'refresh_token',
    refresh_token
  });
  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const { data } = await axios.post('https://accounts.spotify.com/api/token', body, {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  return data;
}

async function getValidAccessToken(req, res) {
  let access_token = req.cookies.access_token;
  let refresh_token = req.cookies.refresh_token;
  if (!refresh_token) throw new Error('no_refresh');
  if (!access_token || expired(req)) {
    const data = await refreshAccessToken(refresh_token);
    access_token = data.access_token;
    const expires_at = Date.now() + data.expires_in * 1000;
    res.cookie('access_token', access_token, cookieOpts());
    res.cookie('expires_at', String(expires_at), cookieOpts());
    if (data.refresh_token) {
      refresh_token = data.refresh_token;
      res.cookie('refresh_token', refresh_token, cookieOpts());
    }
  }
  return access_token;
}

app.get('/login', (_req, res) => {
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    show_dialog: 'true'
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=missing_code');

  try {
    const body = querystring.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const { data } = await axios.post('https://accounts.spotify.com/api/token', body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const expires_at = Date.now() + data.expires_in * 1000;
    res.cookie('access_token', data.access_token, cookieOpts());
    res.cookie('refresh_token', data.refresh_token, cookieOpts());
    res.cookie('expires_at', String(expires_at), cookieOpts());

    res.redirect('/');
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.redirect('/?error=token_error');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.clearCookie('expires_at');
  res.redirect('/');
});

app.get('/token', async (req, res) => {
  try {
    const token = await getValidAccessToken(req, res);
    res.json({ access_token: token });
  } catch (e) {
    res.status(401).json({ error: 'unauthorized' });
  }
});

// proxy helper
async function spotifyGet(req, res, url) {
  try {
    const token = await getValidAccessToken(req, res);
    const { data } = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    res.json(data);
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || { error: 'failed' });
  }
}

app.get('/api/me', (req, res) => spotifyGet(req, res, 'https://api.spotify.com/v1/me'));
app.get('/api/playlists', (req, res) => spotifyGet(req, res, 'https://api.spotify.com/v1/me/playlists?limit=50'));
app.get('/api/playlist/:id', (req, res) => spotifyGet(req, res, `https://api.spotify.com/v1/playlists/${req.params.id}`));
app.get('/api/library/albums', (req, res) => spotifyGet(req, res, 'https://api.spotify.com/v1/me/albums?limit=50'));

// search
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  const type = req.query.type || 'track';
  if (!q) return res.status(400).json({ error: 'missing_query' });
  try {
    const token = await getValidAccessToken(req, res);
    const { data } = await axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, type, limit: 20 }
    });
    res.json(data);
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || { error: 'search_failed' });
  }
});

// playback control
app.post('/api/transfer', async (req, res) => {
  try {
    const token = await getValidAccessToken(req, res);
    await axios.put('https://api.spotify.com/v1/me/player', { device_ids: [req.body.device_id], play: false }, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || { error: 'transfer_failed' });
  }
});

app.put('/api/play', async (req, res) => {
  try {
    const token = await getValidAccessToken(req, res);
    await axios.put('https://api.spotify.com/v1/me/player/play', {
      uris: req.body.uris || undefined,
      context_uri: req.body.context_uri || undefined,
      offset: req.body.offset || undefined
    }, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || { error: 'play_failed' });
  }
});

app.put('/api/pause', async (req, res) => {
  try {
    const token = await getValidAccessToken(req, res);
    await axios.put('https://api.spotify.com/v1/me/player/pause', {}, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.response?.status || 500).json(e.response?.data || { error: 'pause_failed' });
  }
});

//app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
module.exports = app;


