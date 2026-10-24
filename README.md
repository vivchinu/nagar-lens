# 📍 Nagar Lens — AR Civic Complaint Agent

**Build·Hack·Garba · GDG Ahmedabad · "Agents: Civic Complaint Agent" track**

Point your phone at a pothole → the agent works out the issue → picks the AMC ward and department → files a ticket with a tracking ID → drops a 3D pin in the real world. Ask "What's the status?" by voice or text, watch it go to **Completed → Verified ✓**, and earn badges and civic honour titles.

> ⚠️ Uses a **mock** AMC system (`server/data/amc.json`). It is not connected to any real portal.

---

## Quick start

```bash
npm run setup          # installs root + server + client
cp .env.example .env   # then paste your GEMINI_API_KEY
npm run dev            # Express on :3001 + Vite HTTPS on :5173
```

Open **https://localhost:5173** on the laptop. Without a key, the app runs in **offline mode**: a rule-based agent calls the same tools, so the demo never dead-ends. Image recognition is guessed in this mode.

Get a key from https://aistudio.google.com/apikey. The default model is `gemini-2.5-flash`; override it with `GEMINI_MODEL`.

## Deploy on Google Cloud Run

The repo has a `Dockerfile` (builds the client, runs Express on `$PORT`).

**From the console (no CLI):** Cloud Run → **Deploy container** → **Service** → **Continuously deploy from a repository** → connect GitHub → `vivchinu/nagar-lens`, branch `main`, build type **Dockerfile** → region `asia-south1` → **Allow unauthenticated invocations** → under *Variables & secrets* add `GEMINI_API_KEY` → **Create**.

**With gcloud:**
```bash
gcloud run deploy nagar-lens --source . --region asia-south1 --allow-unauthenticated --set-env-vars GEMINI_API_KEY=YOUR_KEY
```

## Deploy online (Render, free)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vivchinu/nagar-lens)

1. Click the button and sign in to Render with GitHub.
2. Paste your `GEMINI_API_KEY` when asked (or leave it empty for offline mode) → **Apply**.
3. After ~3 minutes you get `https://nagar-lens-xxxx.onrender.com`. It's already HTTPS, so AR works on an Android phone straight away, with no Wi-Fi tricks.

Notes: free instances sleep after 15 min idle (first load takes ~30 s). Complaint data resets on each deploy or restart, which suits a demo (or use **Reset demo data**).

## Open it on an Android phone (same Wi-Fi)

1. Run `npm run dev`. Vite prints a **Network** URL, e.g. `https://192.168.1.23:5173`.
2. On the phone, open that URL in **Chrome**.
3. You'll see "Your connection is not private" (self-signed cert): tap **Advanced → Proceed**.
4. Allow **Location**, **Camera** and **Microphone** when asked.
5. Tap **🕶️ Start AR**. This needs ARCore / "Google Play Services for AR" installed.

If the phone can't connect:
- Windows Firewall: allow Node.js on **Private** networks (or run `netsh advfirewall firewall add rule name="Vite 5173" dir=in action=allow protocol=TCP localport=5173` as admin).
- Phone and laptop must be on the same network. Guest/venue Wi-Fi often blocks device-to-device traffic, so use your phone's hotspot instead.
- Only port **5173** is needed. `/api` and `/media` are proxied to the Express server.

**Single-port alternative:** `npm --prefix client run build`, then `npm run server` serves everything on http://localhost:3001. That's handy for laptop demos; AR needs HTTPS, so phones still use 5173.

## Demo script (≈2 min)

| Step | What to do | What judges see |
|---|---|---|
| 1 | Home: pick **Riya** (user chip). Optional: ⋯ → Location → *Navrangpura* | Points + title chip |
| 2 | **Start AR** → **📷 Report** → photograph a pothole → tap the ground | Steps stream in: 🔍 Pothole (High) → 📍 Navrangpura → Ward 12 → Roads Dept → 🎫 AMC-W12-0457 → ⭐ +10. Pin anchors with label |
| 3 | Switch to **Officer** → tap a table to place the **ward map** | Mini 3D ward map, colour pins, top-3 citizens floating above |
| 4 | Tap the new pin → **✅ Complete + after photo** | `update_status` → `verify_completion` (Gemini before/after) → **Verified ✓** |
| 5 | Back to **Citizen** → 🎤 "What's the status?" | "Completed and verified fixed ✓" → 3D badge pops (**Pothole Hunter**, +15) → 🎉 *Active Citizen → 🏆 Highest Civic Honour* |
| 6 | "Who has the highest civic honour?" | `get_leaderboard` → Riya, 503 pts |

