const storageKey = "singsong_songs_v1";
const userKey = "singsong_user_v1";

function loadFromStorage(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

const state = {
  songs: loadFromStorage(storageKey, []),
  user: loadFromStorage(userKey, null),
  currentSongId: null,
  audioCtx: null,
  stream: null,
  recorder: null,
  chunks: [],
  animationFrame: null,
  analyser: null,
  metronomeTimer: null,
};

const homeView = document.getElementById("home-view");
const songView = document.getElementById("song-view");
const authBar = document.getElementById("auth-bar");

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function persistSongs() {
  if (!state.user) return;
  localStorage.setItem(storageKey, JSON.stringify(state.songs));
}

function persistUser() {
  localStorage.setItem(userKey, JSON.stringify(state.user));
}

function ensureAudioCtx() {
  if (!state.audioCtx) state.audioCtx = new AudioContext();
  return state.audioCtx;
}

function instrumentTransform(buffer, role, audioCtx) {
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const low = audioCtx.createBiquadFilter();
  const mid = audioCtx.createBiquadFilter();
  const high = audioCtx.createBiquadFilter();

  low.type = "lowshelf";
  mid.type = "peaking";
  high.type = "highshelf";

  if (role === "bass") {
    low.frequency.value = 180;
    low.gain.value = 12;
    mid.frequency.value = 800;
    mid.gain.value = -4;
    high.gain.value = -8;
  } else if (role === "drums") {
    low.gain.value = 5;
    mid.frequency.value = 2200;
    mid.gain.value = 7;
    high.gain.value = 4;
  } else if (role === "guitar") {
    low.gain.value = 2;
    mid.frequency.value = 1500;
    mid.gain.value = 8;
    high.gain.value = 3;
  }

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value = 6;

  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(compressor);

  return { source, output: compressor };
}

function renderAuthBar() {
  authBar.innerHTML = "";
  const box = document.createElement("div");
  box.className = "auth-box";

  if (state.user) {
    box.innerHTML = `<span>Signed in as ${state.user.email}</span>`;
    const logout = document.createElement("button");
    logout.textContent = "Logout";
    logout.onclick = () => {
      state.user = null;
      state.songs = [];
      localStorage.removeItem(userKey);
      render();
    };
    box.append(logout);
  } else {
    const email = document.createElement("input");
    email.className = "inline";
    email.placeholder = "email";
    const pass = document.createElement("input");
    pass.className = "inline";
    pass.type = "password";
    pass.placeholder = "password";

    const signIn = document.createElement("button");
    signIn.textContent = "Email Sign in / Sign up";
    signIn.onclick = () => {
      if (!email.value || !pass.value) return alert("Add email + password");
      state.user = { type: "email", email: email.value };
      persistUser();
      state.songs = loadFromStorage(storageKey, []);
      render();
    };

    const google = document.createElement("button");
    google.textContent = "Google Login";
    google.onclick = () => {
      alert("Hook your Storyteller OAuth client ID in GOOGLE_CLIENT_ID for production. Demo signs in instantly.");
      state.user = { type: "google", email: "demo.google@singsong.app" };
      persistUser();
      state.songs = loadFromStorage(storageKey, []);
      render();
    };

    box.append(email, pass, signIn, google);
  }

  authBar.append(box);
}

function renderHome() {
  homeView.innerHTML = "";
  const head = document.createElement("div");
  head.className = "home-header";
  head.innerHTML = `<div><h2>My Songs</h2><p class="note">Long press a song to delete. Guests can demo but cannot persist songs.</p></div>`;
  homeView.append(head);

  const list = document.createElement("div");
  list.className = "song-list";

  state.songs.forEach((song) => {
    const node = document.getElementById("song-card-template").content.firstElementChild.cloneNode(true);
    const titleInput = node.querySelector(".song-title-input");
    titleInput.value = song.title;
    titleInput.onchange = () => {
      song.title = titleInput.value || "Untitled song";
      song.updatedAt = now();
      persistSongs();
    };

    node.querySelector(".song-meta").textContent = `${song.tracks.length} track(s) • updated ${new Date(song.updatedAt).toLocaleString()}`;
    node.querySelector(".open-song-btn").onclick = () => openSong(song.id);
    node.querySelector(".play-song-btn").onclick = () => playAllTracks(song);
    node.querySelector(".download-song-btn").onclick = () => downloadMix(song);

    let holdTimer;
    node.onpointerdown = (event) => {
      if (event.target.closest("button") || event.target.closest("input")) return;
      holdTimer = setTimeout(() => {
        if (confirm(`Delete ${song.title}?`)) {
          state.songs = state.songs.filter((s) => s.id !== song.id);
          persistSongs();
          render();
        }
      }, 800);
    };
    node.onpointerup = () => clearTimeout(holdTimer);
    node.onpointerleave = () => clearTimeout(holdTimer);
    node.onpointercancel = () => clearTimeout(holdTimer);

    list.append(node);
  });

  homeView.append(list);

  const createRow = document.createElement("div");
  createRow.className = "create-row";
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Create a New Song";
  btn.onclick = () => {
    const title = prompt("Song title:", `New Song ${state.songs.length + 1}`) || `New Song ${state.songs.length + 1}`;
    const song = { id: uid(), title, tracks: [], invited: [], createdAt: now(), updatedAt: now() };
    state.songs.unshift(song);
    if (state.user) persistSongs();
    openSong(song.id);
  };
  createRow.append(btn);
  homeView.append(createRow);
}

async function startRecording(song, roleHint) {
  try {
    const role = roleHint || prompt("Track role: drums / guitar / bass / vocal", "vocal") || "vocal";
    const name = prompt("Track name:", `${role} track ${song.tracks.length + 1}`) || `${role} track ${song.tracks.length + 1}`;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = ensureAudioCtx();

    state.stream = stream;
    const src = audioCtx.createMediaStreamSource(stream);
    state.analyser = audioCtx.createAnalyser();
    state.analyser.fftSize = 2048;
    src.connect(state.analyser);

    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
    state.recorder.onstop = async () => {
      const blob = new Blob(state.chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      const tunedBlob = await renderOffline(decoded, role);

      song.tracks.push({
        id: uid(),
        name,
        role,
        volume: 0.9,
        pan: 0,
        mute: false,
        solo: false,
        eq: { bass: 0, mids: 0, treble: 0 },
        compressorOn: false,
        audioUrl: URL.createObjectURL(tunedBlob),
        rawAudioUrl: URL.createObjectURL(blob),
      });
      song.updatedAt = now();
      persistSongs();
      renderSong(song);
    };

    state.recorder.start(200);
    renderRecordingStatus(name, role);
    animateMeters();
  } catch (err) {
    alert(`Recording failed: ${err.message}`);
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(state.animationFrame);
}

function animateMeters() {
  const meterBar = document.querySelector("#live-meter span");
  const waveCanvas = document.getElementById("record-wave");
  if (!meterBar || !waveCanvas || !state.analyser) return;
  const ctx = waveCanvas.getContext("2d");
  const data = new Uint8Array(state.analyser.fftSize);

  const loop = () => {
    state.analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const n of data) peak = Math.max(peak, Math.abs(n - 128));
    meterBar.style.width = `${Math.min(100, (peak / 128) * 100)}%`;

    ctx.fillStyle = "#0b1016";
    ctx.fillRect(0, 0, waveCanvas.width, waveCanvas.height);
    ctx.strokeStyle = "#4cc9f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * waveCanvas.width;
      const y = (data[i] / 255) * waveCanvas.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    state.animationFrame = requestAnimationFrame(loop);
  };
  loop();
}

function renderRecordingStatus(name, role) {
  const status = document.getElementById("record-status");
  status.innerHTML = `<strong>Recording:</strong> ${name} (${role})`;
}

function ensureTrackDefaults(track) {
  if (typeof track.pan !== "number") track.pan = 0;
  if (typeof track.mute !== "boolean") track.mute = false;
  if (typeof track.solo !== "boolean") track.solo = false;
  if (!track.eq) track.eq = { bass: 0, mids: 0, treble: 0 };
  return track;
}

function getActiveTracks(song) {
  const tracks = song.tracks.map(ensureTrackDefaults);
  const soloTracks = tracks.filter((track) => track.solo);
  return soloTracks.length ? soloTracks : tracks.filter((track) => !track.mute);
}

function buildMixerStrip(song, track) {
  ensureTrackDefaults(track);
  const strip = document.createElement("article");
  strip.className = "mixer-strip";
  strip.innerHTML = `
    <div class="strip-header">
      <span class="strip-auto">auto read</span>
      <span class="strip-role">${track.role}</span>
    </div>
    <div class="strip-name">${track.name}</div>
    <label class="knob-group">Pan
      <input type="range" min="-1" max="1" step="0.01" value="${track.pan}" data-key="pan" />
    </label>
    <div class="strip-buttons">
      <button data-key="solo" class="tiny ${track.solo ? "on" : ""}">S</button>
      <button data-key="mute" class="tiny ${track.mute ? "on" : ""}">M</button>
      <button data-play="1" class="tiny">▶</button>
    </div>
    <div class="strip-meter"><span style="height:${Math.max(8, Math.round(track.volume * 72))}%"></span></div>
    <label class="fader-wrap">
      <input class="fader" type="range" min="0" max="1.5" step="0.01" value="${track.volume}" data-key="volume" orient="vertical" />
    </label>
    <div class="strip-eq">B ${track.eq.bass} • M ${track.eq.mids} • T ${track.eq.treble}</div>
  `;

  strip.querySelectorAll("input[data-key]").forEach((input) => {
    input.oninput = () => {
      const key = input.dataset.key;
      if (key === "volume") track.volume = Number(input.value);
      if (key === "pan") track.pan = Number(input.value);
      song.updatedAt = now();
      persistSongs();
      const meter = strip.querySelector(".strip-meter span");
      if (meter) meter.style.height = `${Math.max(8, Math.round(track.volume * 72))}%`;
    };
  });

  strip.querySelectorAll("button[data-key]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.key;
      if (key === "solo") track.solo = !track.solo;
      if (key === "mute") track.mute = !track.mute;
      song.updatedAt = now();
      persistSongs();
      renderSong(song);
    };
  });

  strip.querySelector("button[data-play]").onclick = () => playTrack(track);
  return strip;
}

