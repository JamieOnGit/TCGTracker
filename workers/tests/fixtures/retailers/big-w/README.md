# BIG W fixtures: none saved (blocked)

Attempted 2026-09-27 from a cloud container (US egress, not AU or residential).
- `curl https://www.bigw.com.au/robots.txt` failed with an HTTP/2 stream INTERNAL_ERROR, and over HTTP/1.1 it timed out after 30 s with 0 bytes, which looks like a tarpit.
- Headless Chromium got **HTTP 403 "Access Denied"** from Akamai (reference `errors.edgesuite.net/18.bdbd7768...`).
- No bypass was attempted and no samples were saved. The same requests need to be re-verified from an AU residential connection.