Reset any time: ⋯ → **Reset demo data**, or open **/demo**.
No pothole nearby? Use the **🖼️ Report sample pothole** chip and the **"Use sample fixed road photo"** link.
The seed data is tuned so this exact flow gives Riya her 5th road fix (Pothole Hunter) and moves her past Kabir (495) for the city's top honour.

## The agent

`POST /api/agent` runs a **Gemini function-calling loop**. Body: `{ message, image?, location?, areaName?, user, role, ticketId?, history? }`.
Returns `{ reply, toolCalls[], celebrations[], ticketId, ... }`. Add `?stream=1` to get newline-delimited JSON events (`tool_call`, `tool_result`, `done`), which the UI renders step by step.

| Tool | What it does |
|---|---|
| `analyze_image` | Gemini vision → `{issueType, severity, description, confidence}`; rejects non-civic photos |
| `lookup_ward_department` | Area name or GPS → ward (bounding boxes, nearest fallback) + department |
| `create_ticket` | Writes to `amc.json`, returns `AMC-W12-0457`; same type within 30 m → suggests **+1** instead |
| `get_status` | Stage, department, crew, expected date, timeline (`"my latest"` supported) |
| `list_complaints` | Open/completed by area or user |
| `update_status` | Officer only; Completed awards the owner +15 |
| `verify_completion` | Gemini compares before/after → **Verified**, or **Reopened** if the issue is still visible |
| `award_points`, `get_badges`, `get_leaderboard`, `plus_one` | Gamification |

Safety nets: if Gemini errors, the offline agent takes over. A filed ticket always gets its +10, even if the model forgets. Awards are idempotent per ticket.

### Test with curl
```bash
curl -s localhost:3001/api/agent -H "content-type: application/json" -d '{"user":"Riya Shah","message":"Who has the highest civic honour?"}'
curl -s localhost:3001/api/agent -H "content-type: application/json" -d '{"user":"Riya Shah","message":"Show complaints in Navrangpura"}'
curl -s -X POST localhost:3001/api/demo/reset
```
To report with a photo, send `"image": "data:image/jpeg;base64,..."` plus `"areaName": "Navrangpura"` or `"location": {"lat":23.037,"lng":72.559}`.

## Status, points, badges

Filed 🔴 → Acknowledged 🟠 → Assigned 🟡 → In progress 🔵 → Completed 🟢 → Verified ✓ (or Reopened 🟣). Every change is added to the timeline.

Points: valid complaint +10 · +1 a pin +2 · verify a fix +5 · own complaint completed +15 · fake/duplicate −10.
Badges: Pothole Hunter (5 roads), Clean Street Champion (5 garbage), Light Keeper (3 lights), Flood Watch (waterlogging report), Truth Checker (10 verifications), Ward Guardian (top in ward).
Titles: Active Citizen (100) · Civic Hero (500) · Ward Champion (top in ward) · 🏆 Highest Civic Honour (top in city).

## Project layout

```
server/  index.js (Express routes) · agent.js (Gemini loop + offline agent) · tools.js (all tools)
         gemini.js (REST client) · store.js (JSON read/write) · data/amc.json, amc.seed.json · media/
client/  index.html · src/main.js (UI, streaming, flows, voice) · src/scene.js (Three.js map, pins, WebXR, badge pop) · src/style.css
```

## AR notes

- WebXR `immersive-ar` with `hit-test` and `dom-overlay` (Android Chrome + ARCore). Without AR support you get the same features on an orbitable 3D ward map.
- Photos use `<input capture="environment">`, because raw camera frames in WebXR are unreliable. If opening the camera ends the AR session, tap **Resume AR** and drop the pin.
- Pins you place are anchored for the current AR session. Other complaints appear in a fan in front of you, labelled with their real distance.