function buildTrackNode(song, track) {
  ensureTrackDefaults(track);
  const node = document.createElement("div");
  node.className = "track-item";
  node.innerHTML = `
    <h4>${track.name}</h4>
    <p class="note">Role: ${track.role}</p>
    <div class="track-controls">
      <label class="control-group">Vol
        <input type="range" min="0" max="1.5" step="0.01" value="${track.volume}" data-key="volume" />
      </label>
      <label class="control-group">Pan
        <input type="range" min="-1" max="1" step="0.01" value="${track.pan}" data-key="pan" />
      </label>
      <label class="control-group">Bass
        <input type="range" min="-20" max="20" step="1" value="${track.eq.bass}" data-key="bass" />
      </label>
      <label class="control-group">Mids
        <input type="range" min="-20" max="20" step="1" value="${track.eq.mids}" data-key="mids" />
      </label>
      <label class="control-group">Treble
        <input type="range" min="-20" max="20" step="1" value="${track.eq.treble}" data-key="treble" />
      </label>
      <label class="toggle"><input type="checkbox" ${track.compressorOn ? "checked" : ""} data-key="compressor"/>Comp</label>
      <label class="toggle"><input type="checkbox" ${track.solo ? "checked" : ""} data-key="solo"/>Solo</label>
      <label class="toggle"><input type="checkbox" ${track.mute ? "checked" : ""} data-key="mute"/>Mute</label>
      <button data-play="1">Play Track</button>
    </div>
  `;

  node.querySelectorAll("input").forEach((input) => {
    input.oninput = () => {
      const key = input.dataset.key;
      if (key === "volume") track.volume = Number(input.value);
      if (key === "pan") track.pan = Number(input.value);
      if (key === "bass") track.eq.bass = Number(input.value);
      if (key === "mids") track.eq.mids = Number(input.value);
      if (key === "treble") track.eq.treble = Number(input.value);
      if (key === "compressor") track.compressorOn = input.checked;
      if (key === "solo") track.solo = input.checked;
      if (key === "mute") track.mute = input.checked;
      song.updatedAt = now();
      persistSongs();
    };
  });

  node.querySelector("button[data-play]").onclick = () => playTrack(track);
  return node;
}

