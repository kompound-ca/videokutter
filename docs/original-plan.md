1. Phase 0 — Baseline, access, and environment sanity checks
Goal: establish a clean baseline, document the current flow, and ensure we can safely iterate in dev and prod.

Do this:
- Inventory:
  - Collect current docker-compose.yml, Nginx config, certbot config, and backend code architecture overview (especially upload and preview flows).
  - Record versions: Docker/Compose, Nginx, Certbot, FFmpeg, Go toolchain, Node (if applicable), OS.
- Access:
  - Confirm access to Azure VM (Ubuntu 22.04) and dev Windows 11 Docker environment.
- Branching:
  - Create a feature branch: feature/ssl-upload-preview-optimization.
- Rule of engagement (must follow on every change):
  - For Go changes: recompile binaries.
  - For container changes: docker compose down && docker compose up -d --build (do not just restart).
  - Run apps detached, view logs in bounded snapshots (do not tail indefinitely).
- Document current upload-to-preview timing by capturing timestamps from UI and server logs on at least two files (e.g., 100MB MP4, 2GB MOV).

Acceptance:
- A short baseline doc with: current architecture diagram (textual), versions, and measured upload-to-preview timings on two test files.
2. Phase 1 — Certbot/SSL audit: confirm auto-renew behavior and fix the renew path
Goal: determine if certbot will automatically renew and whether the “Certbot doesn't know how to automatically configure the web server” message is actionable.

1) Inspect current docker-compose for certbot:
- Verify there is a certbot service and assess:
  - Which plugin is used (webroot vs nginx vs standalone).
  - Volumes: /etc/letsencrypt and /var/lib/letsencrypt should be persistent and shared with Nginx container.
  - ACME challenge webroot path is mounted and exposed by Nginx (/.well-known/acme-challenge).
- If the logs say “Certbot doesn't know how to automatically configure the web server,” that is expected when using certonly or webroot plugins; it is not an error if Nginx is manually configured. We can ignore it as long as issuance and renew succeed.

2) Review and section the certbot logs (bounded, do not tail forever):
- docker logs --since 72h certbot | tail -n 400
- Extract and document:
  - Last issuance/renew event and exit code.
  - Any rate-limit or HTTP challenge errors.
  - Whether a post-renew reload of Nginx happened.

3) Ensure Nginx challenge location exists:
- Nginx server block must include:
  ```
  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }
  ```
- Map that path as a shared volume between Nginx and Certbot.

4) Implement reliable auto-renew in Docker (most robust path):
- Compose: keep certbot issuance container, and add a lightweight renewer sidecar that runs periodically.
- Example compose fragment:
  ```
  services:
    nginx:
      image: nginx:stable
      volumes:
        - certbot-www:/var/www/certbot
        - letsencrypt:/etc/letsencrypt
        - ./nginx.conf:/etc/nginx/nginx.conf:ro
      ports:
        - "80:80"
        - "443:443"
      # no restart commands; reload handled by renewer

    certbot:
      image: certbot/certbot:latest
      volumes:
        - certbot-www:/var/www/certbot
        - letsencrypt:/etc/letsencrypt
      command: >
        certonly --webroot -w /var/www/certbot
        -d your.domain.tld
        --email admin@your.domain.tld --agree-tos --non-interactive

    certbot-renewer:
      image: certbot/certbot:latest
      volumes:
        - certbot-www:/var/www/certbot
        - letsencrypt:/etc/letsencrypt
        - /var/run/docker.sock:/var/run/docker.sock
      entrypoint: ["/bin/sh","-c"]
      command: >
        'while :; do
           certbot renew --webroot -w /var/www/certbot --quiet --no-random-sleep-on-renew
           docker kill -s HUP $(docker ps --filter "name=nginx" --format "{{.ID}}") || true
           sleep 12h;
         done'
      restart: unless-stopped

  volumes:
    certbot-www:
    letsencrypt:
  ```
- Note: mounting docker.sock grants control to the renewer; acceptable for ops simplicity but document the trade-off.
- Alternative (if avoiding docker.sock): Use a small “reloader” HTTP endpoint in Nginx container or a sidecar that watches cert files and SIGHUPs nginx; the docker.sock approach is fastest to deliver.

