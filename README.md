# Planning Poker (Static + Realtime)

A lightweight planning poker app you can host as static files (S3) while still supporting **multiple users in a room with custom names** via **Supabase Realtime** (presence + broadcast).

## Features

- Join/create a room with a short room code
- Custom display names
- Fibonacci card deck: **0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89**
- Realtime presence list + voting
- Host-selected **Reveal** and **Reset** (host is the earliest joiner)

## 1) Supabase setup

1. Create a Supabase project: https://supabase.com
2. Go to **Project Settings → API**
3. Copy:
   - **Project URL**
   - **anon public** key
4. Paste them into [config.js](config.js):
   - `window.SUPABASE_URL`
   - `window.SUPABASE_ANON_KEY`

Notes:
- This app uses **Realtime Channels (presence + broadcast)**, so you don’t need any database tables.
- If your project has Realtime disabled, enable it in Supabase settings.

## 2) Run locally

Any static server works. Examples:

- Python: `python -m http.server 5173`
- Node (if you have it): `npx serve .`

Then open `http://localhost:5173`.

## 3) Deploy to S3 (static hosting)

1. Create an S3 bucket
2. Enable **Static website hosting**
3. Upload these files:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `config.js`
4. Set the bucket policy / CloudFront (optional) to allow public reads

Tip:
- If you use CloudFront, consider setting shorter cache for `config.js` so you can rotate keys easily.

## Room links

Share a room link like:

`https://your-domain.example/?room=7KQ2M9`

## Troubleshooting

- If you see "Missing Supabase config", fill in [config.js](config.js).
- If presence/votes don’t sync, check browser console and confirm Realtime is enabled on your Supabase project.