function openSong(songId) {
  state.currentSongId = songId;
  const song = state.songs.find((s) => s.id === songId);
  renderSong(song);
  homeView.classList.remove("active");
  songView.classList.add("active");
}

function renderSong(song) {
  songView.innerHTML = "";
  const studio = document.createElement("div");
  studio.className = "studio";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `<h3>${song.title}</h3><p class="note">Metronome + track stack + collaborators.</p>`;

  const row = document.createElement("div");
  row.className = "row";

  const back = document.createElement("button");
  back.textContent = "Save & Exit";
  back.onclick = () => {
    persistSongs();
    songView.classList.remove("active");
    homeView.classList.add("active");
    render();
  };

  const newTrack = document.createElement("button");
  newTrack.className = "primary";
  newTrack.textContent = "🎤 New Track";
  newTrack.onclick = () => startRecording(song);

  const stop = document.createElement("button");
  stop.className = "danger";
  stop.textContent = "Stop";
  stop.onclick = stopRecording;

  const metro = document.createElement("button");
  metro.textContent = "Toggle Metronome";
  metro.onclick = () => toggleMetronome();

  row.append(back, newTrack, stop, metro);
  sidebar.append(row);

  const inviteBtn = document.createElement("button");
  inviteBtn.textContent = "Invite Collaborator";
  inviteBtn.onclick = async () => {
    const link = `${location.origin}${location.pathname}#collab=${song.id}`;
    await navigator.clipboard.writeText(link);
    const guest = prompt("Who are you inviting? (email)", "bandmate@example.com");
    if (guest) {
      song.invited.push(guest);
      persistSongs();
      renderSong(song);
    }
    alert(`Invite link copied: ${link}`);
  };
  sidebar.append(inviteBtn);

  const invited = document.createElement("p");
  invited.className = "note";
  invited.textContent = `Invited: ${song.invited.join(", ") || "none"}`;
  sidebar.append(invited);

  const list = document.createElement("div");
  list.className = "track-list";
  song.tracks.forEach((track) => list.append(buildTrackNode(song, track)));
  sidebar.append(list);

  const main = document.createElement("section");
  main.className = "main-editor";
  main.innerHTML = `
    <h3>Arrangement / Wave IDE</h3>
    <div id="record-status" class="note">Press “New Track” and start singing/playing.</div>
    <div class="wave-window protools-grid">
      <div class="meter" id="live-meter"><span></span></div>
      <canvas id="record-wave" width="1200" height="220"></canvas>
    </div>
    <div class="mixer protools-mixer">
      <div class="mix-header">
        <h4>Mix Bus</h4>
        <div class="row">
          <button id="play-all">Play Song</button>
          <button id="download-mp3">Download MP3</button>
          <button id="download-aff">Download AFF</button>
        </div>
      </div>
      <div id="mixer-lanes" class="mixer-lanes"></div>
    </div>
  `;

  const lanes = main.querySelector("#mixer-lanes");
  song.tracks.forEach((track) => lanes.append(buildMixerStrip(song, track)));

  main.querySelector("#play-all").onclick = () => playAllTracks(song);
  main.querySelector("#download-mp3").onclick = () => downloadMix(song, "mp3");
  main.querySelector("#download-aff").onclick = () => downloadMix(song, "aff");

  studio.append(sidebar, main);
  songView.append(studio);
}