5) Validate with staging and dry run:
- Switch to Let’s Encrypt staging CA for a test issuance if needed.
- Run dry-run renewal: docker compose run --rm certbot-renewer sh -lc "certbot renew --dry-run"
- Confirm Nginx reload works: docker exec -it nginx nginx -T (valid config) and observe reload timestamp.

Acceptance:
- Renew works with dry-run.
- Nginx reloads automatically after renewal.
- The warning “doesn't know how to automatically configure the web server” is documented as informational given we use webroot/manual Nginx.
- All config changes deployed via docker compose down && docker compose up -d --build.
3. Phase 2 — Nginx tune-up for video delivery and uploads
Goal: ensure optimal delivery of large video files and chunked uploads.

Actions:
- Add/verify:
  - client_max_body_size large enough only if any non-chunked endpoints exist; for chunked upload via multiple requests, this may remain default.
  - proxy_read_timeout / proxy_send_timeout for long assembly/preview generation endpoints.
  - Enable range requests and caching headers for preview MP4s/posters/waveforms.
  - Gzip off for video; sendfile on; tcp_nopush on.
- Optional mp4 module: If Nginx build includes http_mp4_module, enable mp4; otherwise rely on Range requests.
- CORS headers for preview assets if frontend on different origin.
- Ensure /.well-known/acme-challenge location uses the certbot webroot.

Acceptance:
- Large preview MP4s support Range requests (206) and seek quickly.
- Chunk uploads succeed with parallel 5MB parts without 413/504 errors.
4. Phase 3 — Instrument upload-to-preview path (server and client)
Goal: identify bottlenecks between “last chunk uploaded” and “preview page usable”.

Add structured timing logs with a correlation id upload_id across:
- Client:
  - t0: first-chunk-start
  - t1: last-chunk-finished
  - t2: server-ack assembled
  - t3: metadata available
  - t4: preview generated
  - t5: preview page interactive
- Server:
  - receive chunk
  - append/assemble chunk
  - assembly-finished
  - ffprobe-start/ffprobe-end
  - poster-start/poster-end
  - preview-start/preview-end
  - waveform-start/waveform-end
  - ready-for-preview response

Implementation tips (Go backend assumed):
- Use a middleware to inject upload_id into context and logs.
- Emit JSON logs; keep snapshots: journal 200 lines per upload_id to avoid getting stuck.
- Persist per-upload state in DB or KV (e.g., Redis or on-disk JSON), with step status and timestamps.

Acceptance:
- A timeline chart (even textual) for at least three files (MP4/H264, MOV/ProRes or HEVC, WebM/VP9) pinpointing slow stages.
5. Phase 4 — Upload assembly optimization
Goal: reduce latency between the final chunk and preview readiness.

Implement:
- Assembly:
  - Pre-allocate final file size when known; write chunks directly into their offsets (sparse-safe) to avoid concatenation passes.
  - If offsets unknown, still write sequentially with buffered I/O; avoid extra copies and fsync until the end.
  - Use os.Rename for atomically moving assembled file into the processing dir.
- Concurrency:
  - Cap concurrent assemblies to CPU count (2 on prod VM); queue others.
- Hashing:
  - Compute hash on-the-fly while assembling to avoid a second full read.
- Immediate ffprobe:
  - Kick off ffprobe as soon as file handle closes; do not wait for preview generation to complete.
  - Use:
    ```
    ffprobe -v error -print_format json -show_format -show_streams -read_intervals 0%+1 input
    ```
    This avoids scanning entire file.
- Poster thumbnail:
  - Seek near 1s without pre-scan:
    ```
    ffmpeg -ss 1 -i input -frames:v 1 -vf "scale='min(1280,iw)':-1" -y poster.jpg
    ```

Acceptance:
- 30–60% reduction in time from last-chunk to metadata available on 1–2GB files.
- No regression in assembly correctness or integrity checks.
6. Phase 5 — Preview generation strategy and fast path
Goal: produce a browser-playable preview quickly without breaking timeline/cutting.

