# DeepSight ROV

Web dashboard for an underwater ROV: live video with YOLO fish detection, water quality and depth readings, mission recordings, reports and trends across missions.

- **Frontend:** Next.js 15 (port 3000)
- **Backend:** FastAPI + MySQL (port 8000)
- **Video relay:** MediaMTX (RTSP, port 8554)

## Getting started

```bash
git clone https://github.com/Rai9189/DeepSight-ROV.git
cd DeepSight-ROV
npm install
cd src/backend && pip install -r requirements.txt
```

The YOLO weights file is not in Git. Copy `best.pt` into `src/backend/models/`.

Create `.env` in the project root:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL connection, e.g. `mysql://user:pass@localhost:3306/db` |
| `JWT_SECRET`, `JWT_SECRET_KEY` | JWT signing key (both must match) |
| `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_API_URL` | Backend URL for the browser, e.g. `http://localhost:8000` |
| `RTSP_URL` | Camera stream, e.g. `rtsp://localhost:8554/cam` |

Optional settings (YOLO thresholds, base station sync) are documented in `src/backend/config.py`.

Seed the database once:

```bash
npm run db:seed
```

## Running

Start each in its own terminal:

```bash
./mediamtx.exe              # video relay (only needed for live stream)
./start-backend.ps1         # backend on http://localhost:8000
npm run dev                 # frontend on http://localhost:3000
```

For a production build use `npm run build` then `npm run start`.

## Tests

```bash
cd src/backend && python -m pytest   # backend
npm run test:e2e                     # end-to-end (Playwright, builds first)
```