async function playTrack(track) {
  ensureTrackDefaults(track);
  if (track.mute) return;
  const audioCtx = ensureAudioCtx();
  const res = await fetch(track.audioUrl);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const gain = audioCtx.createGain();
  gain.gain.value = track.volume;

  const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
  if (panner) panner.pan.value = track.pan;

  const bass = audioCtx.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 200;
  bass.gain.value = track.eq.bass;

  const mids = audioCtx.createBiquadFilter();
  mids.type = "peaking";
  mids.frequency.value = 1000;
  mids.Q.value = 1;
  mids.gain.value = track.eq.mids;

  const treble = audioCtx.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 3500;
  treble.gain.value = track.eq.treble;

  source.connect(bass);
  bass.connect(mids);
  mids.connect(treble);

  if (track.compressorOn) {
    const comp = audioCtx.createDynamicsCompressor();
    treble.connect(comp);
    comp.connect(gain);
  } else {
    treble.connect(gain);
  }

  if (panner) {
    gain.connect(panner);
    panner.connect(audioCtx.destination);
  } else {
    gain.connect(audioCtx.destination);
  }
  source.start();
}

function playAllTracks(song) {
  getActiveTracks(song).forEach((track) => playTrack(track));
}

function toggleMetronome() {
  const audioCtx = ensureAudioCtx();
  if (state.metronomeTimer) {
    clearInterval(state.metronomeTimer);
    state.metronomeTimer = null;
    return;
  }
  const bpm = 100;
  const intervalMs = (60 / bpm) * 1000;
  state.metronomeTimer = setInterval(() => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 950;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  }, intervalMs);
}