Strategy:
- Always keep original file untouched for cutting/exports.
- Generate a “universal preview” asset as fast as possible:
  - Try remux to MP4 with moov at front:
    ```
    ffmpeg -y -fflags +genpts -i input -map 0:v:0 -map 0:a? -c copy -movflags +faststart preview.mp4
    ```
  - If remux fails or codecs unsupported by target browser, transcode minimal preview:
    ```
    ffmpeg -y -i input -map 0:v:0 -c:v libx264 -preset veryfast -tune fastdecode \
      -pix_fmt yuv420p -profile:v high -level 4.2 -g 90 -keyint_min 45 -sc_threshold 0 \
      -map 0:a? -c:a aac -b:a 128k -ar 48000 \
      -movflags +faststart preview.mp4
    ```
- Limit preview bitrate/size (e.g., 720p, CRF 23–25) to fit 2 vCPU.
- Generate single representative preview first; optionally add background HLS later if needed.

Acceptance:
- For MP4/H264 inputs: preview by remux in seconds.
- For MOV/ProRes or HEVC: preview mp4 available in minutes rather than failing to play in browser.
7. Phase 6 — Explain and resolve MOV vs MP4/AV1 browser behavior
Goal: document root cause and make it work.

Findings to validate:
- Browsers commonly support MP4 container with H.264 video + AAC audio widely; AV1 MP4 plays in modern Chromium; MOV container is not reliably supported in browsers; MOV often contains ProRes/PCM/ALAC which are not web-playable.
- If an AV1 MP4 plays, it means the browser decodes it; MOV fails due to unsupported container/codec.

Implement detection and routing:
- Server-side: store codec info from ffprobe; tag assets with playable = true/false per browser family.
- Client-side:
  - Use canPlayType and MediaCapabilities API to decide if original is playable; else use preview.mp4.
- Ensure moov atom at beginning for progressive MP4: -movflags +faststart already handled.

Acceptance:
- MOV uploads reliably play using preview.mp4 across Chrome/Edge/Firefox/Safari.
- A short technical note added to docs explaining why MOV fails natively and our workaround.
8. Phase 7 — Remove redundant video processing systems and unify pipeline
Goal: simplify and reduce duplicate work.

Actions:
- Audit backend for multiple preview/transcode paths (e.g., separate services producing similar assets).
- Keep one pipeline:
  - Assemble → ffprobe → poster → universal preview (remux-or-transcode) → waveform (optional) → ready.
- Delete/deprecate unused/duplicate jobs and configs.
- Centralize FFmpeg invocation via a single Go utility wrapper for consistent flags and logs.

Acceptance:
- Single code path produces preview.mp4, poster.jpg, and optional waveform.png/peaks.json.
- CPU usage and processing time drop due to removal of duplicate steps.
9. Phase 8 — Serve previews efficiently (host vs browser decoding policy)
Goal: decide and implement the optimal serving method.

Policy:
- Prefer browser decoding of preview.mp4 (H.264/AAC, faststart).
- Serve via Nginx directly as static file with Range support; avoid proxying through the app.
- Fall back to HLS only if absolutely required (very long files on slow networks). If adding HLS:
  - Use single-bitrate 720p HLS with fMP4 or TS, produced after the initial preview is available.
  - Chrome/Firefox via hls.js; Safari natively.

Nginx headers:
- Cache preview files aggressively with ETag/Last-Modified.
- CORS if separate origin.

Acceptance:
- Preview loads and seeks fast; CPU load on server minimal while playing.
10. Phase 9 — UX: smooth upload-to-preview transition
Goal: eliminate user confusion between “uploaded” and “ready to edit”.

Client changes:
- After last chunk, immediately navigate to a “Preparing preview” screen that:
  - Shows server-reported steps via SSE/WebSocket/polling (assembly, metadata, poster, preview).
  - Offers an instant local preview using URL.createObjectURL(file) while server processes (non-blocking; guard for browser memory with revocation when leaving page).
  - Shows ETA based on historical timings for the user’s codec/container.
- When server marks ready, seamlessly switch to server preview URL and enable full timeline/cutting.

