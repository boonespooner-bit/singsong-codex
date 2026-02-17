# Sing Song

Sing Song is a browser-based multitrack recording studio prototype.

## Features implemented
- Home screen with **Create a New Song** button anchored at the bottom.
- Song list with inline title editing, one-click play, open, and mix download.
- Long-press delete on song cards.
- Song editor with:
  - Pro Tools-inspired wave grid + vertical channel-strip mixer UI
  - New Track recording flow (name + role prompts)
  - Live mic input meter and waveform monitor
  - Stop/save workflow
  - Per-track volume, pan, 3-band EQ, compressor toggle, solo/mute
  - Play individual tracks or full song mix
  - Metronome toggle
  - Collaborator invite link copy and invited list
- AI tuning simulation using an offline render transform by selected instrument role.
- Email sign in/sign up and Google login **demo mode**.
  - Guests can demo the app without logging in.
  - Songs persist only for signed-in users.
- Export:
  - `.mp3` mix download (WAV-encoded audio with mp3 filename for compatibility)
  - `.aff` project file export (JSON payload)

## Run locally
```bash
python3 -m http.server 4173
```
Then open `http://localhost:4173`.

## OAuth note
The Google login button currently uses a local demo auth flow and includes a hook message to wire Storyteller OAuth credentials in production.


## Render deployment
- Deploy with the included `render.yaml` Blueprint.
- This app is fully static and does not need SPA rewrite routes; rewriting `/*` can break loading of `styles.css` and `app.js`.
