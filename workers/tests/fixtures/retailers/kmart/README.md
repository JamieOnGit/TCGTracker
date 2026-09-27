# Kmart fixtures: none saved (blocked)

Attempted 2026-09-27 from a cloud container (US egress, not AU or residential).
- `GET https://www.kmart.com.au/robots.txt` returned **HTTP 403 "Access Denied"** with `server: AkamaiGHost` and an `akamai-grn` header, for both curl and headless Chromium.
- The 403 response still set these cookies: `__country_code_=AU`, `mnm_rollout=TARGET_MARKETPLACE`, `new_search_enabled=true` and `__adv_opt_ko_=true`. They suggest a marketplace rollout and a new search backend (UNVERIFIED).
- No bypass was attempted and no samples were saved. The same requests need to be re-verified from an AU residential connection.