Server changes:
- Add /uploads/{id}/status endpoint or SSE stream that publishes step updates.
- Persist step transitions for refresh resilience.

Acceptance:
- Users see progress within 1–2 seconds after finishing upload; perceived wait reduced.
- No regression in timeline or cutting functionality.
11. Phase 10 — Waveform and timeline data optimization
Goal: generate timeline assets fast without heavy CPU.

Options:
- Lightweight peaks generation:
  - Use ffmpeg to downmix and downsample audio, then emit amplitude samples at a low rate to JSON for client rendering.
  - Example:
    ```
    ffmpeg -i input -vn -ac 1 -filter:a aresample=8000,astats=metadata=1:reset=1 \
      -f null - 2&gt;&amp;1 | grep Parsed_astats | parse peaks
    ```
  - Or generate a compact peaks.bin with float/int16 samples.
- Poster: keep single JPG (do not generate multiple thumbnails initially).

Acceptance:
- Waveform available within seconds for short files and within a minute for multi-GB files.
- CPU usage acceptable on 2 vCPU host.
12. Phase 11 — Resource and concurrency tuning on Azure VM (2 vCPU, 4GB)
Goal: avoid overloads during processing.

Settings:
- Limit FFmpeg threads: -threads 2 (or 1 for background tasks).
- Serialize heavy transcodes (preview) to 1 concurrent job; queue the rest.
- Nice/ionice FFmpeg processes to keep the system responsive.
- Cap client parallel chunk uploads to 4–6 streams.
- Optional: 1–2GB swap file to prevent OOM if safe.

Acceptance:
- Under concurrent uploads, system remains responsive; no OOM/restarts.
13. Phase 12 — Observability and alerting
Goal: visibility into renewals and processing.

Implement:
- Structured logs (JSON) with upload_id and step timings.
- Lightweight metrics:
  - Expose /metrics (Prometheus format) or a simple /healthz + /readyz + recent job stats.
- Alerts:
  - Cert expiry check (days to expiry &lt;= 14) -> Slack/Email.
  - Job failures rate &gt; threshold -> alert.

Acceptance:
- Dashboard or status endpoint shows average t1→t5 latency and failure counts.
- Alert fires in staging when thresholds are forced.
14. Phase 13 — Test matrix and verification
Goal: verify preview compatibility and performance without regressions.

Files to test (at least 100–500MB each):
- MP4/H.264 + AAC
- MP4/AV1 + AAC
- MOV/ProRes + PCM
- MOV/HEVC + AAC
- MKV/H.264 + AAC
- WebM/VP9 + Opus
- M4V/H.264 + AAC
Scenarios:
- Upload each, confirm timeline: assemble → metadata → poster → preview.
- Confirm browser playback on Chrome, Firefox, Edge, Safari.
- Seek and scrubbing performance.
- Verify cut operations still work.

Acceptance:
- All listed formats produce a playable preview.mp4 and functional timeline.
- No failures in cutting routines.
15. Phase 14 — Deployment plan and rollback
Goal: ship safely with clear rollback.

Steps:
- Merge feature branch after code review.
- Build images:
  - For Go changes, recompile and ensure multi-stage builds cache well.
  - docker compose down &amp;&amp; docker compose up -d --build
- Post-deploy checks:
  - Certbot renew dry-run passes.
  - Nginx config test (nginx -t) and reload success.
  - Health endpoints green.
- Rollback:
  - Keep previous compose and images tagged; docker compose down &amp;&amp; docker compose -f docker-compose.prev.yml up -d

Acceptance:
- Zero-downtime deploy; immediate functional verification checklist completed.
16. Phase 15 — Documentation and runbooks
Goal: ensure maintainability.

Produce:
- SSL/certbot runbook: how renew works, how to test dry-run, what the log messages mean, and how to force reload.
- Upload/preview pipeline doc: stages, commands, failure modes.
- Nginx config doc: where ACME challenge is, cache headers, CORS.
- Troubleshooting logs: where to look, what to grep, and how to avoid getting stuck in logs (bounded snapshots).

Acceptance:
- Docs stored in repo under /docs with concise steps and commands.