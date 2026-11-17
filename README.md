# Omaha rentals map

A one-page, map-first site for comparing places to rent in the Old Market, downtown and nearby, with the planned Omaha streetcar line for reference. Static files only: no backend, no build step, no API keys, no outside scripts.

| File | What it does |
|---|---|
| `index.html` | The page. Loads Leaflet 1.9.4 from `vendor/leaflet/` (with integrity hashes), then `styles.css` and `app.js`. |
| `styles.css` | Layout and look. Phone first, light and dark follow the device setting. |
| `app.js` | Reads `listings.json` and draws the map, filters and cards. It never edits, rounds or fills in a value. |
| `listings.json` | The data. Everything on the page comes from here. |
| `vendor/leaflet/` | Leaflet 1.9.4 (`leaflet.js`, `leaflet.js.map`, `leaflet.css`, `images/`, `LICENSE`), copied from the official release. |

## Never publish listings-full.json

`listings-full.json` is the private working file. It must **never** be in the site folder or in the repository, not even for a moment: GitHub keeps every committed file in its history. Only the public `listings.json` goes here. Before every upload, check the folder you are dragging in does not contain `listings-full.json`.

## Replace listings.json

1. Keep the same shape: a top-level `streetcar` object, a `listings` array, and `excluded.records` (shown on the map as grey "X" pins).
2. Save the new file as `listings.json` in the same folder, replacing the old one. Keep the name exactly.
3. Check it is valid JSON before you upload (paste it into any JSON validator, or run `python -m json.tool listings.json`).
4. Upload it to the repository (on GitHub: open the repo, **Add file → Upload files**, drop the file, **Commit changes**).
5. Wait a minute, then reload the page. If the old data still shows, do a hard reload (Ctrl+Shift+R, or on a phone close and reopen the tab).

Fields the page reads: `id`, `name`, `address`, `lat`, `lng`, `area`, `area_rank`, `type`, `tier`, `beds`, `baths`, `sqft`, `rent_low`, `rent_high`, `rent_checked_date`, `lease_terms_offered`, `shortest_lease_months`, `short_lease_premium`, `laundry`, `parking_type`, `parking_cost_one`, `parking_cost_two`, `cat_allowed`, `pet_fees`, `all_in_per_person`, `office_note`, `nearest_stop`, `walk_minutes`, `walk_method`, `picked_by`, `missing_must_haves`, `listing_url`, `listing_status`, `listing_checked_date`, `public_note`, `verified_date`; and from `streetcar`: `route_line`, `route_line_note`, `stops`, `opening_date`, `opening_date_sources`.

Rules the page follows:
- Any value that starts with `could not determine`, or is exactly `unknown`, shows as a muted **Not confirmed** (with any detail that followed "could not determine").
- Numbers are shown with thousands commas and every decimal they have. Nothing is rounded.
- Where a value carries a remark in brackets (for example a square-foot range), the unit is shown beside the number and the remark after it. Display only; the data is not changed.
- `tier` of `"1"`, `"2"`, `"3"` gets a pin colour and the number on the pin. Excluded records get "X". `tier` of `"sale"` gets a square "S" pin, and its rent and all-in figures are labelled "Rough estimate, not financial advice".
- A record is also drawn as a **square** pin (for sale) if its `type` contains "sale" or it has `"for_sale": true`.
- `listing_status` of `"gone"` shows "Listing gone as of" the `listing_checked_date`, the link reads "Open last known listing", and the place sorts after live ones. "Hide gone listings" (off by default) removes them.
- Pins closer than 44 px on screen are drawn as one dark pin with a count. Tapping it opens a short chooser listing those places by name, with a "Zoom in to these" button.
- Default sort is price: places with a listed monthly rent first, cheapest to priciest (`rent_low`, then `rent_high`), then places without a price. Gone listings always come last.
- Each card shows its monthly rent in bold italics under the title, or "Price not confirmed".
- Excluded places are hidden by default (tick "Excluded" under Tier to show them). The opening view and "Show all pins" fit only the places currently showing.
- The rent slider's range comes from the monthly rents of the places currently showing (after every other filter). Both ends are rounded up to whole dollars, so the lowest setting still includes the cheapest of them.
- The page is written for anyone: it does not show `all_in_per_person`, `picked_by`, `office_note` or `missing_must_haves`. Those fields are still in `listings.json`, so anyone who opens that file can read them.
- The "Prices checked on" date in the header is the newest `rent_checked_date` in the file. The opening date links to the first entry in `opening_date_sources`.
- `listing_url` only becomes a link if it starts with `http://` or `https://`.

Note: `listings.json` is a public file once the site is live, even though the page asks search engines not to index it. Every field in it (including office notes and phone numbers) can be read by anyone who has the address.

## Turn on GitHub Pages

1. On GitHub, create a repository (it can be public; Pages on a private repo needs a paid plan).
2. Upload `index.html`, `styles.css`, `app.js`, `listings.json`, `README.md` and the whole `vendor` folder to the top level of the `main` branch. Drag the `vendor` folder itself onto the upload page so its inner folders are kept.
3. Open the repo's **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. Wait one or two minutes. The address appears at the top of the Pages screen, for example `https://<your-user>.github.io/<repo-name>/`.
6. Open it on both phones. Each phone keeps its own shortlist (stars are saved in that browser only).

All paths are relative, so the site works from a project path like `/<repo-name>/`. It will not work opened straight from disk (`file://`) because the browser blocks loading `listings.json` that way. To test on a computer, run `python -m http.server` in the folder and open `http://localhost:8000/`.

## Leaflet copy

The files in `vendor/leaflet/` came from the npm package `leaflet@1.9.4` and were checked on 16 Nov 2026:
- `leaflet.js` and `leaflet.css` match the official integrity hashes Leaflet publishes for 1.9.4 (`sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=` and `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`). The page loads them with those hashes, so a changed file will not run.
- `leaflet.css`, `leaflet.js.map` and all five images are byte-identical to the GitHub release `v1.9.4/leaflet.zip`. That zip's `leaflet.js` differs only in its first comment line (a build stamp); the code is identical.

## Map tiles

Map tiles come from OpenStreetMap's standard tile server (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), checked against the OSM Foundation Tile Usage Policy on 16 Nov 2026. That policy allows light use like this with:
- visible "© OpenStreetMap contributors" attribution (bottom right of the map, plus the page footer),
- the browser's normal Referer header (the page does not block it),
- no bulk downloading, prefetching or offline use (the page does none).

OSM can block any site without notice and gives no uptime promise. If tiles stop loading, swap `TILE_URL` and `OSM_ATTR` at the top of `app.js` for another provider and its attribution, and add that host to `img-src` in the Content-Security-Policy line in `index.html`.

## No tracking

No analytics, cookies or outside scripts. Leaflet is served from this site. The only thing the browser fetches from elsewhere is map tiles (tile.openstreetmap.org). The page carries `noindex, nofollow`.
