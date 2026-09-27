# 01 — PSA Public API (brief §14.1 / §4.3, and §5.1 listing validation)

Researched 2026-09-27. Only documentation, the Swagger spec and legal pages were read. No account was registered and no population-report pages were scraped. One unauthenticated call was made to the cert endpoint to check how the quota behaves (see Limits). Anything not confirmed from a primary source is marked **UNVERIFIED**.

The Swagger spec is saved alongside this file: `docs/research/psa-swagger.json`, fetched from `https://api.psacard.com/publicapi/swagger.json`.

---

## 1. Summary verdict

**Population data from the API: PARTIAL. Technically yes, but not at our scale and not clearly licensed for commercial redistribution.**

- The official Swagger spec **does** have a per-grade population endpoint: `GET /pop/GetPSASpecPopulation/{specID}`. It returns counts for every grade from 1 to 10, including half-grades and qualifiers, for both PSA and PSA/DNA. It works one SpecID at a time. There is no bulk or by-set endpoint.
- The cert response (`GetByCertNumber`) includes `TotalPopulation`, `TotalPopulationWithQualifier` and `PopulationHigher`. These describe **the cert's own grade only** (the number at that grade and the number graded higher). They are not a per-grade breakdown.
- The quota is **100 calls per day**. PSA's own 429 error body says: *"API calls quota exceeded! maximum admitted 100 per Day. Please contact collectors-apis@collectors.com"*. Mid-2026 reports say free tokens were cut to about 1 call per day (**UNVERIFIED**). At either level, keeping a pop table for thousands of Pokémon and One Piece SpecIDs is not realistic without a paid plan from PSA.
- **Terms:** the Collectors User Agreement allows only "informational, personal and non-commercial use" of Content and bans commercial use and redistribution without written permission. The separate "PSA API End User Agreement" sits behind a login and **we could not read it**. It may widen or narrow these rights. **Needs Jamie/lawyer review.**
- **Cert lookup for listing validation (§5.1) is technically a good fit.** It returns Subject, CardNumber, Year, Brand, Variety, CardGrade and SpecID. The same quota and terms limits apply.

---

## 2. Endpoints

Base URL: `https://api.psacard.com/publicapi`. All endpoints are `GET`, take one path parameter, and return JSON or XML (`application/json`, `text/json`, `application/xml`, `text/xml`). Security uses a `Bearer` header (Swagger `securityDefinitions.Bearer`: apiKey, `Authorization`, in header). Source: swagger.json.

| # | Method and path | Param | Response model | Notes |
|---|---|---|---|---|
| 1 | `GET /cert/GetByCertNumber/{certNumber}` | `certNumber` (string) | `PublicCertificationModel` = `{ PSACert: PublicPSACert, DNACert: PublicDNACert }` | Main cert lookup. This is the only method named in the HTML docs. |
| 2 | `GET /cert/GetByCertNumberForFileAppend/{certNumber}` | `certNumber` (string) | `CertFileAppendModel` = `{ CertificationType (enum 0–4), IsHologram, IsReverseBarcode, PSACert, PSAPopulation, DNACert }` | Flatter shape, "file append" style. Has `SetName`, `Grade` and `QualifierCode`. Population fields come back as strings. |
| 3 | `GET /cert/GetImagesByCertNumber/{certNumber}` | `certNumber` (string) | `object` (no schema given) | Image URLs for the cert. **UNVERIFIED** response shape, since Swagger only says `type: object`. |
| 4 | `GET /order/GetProgress/{orderNumber}` | `orderNumber` (string) | `OrderProgress` | Grading-order tracking: `orderNumber, problemOrder, readyForLabelReview, gradesReady, accountingHold, shipped, shipTrackingNumber, shipCarrier, orderProgressSteps[{index, step (enum 0–8), completed}]`. Not relevant to us. |
| 5 | `GET /order/GetSubmissionProgress/{submissionNumber}` | `submissionNumber` (string) | `OrderProgress` | As above, looked up by submission number. Not relevant. |
| 6 | `GET /pop/GetPSASpecPopulation/{specID}` | `specID` (int32) | `PSASpecPopulationModel` = `{ SpecID, Description, PSAPop, PSADNAPop }` | **The population endpoint.** `PSAPop` and `PSADNAPop` are both `PSASpecPopSummmaryModel` (the triple "m" is in the spec). |

### 2.1 `PublicPSACert` fields (from GetByCertNumber)

