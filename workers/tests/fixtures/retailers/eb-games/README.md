# EB Games fixtures: none saved (blocked)

Attempted 2026-09-27 from a cloud container (US egress, not AU or residential).
- `GET https://www.ebgames.com.au/robots.txt` returned **HTTP 403** with `server: cloudflare` and `cf-mitigated: challenge`, and served a "Just a moment..." Cloudflare managed challenge (Turnstile) to both curl and headless Chromium. The Turnstile token request returned 401.
- Per the research rules, we made no attempt to solve or bypass the challenge, and saved no samples.
- The same requests need to be re-verified from an AU residential connection before any fixtures are captured.
