/* Omaha rentals map. Reads listings.json and shows it as-is.
   No value from the data is edited, rounded or filled in here. */
(function () {
  "use strict";

  var NC = "could not determine";
  var STORE_KEY = "omaha-rent-shortlist-v1";
  var TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  var DOWNTOWN = [41.2577, -95.9370];
  // Pins whose centres are closer than this (in screen pixels) are drawn as one group pin.
  // It equals the 44 px round tap area, so no two tap areas can overlap.
  var GROUP_PX = 44;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var AREA_LABELS = {
    "downtown": "Downtown",
    "old-market": "Old Market",
    "midtown-corridor": "Midtown corridor",
    "blackstone": "Blackstone",
    "little-italy": "Little Italy",
    "other": "Other"
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var $ = function (id) { return document.getElementById(id); };

  var state = { places: [], byId: {}, map: null, rings: null, pins: null, shortlist: {}, activeId: null, shownIds: {} };

  /* ---------- storage (wrapped: may be blocked or throw) ---------- */
  function loadShortlist() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      var out = {};
      if (Array.isArray(arr)) arr.forEach(function (id) { if (typeof id === "string") out[id] = true; });
      return out;
    } catch (e) { return {}; }
  }
  function saveShortlist() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.keys(state.shortlist))); }
    catch (e) { /* storage unavailable: shortlist lasts for this visit only */ }
  }

  /* ---------- display helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function isNC(v) { return typeof v === "string" && v.toLowerCase().indexOf(NC) === 0; }
  function isUnknown(v) { return typeof v === "string" && v.trim().toLowerCase() === "unknown"; }
  function isMissing(v) { return v === undefined || v === null || v === "" || isNC(v) || isUnknown(v); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // Format a number with thousands separators, keeping every decimal it has.
  function num(v) {
    var s = String(v);
    var dec = s.indexOf(".") >= 0 ? s.split(".")[1].length : 0;
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function money(v) { return "$" + num(v); }

  // Any value: empty, "unknown" or "could not determine..." becomes muted "Not confirmed"
  // (plus any detail that followed "could not determine").
  function valueNode(v, fmt) {
    var span = el("span");
    if (v === undefined || v === null || v === "" || isUnknown(v)) {
      span.className = "nc"; span.textContent = "Not confirmed"; return span;
    }
    if (isNC(v)) {
      span.appendChild(el("span", "nc", "Not confirmed"));
      var rest = v.slice(NC.length).trim();
      if (rest) span.appendChild(document.createTextNode(" " + rest));
      return span;
    }
    span.textContent = isNum(v) && fmt ? fmt(v) : String(v);
    return span;
  }

  // A value with a unit, e.g. sqft "984-1,001 (The Wardrobe...)" shows as
  // "984-1,001 sq ft (The Wardrobe...)": the unit goes beside the number and any
  // bracketed remark after it. Display only; the value itself is untouched.
  function unitNode(v, unit) {
    if (isMissing(v)) return valueNode(v);
    var s = String(v);
    var cut = s.indexOf("(");
    var head = cut > 0 ? s.slice(0, cut).trimEnd() : s;
    var tail = cut > 0 ? s.slice(cut) : "";
    var span = el("span", null, head + unit);
    if (tail) span.appendChild(el("span", "sub", " " + tail));
    return span;
  }

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }
  function areaLabel(a) { return AREA_LABELS[a] || String(a || ""); }
  function isSaleTier(p) { return String(p.tier).toLowerCase() === "sale"; }
  function tierKey(p) { return p.excluded ? "none" : String(p.tier); }
  function tierLabel(p) {
    if (p.excluded || p.tier === "none") return "Excluded";
    if (isSaleTier(p)) return "For sale";
    return "Tier " + p.tier;
  }
  function tierShort(p) {
    if (p.excluded || p.tier === "none") return "X";
    if (isSaleTier(p)) return "S";
    return String(p.tier);
  }
  function tierClass(p) {
    if (p.excluded || p.tier === "none") return "tx";
    if (isSaleTier(p)) return "ts";
    return { "1": "t1", "2": "t2", "3": "t3" }[String(p.tier)] || "tx";
  }
  function tierRank(p) {
    if (p.excluded) return 99;
    if (isSaleTier(p)) return 4;
    var n = parseInt(p.tier, 10);
    return isNaN(n) ? 98 : n;
  }
  function isForSale(p) {
    return isSaleTier(p) || p.for_sale === true || /sale/i.test(String(p.type || "")) || /sale/i.test(String(p.listing_kind || ""));
  }
  function isGone(p) { return String(p.listing_status || "").toLowerCase() === "gone"; }
  function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u : null; }

  /* ---------- field tests used by filters ---------- */
  function catStatus(p) {
    var c = String(p.cat_allowed || "").toLowerCase();
    if (/^yes, likely/.test(c)) return "likely";
    if (/^yes/.test(c)) return "yes";
    if (/^no/.test(c)) return "no";
    return "unknown";
  }
  function hasInUnitLaundry(p) { return /^in-unit/i.test(String(p.laundry || "")); }
  function pickedBy(p, who) {
    var v = String(p.picked_by || "");
    return v === who || v.toLowerCase() === "both";
  }
  function pickTags(p) {
    var v = String(p.picked_by || "");
    if (v.toLowerCase() === "both") return ["M", "G"];
    if (v === "M" || v === "G") return [v];
    return [];
  }

  /* ---------- load ---------- */
  function start() {
    state.shortlist = loadShortlist();
    fetch("listings.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(init)
      .catch(function (e) {
        $("streetcar-line").textContent = "Could not load listings.json (" + e.message + "). Open this page from a web server, not as a file.";
      });
  }

  function init(data) {
    var listings = (data.listings || []).map(function (p) { return Object.assign({}, p, { excluded: false }); });
    var excl = (data.excluded && data.excluded.records || []).map(function (p) { return Object.assign({}, p, { excluded: true }); });
    state.places = listings.concat(excl);
    state.places.forEach(function (p) { state.byId[p.id] = p; });
    state.data = data;

    renderHeader(data);
    renderStops(data);
    buildMap(data);
    buildFilters();
    bindFilters();
    apply();
    // Size the map to its final box before fitting, and again whenever the layout changes.
    state.map.invalidateSize();
    fitAll();
    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.map.invalidateSize(); drawPins(); }, 150);
    });
  }

  function renderHeader(data) {
    var sc = data.streetcar || {};
    var line = $("streetcar-line");
    line.textContent = "";
    line.appendChild(document.createTextNode("Streetcar opening: "));
    var src = (sc.opening_date_sources || [])[0];
    var href = src && safeUrl(src.url);
    var dateText = sc.opening_date || "";
    if (dateText && href) {
      var a = el("a", null, dateText);
      a.href = href; a.target = "_blank"; a.rel = "noopener";
      a.setAttribute("aria-label", dateText + " (source: " + (src.source || "first source") + ", opens in a new tab)");
      line.appendChild(a);
      if (src.source) line.appendChild(document.createTextNode(" (source: " + src.source + ")"));
      line.appendChild(document.createTextNode("."));
    } else {
      line.appendChild(valueNode(dateText));
      line.appendChild(document.createTextNode(". Source: "));
      line.appendChild(el("span", "nc", "Not confirmed"));
    }

    var dates = state.places.map(function (p) { return p.rent_checked_date || p.verified_date; }).filter(Boolean).sort();
    var latest = dates.length ? dates[dates.length - 1] : data.generated;
    $("checked-line").textContent = "Prices checked on " + fmtDate(latest) + ". Confirm with the property.";

    if (sc.route_line_note) $("route-note").textContent = "Streetcar line: " + sc.route_line_note + " Stop points are block-start addresses, so a stop can sit up to half a block from the real platform.";
  }

  function renderStops(data) {
    var stops = (data.streetcar && data.streetcar.stops) || [];
    $("stops-summary").textContent = "Streetcar stops (" + stops.length + ")";
    var ol = $("stop-list");
    stops.forEach(function (s) { ol.appendChild(el("li", null, s.name)); });
  }

  /* ---------- map ---------- */
  function buildMap(data) {
    var map = L.map("map", { zoomControl: true, scrollWheelZoom: true, keyboard: true }).setView(DOWNTOWN, 14);
    state.map = map;
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);

    var sc = data.streetcar || {};
    state.rings = L.layerGroup();
    if (Array.isArray(sc.route_line) && sc.route_line.length > 1) {
      L.polyline(sc.route_line, { color: getVar("--route"), weight: 4, opacity: 0.9, dashArray: "8 6", interactive: false }).addTo(map);
    }
    (sc.stops || []).forEach(function (s) {
      if (!isNum(s.lat) || !isNum(s.lng)) return;
      // 800 m = about 10 min walk, 400 m = about 5 min. Light so 16 overlapping stops stay readable.
      L.circle([s.lat, s.lng], { radius: 800, color: getVar("--route"), weight: 1, opacity: 0.25, dashArray: "3 5", fill: false, interactive: false }).addTo(state.rings);
      L.circle([s.lat, s.lng], { radius: 400, color: getVar("--route"), weight: 1, opacity: 0.4, fillOpacity: 0.035, interactive: false }).addTo(state.rings);
      // Stop dots are decoration only: not tappable, not in the tab order. Names are in the stop list.
      var dot = L.circleMarker([s.lat, s.lng], { radius: 5, color: "#fff", weight: 2, fillColor: getVar("--route"), fillOpacity: 1, interactive: false }).addTo(map);
      var node = dot.getElement && dot.getElement();
      if (node) { node.setAttribute("aria-hidden", "true"); node.setAttribute("focusable", "false"); }
    });
    state.rings.addTo(map);
    state.rings.eachLayer(function (l) { l.bringToBack(); });

    state.pins = L.layerGroup().addTo(map);
    map.on("zoomend", drawPins);
  }

  function getVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#c2410c";
  }

  function visiblePlaces() {
    return state.places.filter(function (p) { return state.shownIds[p.id] && isNum(p.lat) && isNum(p.lng); });
  }

  // Group pins that sit closer than GROUP_PX on screen at the current zoom.
  function groupPins() {
    var map = state.map;
    var list = visiblePlaces().sort(function (a, b) {
      return (isGone(a) - isGone(b)) || (tierRank(a) - tierRank(b)) || a.name.localeCompare(b.name);
    });
    var groups = [];
    list.forEach(function (p) {
      var pt = map.latLngToLayerPoint([p.lat, p.lng]);
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].pt.distanceTo(pt) < GROUP_PX) { groups[i].members.push(p); return; }
      }
      groups.push({ pt: pt, latlng: L.latLng(p.lat, p.lng), members: [p] });
    });
    return groups;
  }

  function drawPins() {
    if (!state.map || !state.pins) return;
    state.pins.clearLayers();
    state.groups = groupPins();
    state.groups.forEach(function (g) {
      var m;
      if (g.members.length === 1) {
        var p = g.members[0];
        m = L.marker(g.latlng, { icon: pinIcon(p), title: p.name + " (" + tierLabel(p) + ")", keyboard: true, riseOnHover: true });
        m.on("click", function () { openCard(p.id, true); });
        m.on("add", function () {
          label(m, p.name + ", " + tierLabel(p) + (isForSale(p) ? ", for sale" : "") + (isGone(p) ? ", listing gone" : "") + ". Open card.",
            function () { openCard(p.id, true); });
        });
      } else {
        var names = g.members.map(function (x) { return x.name; });
        m = L.marker(g.latlng, { icon: groupIcon(g), title: g.members.length + " places: " + names.join(", "), keyboard: true, riseOnHover: true });
        m.on("click", function () { openChooser(g); });
        m.on("add", function () {
          label(m, g.members.length + " places close together: " + names.join(", ") + ". Choose one.",
            function () { openChooser(g); });
        });
      }
      var ids = g.members.map(function (x) { return x.id; }).join(" ");
      m.on("add", function () { var n = m.getElement(); if (n) n.dataset.ids = ids; });
      state.pins.addLayer(m);
    });
  }

  function label(m, text, act) {
    var node = m.getElement();
    if (!node) return;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", text);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
    });
  }

  function pinIcon(p) {
    var cls = "pin-shape " + tierClass(p) + (isForSale(p) ? " sale" : "") + (state.shortlist[p.id] ? " is-starred" : "") + (isGone(p) ? " is-gone" : "");
    return L.divIcon({
      className: "pin" + (state.activeId === p.id ? " is-active" : ""),
      html: '<span class="' + cls + '" aria-hidden="true">' + tierShort(p) + "</span>",
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }
  function groupIcon(g) {
    var starred = g.members.some(function (p) { return state.shortlist[p.id]; });
    var active = g.members.some(function (p) { return p.id === state.activeId; });
    return L.divIcon({
      className: "pin pin-group" + (active ? " is-active" : ""),
      html: '<span class="pin-shape group' + (starred ? " is-starred" : "") + '" aria-hidden="true">' + g.members.length + "</span>",
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  function openChooser(g) {
    var box = el("div");
    box.appendChild(el("p", "chooser-title", g.members.length + " places here. Choose one:"));
    var ol = el("ol", "chooser");
    g.members.forEach(function (p) {
      var li = el("li");
      var b = el("button");
      b.type = "button";
      b.dataset.id = p.id;
      var dot = el("span", "pin-demo " + tierClass(p) + (isForSale(p) ? " sale" : ""), tierShort(p));
      dot.setAttribute("aria-hidden", "true");
      b.appendChild(dot);
      b.appendChild(el("span", null, p.name));
      if (isGone(p)) b.appendChild(el("span", "gone-tag", "(gone)"));
      b.setAttribute("aria-label", p.name + ", " + tierLabel(p) + (isGone(p) ? ", listing gone" : "") + ". Open card.");
      b.addEventListener("click", function () {
        state.map.closePopup();
        openCard(p.id, true);
      });
      li.appendChild(b);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    var zoomBtn = el("button", "btn chooser-zoom", "Zoom in to these");
    zoomBtn.type = "button";
    zoomBtn.addEventListener("click", function () {
      state.map.closePopup();
      var b = L.latLngBounds(g.members.map(function (p) { return [p.lat, p.lng]; }));
      state.map.fitBounds(b, { padding: [40, 40], maxZoom: 19, animate: !reduceMotion });
    });
    box.appendChild(zoomBtn);
    // Keep the chooser inside the map: long lists scroll.
    var maxH = Math.max(160, state.map.getSize().y - 120);
    L.popup({ maxWidth: 300, maxHeight: maxH, autoPanPaddingTopLeft: [64, 12], autoPanPaddingBottomRight: [12, 12], className: "chooser-popup" })
      .setLatLng(g.latlng)
      .setContent(box)
      .openOn(state.map);
    var first = box.querySelector("button");
    if (first) first.focus({ preventScroll: true });
  }

  function fitAll() {
    state.map.invalidateSize();
    // Fit only the places that are showing. With none showing, fall back to the streetcar stops.
    var pts = visiblePlaces().map(function (p) { return [p.lat, p.lng]; });
    if (!pts.length) (state.data.streetcar && state.data.streetcar.stops || []).forEach(function (s) { pts.push([s.lat, s.lng]); });
    if (pts.length) state.map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16, animate: false });
    else state.map.setView(DOWNTOWN, 14);
    drawPins();
  }

  function flyTo(p) {
    if (!isNum(p.lat) || !isNum(p.lng)) return;
    var z = Math.max(state.map.getZoom(), 16);
    if (reduceMotion) state.map.setView([p.lat, p.lng], z);
    else state.map.flyTo([p.lat, p.lng], z, { duration: 0.6 });
  }

  /* ---------- filters ---------- */
  function buildFilters() {
    var tiers = {};
    state.places.forEach(function (p) { tiers[tierKey(p)] = p; });
    var keys = Object.keys(tiers).sort(function (a, b) { return tierRank(tiers[a]) - tierRank(tiers[b]); });
    var box = $("tier-boxes");
    keys.forEach(function (k) {
      var lab = el("label", "check");
      var cb = el("input");
      // Excluded places are off by default; tick the box to show them.
      cb.type = "checkbox"; cb.value = k; cb.checked = k !== "none"; cb.name = "tier";
      lab.appendChild(cb);
      lab.appendChild(el("span", null, tierLabel(tiers[k])));
      box.appendChild(lab);
    });

    var areas = {};
    state.places.forEach(function (p) { if (p.area) areas[p.area] = true; });
    var sel = $("f-area");
    Object.keys(areas).sort(function (a, b) { return areaLabel(a).localeCompare(areaLabel(b)); }).forEach(function (a) {
      var o = el("option", null, areaLabel(a)); o.value = a; sel.appendChild(o);
    });

    // The cost slider's range is set in apply(), from the places currently showing.
    $("f-cost").dataset.any = "1";

    var walks = state.places.map(function (p) { return p.walk_minutes; }).filter(isNum);
    var walk = $("f-walk");
    var wmax = walks.length ? Math.ceil(Math.max.apply(null, walks)) : 0;
    walk.min = 0; walk.max = wmax; walk.step = 1; walk.value = wmax;
  }

  function bindFilters() {
    $("filter-form").addEventListener("input", apply);
    $("filter-form").addEventListener("change", apply);
    $("filter-form").addEventListener("submit", function (e) { e.preventDefault(); });
    $("reset-btn").addEventListener("click", reset);
    $("empty-reset").addEventListener("click", reset);
    $("fit-btn").addEventListener("click", fitAll);
    $("rings-toggle").addEventListener("change", function (e) {
      if (e.target.checked) state.rings.addTo(state.map); else state.map.removeLayer(state.rings);
    });
  }

  function reset() {
    $("filter-form").querySelectorAll('input[name="tier"]').forEach(function (c) { c.checked = c.value !== "none"; });
    $("f-area").value = "";
    $("f-cost").dataset.any = "1";
    $("f-cost-unknown").checked = true;
    $("f-lease").value = "";
    $("f-parking").value = "";
    $("f-cat").value = "";
    $("f-walk").value = $("f-walk").max;
    $("f-picked").value = "";
    $("f-laundry").checked = false;
    $("f-short").checked = false;
    $("f-gone").checked = false;
    $("f-sort").value = "area";
    apply();
    fitAll();
  }

  function readFilters() {
    var tiers = {};
    $("filter-form").querySelectorAll('input[name="tier"]').forEach(function (c) { if (c.checked) tiers[c.value] = true; });
    var cost = $("f-cost"), walk = $("f-walk");
    return {
      tiers: tiers,
      area: $("f-area").value,
      costMax: cost.dataset.any === "1" || Number(cost.value) >= Number(cost.max) ? null : Number(cost.value),
      costUnknown: $("f-cost-unknown").checked,
      lease: $("f-lease").value ? Number($("f-lease").value) : null,
      parking: $("f-parking").value,
      cat: $("f-cat").value,
      walkMax: Number(walk.value) >= Number(walk.max) ? null : Number(walk.value),
      picked: $("f-picked").value,
      laundry: $("f-laundry").checked,
      shortOnly: $("f-short").checked,
      hideGone: $("f-gone").checked,
      sort: $("f-sort").value
    };
  }

  function passes(p, f) {
    if (!f.tiers[tierKey(p)]) return false;
    if (f.area && p.area !== f.area) return false;
    if (isNum(p.all_in_per_person)) {
      if (f.costMax !== null && p.all_in_per_person > f.costMax) return false;
    } else if (!f.costUnknown) return false;
    if (f.lease !== null && !(isNum(p.shortest_lease_months) && p.shortest_lease_months <= f.lease)) return false;
    if (f.parking === "one" && !isNum(p.parking_cost_one)) return false;
    if (f.parking === "two" && !isNum(p.parking_cost_two)) return false;
    if (f.cat === "yes" && catStatus(p) !== "yes") return false;
    if (f.cat === "yes-likely" && catStatus(p) !== "yes" && catStatus(p) !== "likely") return false;
    if (f.walkMax !== null && !(isNum(p.walk_minutes) && p.walk_minutes <= f.walkMax)) return false;
    if (f.picked && !pickedBy(p, f.picked)) return false;
    if (f.laundry && !hasInUnitLaundry(p)) return false;
    if (f.shortOnly && !state.shortlist[p.id]) return false;
    if (f.hideGone && isGone(p)) return false;
    return true;
  }

  // Gone listings always sort after live ones, whatever the sort.
  function sorter(mode) {
    function numOr(v) { return isNum(v) ? v : Infinity; }
    function diff(x, y) { return x === y ? 0 : (x < y ? -1 : 1); }
    return function (a, b) {
      var d = diff(isGone(a) ? 1 : 0, isGone(b) ? 1 : 0);
      if (d) return d;
      if (mode === "cost") d = diff(numOr(a.all_in_per_person), numOr(b.all_in_per_person));
      else if (mode === "walk") d = diff(numOr(a.walk_minutes), numOr(b.walk_minutes));
      else if (mode === "tier") d = diff(tierRank(a), tierRank(b));
      else d = diff(numOr(a.area_rank), numOr(b.area_rank)) || diff(numOr(a.all_in_per_person), numOr(b.all_in_per_person));
      return d ||
        diff(numOr(a.area_rank), numOr(b.area_rank)) ||
        diff(numOr(a.all_in_per_person), numOr(b.all_in_per_person)) ||
        diff(tierRank(a), tierRank(b)) ||
        a.name.localeCompare(b.name);
    };
  }

  // Cost slider range = the places that pass every other filter (so it follows
  // tiers, area and the rest). Whole dollars, both ends rounded UP, so the lowest
  // setting still includes the cheapest of those places (e.g. $949.84 shows at "up to $950").
  // At its top end the slider means "Any", and stays "Any" when the range changes.
  function updateCostRange(e) {
    var cost = $("f-cost");
    if (e && e.target === cost) cost.dataset.any = Number(cost.value) >= Number(cost.max) ? "1" : "0";
    var f = readFilters();
    f.costMax = null; f.costUnknown = true;
    var costs = state.places.filter(function (p) { return passes(p, f); })
      .map(function (p) { return p.all_in_per_person; }).filter(isNum);
    var cmin = costs.length ? Math.ceil(Math.min.apply(null, costs)) : 0;
    var cmax = costs.length ? Math.ceil(Math.max.apply(null, costs)) : 0;
    var keep = Number(cost.value);
    cost.min = cmin; cost.max = cmax; cost.step = 1;
    if (cost.dataset.any === "1") cost.value = cmax;
    else {
      cost.value = Math.min(Math.max(keep, cmin), cmax);
      if (Number(cost.value) >= cmax) cost.dataset.any = "1";
    }
    cost.disabled = !costs.length;
  }

  function apply(e) {
    updateCostRange(e);
    var f = readFilters();
    var cost = $("f-cost");
    var costText = f.costMax === null ? "Any" : "up to " + money(f.costMax) + " each (" + money(f.costMax * 2) + " combined)";
    $("f-cost-out").textContent = costText;
    cost.setAttribute("aria-valuetext", costText);
    $("f-walk-out").textContent = f.walkMax === null ? "Any" : "up to " + f.walkMax + " min";
    $("f-walk").setAttribute("aria-valuetext", f.walkMax === null ? "Any" : "up to " + f.walkMax + " minutes");

    var shown = state.places.filter(function (p) { return passes(p, f); }).sort(sorter(f.sort));
    state.shownIds = {};
    shown.forEach(function (p) { state.shownIds[p.id] = true; });
    drawPins();

    $("count").textContent = "Showing " + shown.length + " of " + state.places.length + " places";
    $("empty").hidden = shown.length > 0;

    var list = $("cards");
    list.textContent = "";
    shown.forEach(function (p) { list.appendChild(card(p)); });
  }

  /* ---------- cards ---------- */
  function fact(dl, label, nodeOrValue, sub) {
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    dd.appendChild(nodeOrValue instanceof Node ? nodeOrValue : valueNode(nodeOrValue));
    if (sub !== undefined && sub !== null && sub !== "") {
      dd.appendChild(el("br"));
      var s = el("span", "sub");
      s.appendChild(sub instanceof Node ? sub : valueNode(sub));
      dd.appendChild(s);
    }
    dl.appendChild(dd);
  }

  function joinNodes(parts) {
    var span = el("span");
    parts.forEach(function (part, i) {
      if (i) span.appendChild(document.createTextNode(part.sep || " · "));
      if (part.label) span.appendChild(document.createTextNode(part.label));
      span.appendChild(part.node || valueNode(part.value, part.fmt));
      if (part.after && !isMissing(part.value)) span.appendChild(document.createTextNode(part.after));
    });
    return span;
  }

  function rentNode(p) {
    var lo = p.rent_low, hi = p.rent_high;
    if (isMissing(lo) && isMissing(hi) && String(lo) === String(hi)) return valueNode(lo);
    if (isNum(lo) && isNum(hi) && lo === hi) return valueNode(lo, money);
    return joinNodes([{ value: lo, fmt: money }, { value: hi, fmt: money, sep: " – " }]);
  }

  var EST_NOTE = "Rough estimate, not financial advice";

  function card(p) {
    var sale = isForSale(p);
    var gone = isGone(p);
    var li = el("li", "card" + (state.activeId === p.id ? " is-active" : "") + (gone ? " is-gone" : ""));
    li.id = "card-" + p.id;
    li.dataset.id = p.id;

    var top = el("div", "card-top");
    var title = el("button", "card-title", p.name);
    title.type = "button";
    title.setAttribute("aria-label", p.name + ": show on map");
    title.addEventListener("click", function () { openCard(p.id, false); flyTo(p); });
    top.appendChild(title);

    var on = !!state.shortlist[p.id];
    var star = el("button", "star", on ? "★" : "☆");
    star.type = "button";
    star.setAttribute("aria-pressed", on ? "true" : "false");
    star.setAttribute("aria-label", (on ? "Remove " : "Add ") + p.name + (on ? " from" : " to") + " shortlist");
    star.addEventListener("click", function (e) {
      e.stopPropagation();
      if (state.shortlist[p.id]) delete state.shortlist[p.id]; else state.shortlist[p.id] = true;
      saveShortlist();
      apply();
      var again = document.querySelector("#card-" + cssId(p.id) + " .star");
      if (again) again.focus();
    });
    top.appendChild(star);
    li.appendChild(top);

    var badges = el("div", "badges");
    badges.appendChild(el("span", "badge tier " + tierClass(p), tierLabel(p)));
    if (sale && !isSaleTier(p)) badges.appendChild(el("span", "badge", "For sale"));
    badges.appendChild(el("span", "badge", areaLabel(p.area)));
    pickTags(p).forEach(function (t) {
      var b = el("span", "badge pick", t);
      b.setAttribute("title", "Picked by " + t);
      b.setAttribute("aria-label", "Picked by " + t);
      badges.appendChild(b);
    });
    li.appendChild(badges);

    if (gone) {
      li.appendChild(el("p", "gone-line", "Listing gone as of " + fmtDate(p.listing_checked_date)));
    } else if (isNC(p.listing_status)) {
      var st = el("p", "gone-line");
      st.appendChild(document.createTextNode("Listing status: "));
      st.appendChild(valueNode(p.listing_status));
      li.appendChild(st);
    }

    li.appendChild(el("p", "addr", p.address));
    if (!isMissing(p.public_note)) li.appendChild(el("p", "note", p.public_note));

    var dl = el("dl", "facts");
    fact(dl, "Layout", joinNodes([
      { node: unitNode(p.beds, " bed"), value: p.beds },
      { node: unitNode(p.baths, " bath"), value: p.baths, sep: " / " },
      { node: unitNode(p.sqft, " sq ft"), value: p.sqft }
    ]));
    fact(dl, sale ? "Monthly" : "Rent", rentNode(p), sale ? el("span", "est", EST_NOTE) : null);
    fact(dl, "All-in each", valueNode(p.all_in_per_person, money), sale ? el("span", "est", EST_NOTE) : null);
    fact(dl, "Lease", valueNode(p.lease_terms_offered));
    fact(dl, "Shortest", joinNodes([
      { value: p.shortest_lease_months, after: isNum(p.shortest_lease_months) ? " months" : "" },
      { label: "short-lease premium: ", value: p.short_lease_premium }
    ]));
    fact(dl, "Parking", joinNodes([
      { label: "1 car: ", value: p.parking_cost_one, fmt: money },
      { label: "2 cars: ", value: p.parking_cost_two, fmt: money }
    ]), p.parking_type);
    fact(dl, "Laundry", valueNode(p.laundry));
    fact(dl, "Cats", valueNode(p.cat_allowed), p.pet_fees);
    fact(dl, "Streetcar", joinNodes([
      { value: p.walk_minutes, after: isNum(p.walk_minutes) ? " min walk" : "" },
      { label: "", value: p.nearest_stop, sep: " to " }
    ]), p.walk_method);
    fact(dl, "Office", valueNode(p.office_note));
    li.appendChild(dl);

    var miss = el("p", "missing");
    miss.appendChild(el("strong", null, "Missing: "));
    miss.appendChild(valueNode(p.missing_must_haves));
    li.appendChild(miss);

    var foot = el("div", "card-foot");
    foot.appendChild(el("span", null, "Checked " + fmtDate(p.verified_date || p.rent_checked_date)));
    var href = safeUrl(p.listing_url);
    if (href) {
      var linkText = gone ? "Open last known listing" : "Open listing";
      var a = el("a", null, linkText);
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", linkText + " for " + p.name + " (new tab)");
      foot.appendChild(a);
    } else {
      foot.appendChild(valueNode(p.listing_url));
    }
    li.appendChild(foot);

    // Tapping anywhere on the card (not a control or link) flies the map to the pin.
    li.addEventListener("click", function (e) {
      if (e.target.closest("a, button, input, select, summary")) return;
      openCard(p.id, false);
      flyTo(p);
    });
    return li;
  }

  function cssId(id) { return window.CSS && CSS.escape ? CSS.escape(id) : id; }

  function openCard(id, fromPin) {
    state.activeId = id;
    drawPins();
    document.querySelectorAll(".card.is-active").forEach(function (c) { c.classList.remove("is-active"); });
    var c = document.getElementById("card-" + id);
    if (!c) return;
    c.classList.add("is-active");
    if (fromPin) {
      c.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      var t = c.querySelector(".card-title");
      if (t) t.focus({ preventScroll: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