`CertNumber` (string), `SpecID` (int32), `SpecNumber` (string), `LabelType` (string), `ReverseBarCode` (bool), `Year` (string), `Brand` (string), `Category` (string), `CardNumber` (string), `Subject` (string), `Variety` (string), `IsPSADNA` (bool), `IsDualCert` (bool), `GradeDescription` (string), `CardGrade` (string), `PrimarySigners` (string[]), `OtherSigners` (string[]), `AutographGrade` (string), **`TotalPopulation` (int32)**, **`TotalPopulationWithQualifier` (int32)**, **`PopulationHigher` (int32)**, `T206PopulationAllBacks` (int32), `T206PopulationHigherAllBacks` (int32), `ItemStatus` (string).

`PublicDNACert` (autographs/memorabilia): `CertNumber, ItemDescription, Tag, PrimarySubjects[SubjectDetail], OtherSubjects[SubjectDetail], Attributes[{key,value}], ItemEra, Model, Length, Weight, AuthenticationResult, SignatureGrade, BaseballGrade, Notes, DNAItemType`.

**Are the population fields per grade?** No. The cert response gives only `TotalPopulation`, which is our reading of "number of this spec at this cert's grade", and `PopulationHigher`, "number graded higher". The Swagger spec has no field descriptions, so these meanings are inferred from the field names and PSA's cert-page conventions (**UNVERIFIED** semantics). One third-party write-up (maccann-24, below) claims these fields are "always `null`" through the public API. **UNVERIFIED**: we could not test it without a token.

### 2.2 `CertFileAppendModel` sub-objects

- `PSACert`: `CertNumber, Year, Category, SetName, CardNumber, Subject, Variety, Grade, QualifierCode, GradeDescription` (all strings)
- `PSAPopulation`: `TotalPopulation, PopulationHigher, TotalPopulationWithQualifier, T206PopulationAllBacks, T206PopulationHigherAllBacks` (all strings)
- `DNACert`: `AuthenticationResult, PrimarySubject`

### 2.3 `PSASpecPopSummmaryModel` (GetPSASpecPopulation): per grade

All int32: `Total, Auth, Grade1, Grade1Q, Grade1_5, Grade1_5Q, Grade2, Grade2Q, Grade2_5, Grade3, Grade3Q, Grade3_5, Grade4, Grade4Q, Grade4_5, Grade5, Grade5Q, Grade5_5, Grade6, Grade6Q, Grade6_5, Grade7, Grade7Q, Grade7_5, Grade8, Grade8Q, Grade8_5, Grade9, Grade9Q, Grade10`.

This is a full per-grade table for one SpecID. There is no endpoint to list the SpecIDs in a set or to search specs. The only way to get a SpecID through the API is a cert lookup (`PublicPSACert.SpecID`). So the API alone cannot enumerate the Pokémon or One Piece catalogues.