async function renderOffline(decodedBuffer, role) {
  const audioCtx = ensureAudioCtx();
  const offline = new OfflineAudioContext(decodedBuffer.numberOfChannels, decodedBuffer.length, decodedBuffer.sampleRate);
  const { source, output } = instrumentTransform(decodedBuffer, role, offline);
  output.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  const wav = audioBufferToWav(rendered);
  return new Blob([wav], { type: "audio/wav" });
}

function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new ArrayBuffer(length);
  const view = new DataView(out);
  const channels = [];
  let offset = 0;
  let pos = 0;

  const setUint16 = (data) => {
    view.setUint16(pos, data, true);
    pos += 2;
  };
  const setUint32 = (data) => {
    view.setUint32(pos, data, true);
    pos += 4;
  };

  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);
  setUint32(0x20746d66);
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      const sample = Math.max(-1, Math.min(1, channels[i][offset]));
      const s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, s, true);
      pos += 2;
    }
    offset++;
  }
  return out;
}

async function downloadMix(song, format = "mp3") {
  if (!song.tracks.length) return alert("No tracks to export");

  if (format === "aff") {
    const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${song.title.replace(/\s+/g, "_")}.aff`;
    a.click();
    return;
  }

  const audioCtx = ensureAudioCtx();
  const decodedTracks = await Promise.all(
    song.tracks.map(async (track) => {
      const res = await fetch(track.audioUrl);
      const arr = await res.arrayBuffer();
      return audioCtx.decodeAudioData(arr);
    })
  );

  const longest = Math.max(...decodedTracks.map((b) => b.length));
  const sampleRate = decodedTracks[0].sampleRate;
  const offline = new OfflineAudioContext(2, longest, sampleRate);

  const active = getActiveTracks(song);

  decodedTracks.forEach((buffer, idx) => {
    const track = ensureTrackDefaults(song.tracks[idx]);
    if (!active.includes(track)) return;

    const src = offline.createBufferSource();
    src.buffer = buffer;

    const gain = offline.createGain();
    gain.gain.value = track.volume;

    const panner = offline.createStereoPanner ? offline.createStereoPanner() : null;
    if (panner) panner.pan.value = track.pan;

    src.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(offline.destination);
    } else {
      gain.connect(offline.destination);
    }
    src.start(0);
  });

  const mixed = await offline.startRendering();
  const wav = audioBufferToWav(mixed);
  const blob = new Blob([wav], { type: "audio/mpeg" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${song.title.replace(/\s+/g, "_")}.mp3`;
  a.click();
}

function render() {
  renderAuthBar();
  renderHome();
}

render();