Note: the public HTML docs still say *"We currently offer access to data from Cert Verification for single item searches by cert number"* (https://www.psacard.com/publicapi/documentation). The pop and order endpoints appear only in Swagger. Several third-party blogs (cardgrader.ai, June 2026) say "there is no public PSA API for population reports". **That is wrong according to PSA's own Swagger spec**, although whether a free token can call the pop endpoint is **UNVERIFIED**.

---

## 3. Auth

- You need a PSA (Collectors) account. The /publicapi page says: *"For security, we use OAuth 2 with password grant to obtain an access token for you using your PSA login credentials. Remember to never expose your credentials in any public website's client-side code."* (https://www.psacard.com/publicapi)
- The docs page says: *"We use your PSA login credentials to generate an access token that can be then used to make calls to our REST API. To get an access token you will need to sign in or register."* The page's JavaScript POSTs to `/publicapi/generatetoken` and shows `data.Token`. In practice you press a "generate token" button on the documentation page while signed in (https://www.psacard.com/publicapi/documentation).
- Usage: header `Authorization: bearer <access token>`. The documented example is `GET https://api.psacard.com/publicapi/cert/GetByCertNumber/00000000`.
- **Token lifetime: UNVERIFIED.** PSA's public pages don't state it. One third-party doc (maccann-24, Jan 2026) says tokens "do not expire" but can be regenerated. Not confirmed.
- Error conventions from the docs: 500 "usually … invalid credentials"; 4xx means a bad path; 204 means empty request data. A 200 can still carry `{ "IsValidRequest": false, "ServerMessage": "Invalid CertNo" }` or `{ "IsValidRequest": true, "ServerMessage": "No data found" }`. Success is `"ServerMessage": "Request successful"`.

---

## 4. Limits

- **Verified first-hand (2026-09-27):** one unauthenticated `GET /cert/GetByCertNumber/00000000` from this sandbox returned **HTTP 429** with `retry-after: 76216` and this body:
  > "API calls quota exceeded! maximum admitted 100 per Day. Please contact collectors-apis@collectors.com"

  So the enforced quota is **100 per day**. Unauthenticated calls are counted, most likely per IP; our shared egress IP was already exhausted. There are no rate-limit headers apart from `retry-after`.
- **Reported change (UNVERIFIED):** web-search snippets from an Apify actor listing (lulzasaur/psa-pop-scraper) say *"As of mid-2026, PSA reduced their public API to ~1 call/day for both anonymous and free registered tokens, so cert/specID lookups now require a PAID PSA API plan (contact collectors-apis@collectors.com)"*. We could not find that sentence on the live page. A Collectors Universe forum thread supports it: user 80sOPC wrote on 2026-06-24, *"my account can only make one API call per day"*, and on 2026-06-25, *"PSA just told me their killed the free API tier"*. Another user (bgr, 2026-06-22) reported *"Limit of 100 calls per day"* and mentioned having a Collectors Club premium tier (https://forums.collectors.com/discussion/1123788/psa-api).
- **Paid tiers:** a paid plan exists, going by the 429 message's contact address and the reports above. **No public pricing, tiers or SLA** were found. Contact: `collectors-apis@collectors.com`.
- **Scale check:** refreshing pop for about 5,000 SpecIDs daily takes about 5,000 calls per day, 50 times the stated quota. A one-off catalogue seed through cert lookups is also impractical, because it needs a cert number for every spec.

---

## 5. Terms

### 5.1 PSA API End User Agreement: NOT READ
The docs page links *"Review the PSA API End User Agreement"* to `/publicapi`. When signed out, that page shows only a sign-in prompt, so the agreement is shown only to signed-in users (for example in a click-through). Guessed URLs (`/publicapi/agreement`, `/publicapi/terms`, `/publicapi/eula` and others) return not-found. We did not register an account to read it, per instructions. **Jamie needs to sign in and copy the text. Needs Jamie/lawyer review.**

### 5.2 Collectors User Agreement (governs psacard.com and the API, since the API is a "Service")
Source: https://app.collectors.com/collectorsuseragreement ("Last Updated: July 9, 2026"). It applies to all Collectors entities, including PSA, SGC, Beckett (listed as "Beckett Collectibles, LLC") and Ladder Studios (Card Ladder).

| Topic | Quote | Our interpretation |
|---|---|---|
| Ownership of data | "Content included on the Services, including without limitation information, data, software, images … is protected by copyright … Collectors … owns and retains all Rights in the Content, … including the copyright in the selection, coordination, arrangement, and enhancement of such Content. Except as expressly authorized or licensed in writing, you may not copy, modify, delete, publish, transmit, participate in the transfer or sale, lease or rental of, create derivative works from or in any way exploit any of the Content…" | PSA claims pop and cert data as its Content, including compilation copyright. Bare facts such as a count may not be protectable in Australia (compare *IceTV v Nine*, *Telstra v Phone Directories*), but the contract terms still bind us. **Needs lawyer review.** |
| Licence scope (commercial use) | "We grant you a limited, revocable, non-transferrable, non-sublicensable, non-exclusive license to access and make informational, personal and non-commercial use of the Services and Content…" | A commercial market-cap site is outside the default licence. |
| Display and redistribution | "It is strictly prohibited to modify, transmit, distribute, reuse, repost, 'frame' or use the Content for public or commercial purposes … without written permission from an authorized representative of Collectors…" | Showing PSA pop numbers publicly on a monetised site needs written permission, unless the API EUA grants it. |
| Copy and cache | "…provided you retain all copyright … notices …, do not modify or alter the material, and do not copy or post the material on any network computer or broadcast the material in any media (other than as expressly permitted by the applicable Terms of Service)." | Storing PSA data in our database and serving it is prohibited by default. |
| Commercial purposes | Users agree not to "use Services or Content for advertisements, … solicitations, or any other commercial purposes, without our prior express written consent" | Same conclusion. |
| Mirroring or competing | "frame or mirror any portion or feature of the Services or Content, or commercialize any Collectors application or any Content associated with such application" | A pop table built from PSA data risks counting as "mirroring". This clause is the closest thing to a non-compete. No explicit "competing service" clause was found. |
| Scraping and automated access | "use any 'deep-link', 'page-scrape', 'robot', 'spider', or other automatic device, program, algorithm, or methodology, or any similar or equivalent manual process, to: (1) retrieve, scrape, access, acquire, copy, or monitor any portion of the Services or Content; (2) reproduce or circumvent the navigational structure or presentation of the Services or Content; or (3) data mine, obtain, or attempt to obtain any materials … through any means not purposely made available through the Services" | **Scraping the pop report is prohibited.** Even a "similar or equivalent manual process" is covered. The API is a means "purposely made available", so API use is probably allowed within whatever the API EUA says. |
| Attribution | No attribution or "powered by PSA" clause was found in the User Agreement. Proprietary notices must be kept. Using PSA marks needs "express prior written consent". | We can't use the PSA logo without permission. Describing grades in words ("PSA 10") is ordinary descriptive use (**lawyer to confirm**). |
| Linking | "Linking to any page on any of the Services is strictly prohibited in the absence of our prior written consent." | This is surprisingly broad and may not be enforceable in practice, but deep-linking to a cert page from a listing technically breaches it. **Needs Jamie/lawyer review.** |
| Revocation and termination | "Collectors may revoke this license at any time in its sole discretion." PSA may also "take technical and/or legal steps to prevent you from using our Services." | Any reliance on PSA access is fragile. |
| Disputes | Arbitration with the AAA and a class-action waiver (Section 17). Not applicable to Canadian users. | A lawyer should note this for an Australian entity. |

### 5.3 PSA Submission Services Terms (https://www.psacard.com/termsandconditions, "Last Updated: April 22, 2026")
§23 "Data and Image Usage": submitters agree that *"PSA will be the exclusive owner of all Submission Content"*, which includes *"data relating to the identity, production, condition and grade of the item (the 'Data')"* and Images, and that *"PSA may use and exploit such Submission Content for commercial and any other purposes"*. This strengthens PSA's claim over cert data and slab images. That matters if we show PSA images from `GetImagesByCertNumber`. **Needs lawyer review:** can a seller re-show PSA's image of their own slab on our listing?

---

## 6. Options for population data (ranked)

| Rank | Option | What you get | Cost (public?) | Licence position | Status |
|---|---|---|---|---|---|
| 1 | **PSA paid API plan / data licence** (collectors-apis@collectors.com) | `GetPSASpecPopulation` per SpecID, plus cert lookup, at a higher quota. A bulk feed may be possible. | Not public | Best position if the contract grants commercial display rights | Contact exists (confirmed in the 429 body). Existence of a bulk or licence product is **UNVERIFIED**. |
| 2 | **GemRate Partner API** (https://www.gemrate.com/partner) | "Universal pop report" across PSA, BGS, SGC and CGC. Pop, gem rate and cert lookup across graders. Universal card IDs. Updated daily. (From search snippets; the page is behind a Cloudflare challenge and we couldn't render it.) | Not public, per search results | Whether GemRate holds a licence from PSA is **UNVERIFIED**. Card Ladder (owned by Collectors) reportedly partners with GemRate for pop, which suggests Collectors tolerates or endorses it (**UNVERIFIED**, from search snippets). | Live. The homepage showed daily grading stats as of 2026-09-26 (search snippet). |
| 3 | **PokemonPriceTracker API** (https://www.pokemonpricetracker.com/psa-pokemon-card-api) | "Graded population counts and gem rates per grader" (Business plan and above). Pokémon only, so no One Piece. | Free $0 (100 credits/day, personal only), API $9.99/mo, **Business $99/mo (commercial use licence, includes pop)**, Enterprise $300/mo | Data source for pop isn't stated. The vendor offers a "Commercial use licence", but may not be able to pass on rights it doesn't have (**UNVERIFIED**). | Live (page read 2026-09-27). |
| 4 | **Card Ladder Pro** (Collectors-owned) | Pop reports for PSA, BGS, SGC and CGC in the UI | $20/mo or $200/yr (search snippet, **UNVERIFIED**) | A consumer subscription under the same Collectors User Agreement. No API. Scraping is prohibited. **Not usable as a data source.** | Live |
| 5 | Apify / Parse.bot scrapers (e.g. lulzasaur/psa-pop-scraper, "from $15.00 / 1,000 results") | Pop by set, spec or cert | Pay per result | **They scrape psacard.com.** Using them breaches the Collectors User Agreement scraping clause and is reputationally risky. **Not recommended.** | Live |
| 6 | Free PSA API, 100/day (or possibly ~1/day) | Pop for a handful of SpecIDs per day | Free | Non-commercial default licence. The API EUA is unread. | Quota may already be cut to ~1/day |

---

## 7. Recommendation

1. **Don't plan an MVP around the free PSA API for population.** The quota (100/day, possibly about 1/day) and the non-commercial licence both rule it out. Treat pop as a v1.1 feature behind a licensed feed.
2. **Email collectors-apis@collectors.com now.** Describe the use case (an Australian TCG market-cap site, Pokémon and One Piece, displaying per-grade pop with attribution, caching daily) and ask for pricing, quota, the full API EUA text, and explicit display, caching and attribution rights. In parallel, ask GemRate's partner programme for pricing and whether it holds a PSA licence.
3. **For §5.1 listing validation:** cert lookup is the right tool technically. It autofills Subject, CardNumber, Year, Brand, Variety, CardGrade and SpecID and confirms the cert exists (`ItemStatus`, `IsValidRequest`). At 100 calls/day it can handle only a very low listing volume. It needs a server-side token (never in client code, per PSA). Store only what we need (cert, grade and our own card mapping), not PSA's full record, until the EUA has been reviewed. If the free tier really is about 1/day, validation also needs the paid plan. A fallback is GemRate's cross-grader cert lookup (**UNVERIFIED** pricing). A manual fallback, where the seller enters the cert number and we link to psacard.com/cert, has a linking-clause question (§5.2).
4. **Don't scrape PSA pop pages or use third-party scrapers.** The User Agreement bans it explicitly, including "similar or equivalent manual process[es]".

---

## 8. Open questions for Jamie

1. Can you sign in to psacard.com, open https://www.psacard.com/publicapi, and copy the full **PSA API End User Agreement**? Also note the token's stated expiry and the quota shown on your account.
2. Do you want to contact collectors-apis@collectors.com (paid plan or licence) and GemRate partner sales yourself, or should we draft the emails?
3. Budget ceiling for pop data: is PokemonPriceTracker Business at $99 USD/mo acceptable as a stopgap for Pokémon only? One Piece would still be uncovered.
4. Lawyer questions: (a) Does the "no linking without consent" clause affect linking listings to psacard.com/cert? (b) Can Australian users of our site show PSA pop counts (facts) without a licence, given the contract terms? (c) Can we show PSA slab images from `GetImagesByCertNumber` on seller listings? (d) What is the effect of the AAA arbitration clause on an AU entity?
5. What listing volume do we expect at launch? That determines whether 100 cert validations a day is enough.

---

## 9. Sources

- PSA Swagger UI: https://api.psacard.com/publicapi/swagger (loads `/publicapi/swagger.json`)
- **PSA Swagger JSON:** https://api.psacard.com/publicapi/swagger.json. Saved locally as `psa-swagger.json`. Note: `/publicapi/swagger/docs/v1` returns 404.
- PSA Public API docs: https://www.psacard.com/publicapi/documentation
- PSA Public API landing (and EUA link target): https://www.psacard.com/publicapi
- Live 429 response from `https://api.psacard.com/publicapi/cert/GetByCertNumber/00000000`, 2026-09-27 09:09 UTC
- Collectors User Agreement (updated 2026-07-09): https://app.collectors.com/collectorsuseragreement
- PSA Submission Services Terms (updated 2026-04-22): https://www.psacard.com/termsandconditions
- Collectors Universe forum, "PSA API" thread (June 2026): https://forums.collectors.com/discussion/1123788/psa-api
- CardGrader blog, "PSA API Guide (2026)", 2026-06-12. Third-party; its claim of no pop API is contradicted by Swagger: https://cardgrader.ai/blog/psa-api
- maccann-24 sports-card-research, 02-PSA-API.md (Jan 2026). Third-party, unverified claims: https://github.com/maccann-24/sports-card-research/blob/master/02-PSA-API.md
- Apify, lulzasaur/psa-pop-scraper (source of the "~1 call/day" snippet; scraper): https://apify.com/lulzasaur/psa-pop-scraper
- GemRate Partner API (blocked by Cloudflare; details from search snippets): https://www.gemrate.com/partner
- PokemonPriceTracker PSA API pricing: https://www.pokemonpricetracker.com/psa-pokemon-card-api
- Card Ladder: https://www.cardladder.com/ (homepage: "View population reports from PSA, BGS, SGC and CGC"). Acquisition by Collectors Universe: https://www.psacard.com/articles/articleview/10556/collectors-universe-acquires-trading-card-valuation-platform-ladder
