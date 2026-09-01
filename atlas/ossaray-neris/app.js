"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = {
  data: null,
  features: new Map(),
  selectedId: null,
  worldState: "current",
  activeLayers: new Set(),
};

const LABEL_OFFSETS = {
  "PL-MARN": [-130, 15], "PL-SEAM-GLOW-COUNTRY": [-60, 15],
  "PL-BELLOWAY": [22, -28], "PL-BELLOWAY-UPPER-GALLERIES": [10, -42],
  "PL-RISING-GATE": [25, 36], "PL-ROPEWALK-HOUSE": [-155, 4],
  "PL-BELLOWAY-FEAST-GROUND": [24, 58], "PL-DROWNED-VENT-NURSERY": [28, -12],
  "PL-NINE-DAY-SHAFT": [30, 34], "PL-LONG-BREATH-SPIRE": [22, -22],
  "PL-ROOFLINE": [15, -15], "RT-OSSARAY-DESCENT-ROUTE": [15, 24],
  "RT-OSSARAY-LIFT-CORRIDORS": [15, 24], "PL-CANNET-VENTS": [18, 26],
  "PL-NERIS": [22, -25], "PL-NERIS-BLACK-SEA": [-110, 28],
  "PL-CANDLE-BASIN": [-92, -22], "PL-NERIS-UPPER-SHELF": [-75, -14],
  "PL-BLACK-CHOIR-CHASM": [20, 25], "PL-LOWER-BLOOM": [18, 24],
};

const VISIBLE_LABELS = new Set([
  "PL-MARN", "PL-SEAM-GLOW-COUNTRY", "PL-BELLOWAY",
  "PL-DROWNED-VENT-NURSERY", "PL-NINE-DAY-SHAFT", "PL-LONG-BREATH-SPIRE", "PL-ROOFLINE",
  "RT-OSSARAY-DESCENT-ROUTE", "RT-OSSARAY-LIFT-CORRIDORS", "PL-NERIS", "PL-NERIS-BLACK-SEA",
  "PL-CANDLE-BASIN", "PL-NERIS-UPPER-SHELF", "PL-BLACK-CHOIR-CHASM",
]);

function el(tag, attrs = {}, text = "") {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function normalize(value) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function mapPoint(point, width = 920, height = 620, ox = 40, oy = 40) {
  return [ox + point[0] * width, oy + point[1] * height];
}

function pointsAttr(points, width = 920, height = 620, ox = 40, oy = 40) {
  return points.map(point => mapPoint(point, width, height, ox, oy).map(v => v.toFixed(2)).join(",")).join(" ");
}

function centroid(points) {
  if (!points?.length) return [0.5, 0.5];
  const usable = points.length > 2 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1] ? points.slice(0, -1) : points;
  return [usable.reduce((sum, p) => sum + p[0], 0) / usable.length, usable.reduce((sum, p) => sum + p[1], 0) / usable.length];
}

function makeDefs(svg, prefix) {
  const defs = svgEl("defs");
  const rim = svgEl("pattern", {id: `${prefix}-unknown-rim`, width: 22, height: 22, patternUnits: "userSpaceOnUse", patternTransform: "rotate(34)"});
  rim.append(svgEl("rect", {width: 22, height: 22, fill: "#091719"}));
  rim.append(svgEl("path", {d: "M 0 0 L 0 22", stroke: "#274347", "stroke-width": 3, opacity: .55}));
  defs.append(rim);
  const wash = svgEl("pattern", {id: `${prefix}-character-wash`, width: 18, height: 18, patternUnits: "userSpaceOnUse", patternTransform: "rotate(22)"});
  wash.append(svgEl("path", {d: "M 0 0 L 0 18", stroke: "#d69b58", "stroke-width": 5, opacity: .17}));
  defs.append(wash);
  const gradient = svgEl("radialGradient", {id: `${prefix}-soft-glow`});
  gradient.append(svgEl("stop", {offset: 0, "stop-color": "#75c4b1", "stop-opacity": .13}));
  gradient.append(svgEl("stop", {offset: 1, "stop-color": "#75c4b1", "stop-opacity": 0}));
  defs.append(gradient);
  svg.append(defs);
}

function geometryCenter(geometry) {
  if (!geometry) return [0.5, 0.5];
  if (Number.isFinite(geometry.layout_x)) return [geometry.layout_x, geometry.layout_y];
  if (geometry.layout_points) return centroid(geometry.layout_points);
  if (geometry.paths?.length) return centroid(geometry.paths.flatMap(path => path.layout_points));
  return [0.5, 0.5];
}

function pathElement(geometry, className) {
  if (geometry.paths) {
    const group = svgEl("g");
    geometry.paths.forEach(path => group.append(svgEl("polyline", {points: pointsAttr(path.layout_points), class: className})));
    return group;
  }
  return svgEl("polyline", {points: pointsAttr(geometry.layout_points || []), class: className});
}

function addPointSymbol(group, feature, x, y) {
  group.append(svgEl("circle", {cx: x, cy: y, r: 24, class: "feature-halo"}));
  group.append(svgEl("circle", {cx: x, cy: y, r: 18, class: "state-pulse"}));
  const symbol = feature.symbol;
  if (["seam", "chasm"].includes(symbol)) {
    group.append(svgEl("path", {d: `M ${x} ${y - 13} L ${x + 13} ${y + 11} L ${x - 13} ${y + 11} Z`, class: "feature-point"}));
  } else if (["gate", "shaft", "spire"].includes(symbol)) {
    group.append(svgEl("rect", {x: x - 10, y: y - 10, width: 20, height: 20, transform: `rotate(45 ${x} ${y})`, class: "feature-point"}));
  } else {
    group.append(svgEl("circle", {cx: x, cy: y, r: 11, class: "feature-point"}));
  }
}

function renderFeature(svg, feature) {
  const geometry = feature.geometry;
  if (!geometry) return;
  const group = svgEl("g", {
    class: "feature",
    tabindex: "0",
    role: "button",
    "aria-label": `${feature.label}, ${feature.kind}`,
    "data-feature-id": feature.feature_id,
    "data-symbol": feature.symbol,
    "data-layers": feature.layers.join(" "),
    "data-state-tags": (feature.states || []).join(" "),
  });
  const center = geometryCenter(geometry);
  const [x, y] = mapPoint(center);
  group.append(svgEl("title", {}, `${feature.label}: ${feature.summary}`));
  group.append(svgEl("circle", {cx: x, cy: y, r: 60, class: "feature-hit"}));
  if (Number.isFinite(geometry.layout_x)) {
    addPointSymbol(group, feature, x, y);
  } else if (geometry.layout_points && geometry.kind.includes("ENVELOPE")) {
    group.append(svgEl("polygon", {points: pointsAttr(geometry.layout_points), class: "feature-envelope"}));
    group.append(svgEl("circle", {cx: x, cy: y, r: 24, class: "feature-halo"}));
  } else {
    group.append(pathElement(geometry, "feature-path"));
    group.append(svgEl("circle", {cx: x, cy: y, r: 24, class: "feature-halo"}));
  }
  if (VISIBLE_LABELS.has(feature.feature_id)) {
    const [dx, dy] = LABEL_OFFSETS[feature.feature_id] || [16, -16];
    group.append(svgEl("text", {x: x + dx, y: y + dy, class: `feature-label rank-${feature.rank}`}, feature.label));
  }
  group.addEventListener("click", () => selectFeature(feature.feature_id, true));
  group.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectFeature(feature.feature_id, true);
    }
  });
  svg.append(group);
}

function renderCharacterArea(svg, area, prefix) {
  const geometry = area.geometry;
  if (!geometry?.layout_points) return;
  const group = svgEl("g", {class: "character-area", "data-character-area": area.area_id});
  const polygon = svgEl("polygon", {points: pointsAttr(geometry.layout_points), fill: `url(#${prefix}-character-wash)`});
  group.append(polygon);
  const [cx, cy] = mapPoint(centroid(geometry.layout_points));
  const shortType = area.character_type.toLocaleLowerCase().replaceAll("_", " ");
  group.append(svgEl("text", {x: cx, y: cy, "text-anchor": "middle"}, shortType));
  group.addEventListener("click", () => showCharacterArea(area));
  svg.append(group);
}

function renderChart(frameId, svgId) {
  const svg = document.getElementById(svgId);
  const prefix = svgId.replace("-map", "");
  while (svg.lastChild && !["title", "desc"].includes(svg.lastChild.tagName)) svg.lastChild.remove();
  makeDefs(svg, prefix);
  svg.append(svgEl("rect", {x: 12, y: 12, width: 976, height: 676, rx: 42, fill: `url(#${prefix}-unknown-rim)`, class: "map-rim"}));
  svg.append(svgEl("ellipse", {cx: 500, cy: 350, rx: 425, ry: 285, fill: `url(#${prefix}-soft-glow)`}));
  const ribs = frameId === "FR-OSSARAY"
    ? ["M70 170 Q310 70 540 155 T940 125", "M80 560 Q290 440 520 540 T925 500"]
    : ["M75 150 Q350 250 560 120 T930 175", "M80 560 Q300 470 525 575 T930 505"];
  ribs.forEach(d => svg.append(svgEl("path", {d, class: "nonsemantic-rib", "aria-hidden": "true"})));
  state.data.character_areas.filter(area => area.frame_id === frameId).forEach(area => renderCharacterArea(svg, area, prefix));
  state.data.features.filter(feature => feature.frame_id === frameId && feature.geometry).forEach(feature => renderFeature(svg, feature));
}

function samplePolyline(points, t) {
  const scaled = Math.max(0, Math.min(.999999, t)) * (points.length - 1);
  const i = Math.floor(scaled), f = scaled - i;
  return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f];
}

function renderThreading() {
  const svg = document.getElementById("threading-map");
  const route = state.data.route_space;
  const points = route.geometry.layout_points.map(([x, y]) => [80 + x * 1040, 40 + y * 170]);
  const attr = points.map(point => point.join(",")).join(" ");
  svg.append(svgEl("polyline", {points: attr, class: "threading-path-under"}));
  svg.append(svgEl("polyline", {points: attr, class: "threading-path"}));
  route.stops.forEach(stop => {
    const point = samplePolyline(points.map(([x, y]) => [(x - 80) / 1040, (y - 40) / 170]), stop.order);
    const x = 80 + point[0] * 1040, y = 40 + point[1] * 170;
    const feature = state.features.get(stop.feature_id);
    const group = svgEl("g", {class: "threading-stop", tabindex: 0, role: "button", "aria-label": `${feature?.label || stop.feature_id}, ${stop.role}`, "data-feature-id": stop.feature_id});
    group.append(svgEl("circle", {cx: x, cy: y, r: stop.role === "endpoint" ? 13 : 9}));
    group.append(svgEl("text", {x, y: y + (stop.order > .8 ? -24 : 31), "text-anchor": "middle"}, feature?.label || stop.feature_id));
    group.addEventListener("click", () => selectFeature(stop.feature_id, true));
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectFeature(stop.feature_id, true); }
    });
    svg.append(group);
  });
  document.getElementById("route-duration").textContent = route.duration;
  document.getElementById("route-state").textContent = route.current_state;
}

function renderSections() {
  const container = document.getElementById("vertical-sections");
  state.data.vertical_sections.forEach(section => {
    const card = el("section", {class: "depth-diagram"});
    card.append(el("h3", {}, section.title));
    card.append(el("p", {}, section.mode));
    const track = el("div", {class: "depth-track"});
    section.rows.forEach(row => {
      const line = el("div", {class: "depth-row", style: `top:${Math.max(.03, Math.min(.97, row.position)) * 100}%`});
      const button = el("button", {type: "button", "aria-label": `Inspect ${row.label}`});
      if (state.features.has(row.feature_id)) button.addEventListener("click", () => selectFeature(row.feature_id, true));
      else button.disabled = true;
      const copy = el("div"); copy.append(el("strong", {}, row.label)); copy.append(el("span", {}, row.value));
      line.append(button, copy); track.append(line);
    });
    card.append(track); container.append(card);
  });
}

function renderSurfaceCards() {
  const container = document.getElementById("surface-cards");
  state.data.surface_interchanges.forEach(item => {
    const card = el(item.feature_id ? "button" : "div", {class: "surface-card", ...(item.feature_id ? {type: "button"} : {})});
    card.append(el("strong", {}, item.label)); card.append(el("span", {}, item.status));
    if (item.feature_id) card.addEventListener("click", () => selectFeature(item.feature_id, true));
    container.append(card);
  });
}

function renderLayers() {
  const container = document.getElementById("layer-buttons");
  state.data.layer_definitions.forEach(layer => {
    if (layer.default) state.activeLayers.add(layer.layer_id);
    const label = el("label");
    const input = el("input", {type: "checkbox", value: layer.layer_id});
    input.checked = layer.default;
    input.addEventListener("change", () => {
      if (input.checked) state.activeLayers.add(layer.layer_id); else state.activeLayers.delete(layer.layer_id);
      updateLayerVisibility();
    });
    label.append(input, document.createTextNode(layer.label)); container.append(label);
  });
  updateLayerVisibility();
}

function updateLayerVisibility() {
  const character = state.activeLayers.has("character");
  document.body.dataset.characterLayer = String(character);
  document.querySelectorAll(".feature").forEach(node => {
    const layers = (node.dataset.layers || "").split(" ").filter(Boolean);
    node.classList.toggle("is-dimmed", !layers.some(layer => state.activeLayers.has(layer)));
  });
  const visible = state.activeLayers.size;
  document.getElementById("layer-count").textContent = `${visible}/${state.data.layer_definitions.length}`;
}

function renderStates() {
  const container = document.getElementById("state-buttons");
  state.data.states.forEach(worldState => {
    const button = el("button", {type: "button", "data-state-id": worldState.state_id, "aria-pressed": String(worldState.state_id === state.worldState)}, worldState.label);
    button.addEventListener("click", () => setWorldState(worldState.state_id));
    container.append(button);
  });
  setWorldState("current", false);
}

function setWorldState(id, announce = true) {
  state.worldState = id; document.body.dataset.state = id;
  document.querySelectorAll("[data-state-id]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.stateId === id)));
  const record = state.data.states.find(item => item.state_id === id);
  document.getElementById("state-description").textContent = record.description;
  if (announce) {
    announceStatus(`${record.label} state selected. ${record.description}`);
    showStateInspector(record);
  }
}

function announceStatus(message) {
  const node = document.getElementById("live-status"); node.textContent = ""; requestAnimationFrame(() => { node.textContent = message; });
}

function frameView(frameId) {
  return ({"FR-OSSARAY": "ossaray", "FR-NERIS": "neris", "FR-THREADING": "threading", "FR-VERTICAL": "section"})[frameId] || "ossaray";
}

function switchMobileView(view, scroll = false) {
  document.body.dataset.selectedView = view;
  document.querySelectorAll("[data-view-target]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.viewTarget === view)));
  if (scroll && matchMedia("(max-width: 760px)").matches) document.getElementById("atlas-plate").scrollIntoView({block: "start"});
}

function updateSelectedMarks() {
  document.querySelectorAll("[data-feature-id]").forEach(node => node.classList.toggle("is-selected", node.dataset.featureId === state.selectedId));
}

function featureInspector(feature) {
  const root = document.createDocumentFragment();
  root.append(el("p", {class: "lead"}, feature.summary));
  const dl = el("dl");
  dl.append(el("dt", {}, "Atlas role"), el("dd", {}, `${feature.kind} · ${feature.layers.map(id => state.data.layer_definitions.find(layer => layer.layer_id === id)?.label || id).join(" · ")}`));
  dl.append(el("dt", {}, "Portrayal status"), el("dd", {}, feature.geometry ? "Placed in Atlas realization 1; display-only and nonmetric." : "Indexed here without fixed plan geometry."));
  root.append(dl);
  if (feature.facts.length) {
    root.append(el("h3", {}, "What this plate knows"));
    const facts = el("dl");
    feature.facts.forEach(fact => facts.append(el("dt", {}, fact.label), el("dd", {}, `${fact.text} · ${fact.measurement_domain}`)));
    root.append(facts);
  }
  root.append(el("h3", {}, "What remains open"));
  const unknown = el("ul"); feature.uncertainty.forEach(value => unknown.append(el("li", {}, value))); root.append(unknown);
  if (feature.states?.length) root.append(el("p", {class: "quiet"}, `State relevance: ${feature.states.join(" and ")}. The identity remains present outside those events.`));
  else root.append(el("p", {class: "quiet"}, "The drawing is a stable atlas realization. Its relative position and incomplete shape are not new world facts."));
  return root;
}

function selectFeature(featureId, navigate = false) {
  const feature = state.features.get(featureId);
  if (!feature) return;
  state.selectedId = featureId; updateSelectedMarks();
  document.getElementById("inspector-kicker").textContent = feature.kind;
  document.getElementById("inspector-title").textContent = feature.label;
  const content = document.getElementById("inspector-content"); content.replaceChildren(featureInspector(feature));
  document.getElementById("clear-selection").hidden = false;
  switchMobileView(frameView(feature.frame_id), navigate);
  announceStatus(`${feature.label} selected. ${feature.summary}`);
  const url = new URL(location.href); url.searchParams.set("feature", featureId); history.replaceState(null, "", url);
}

function showAnswer(question, answer) {
  state.selectedId = null; updateSelectedMarks();
  document.getElementById("inspector-kicker").textContent = "Atlas answer";
  document.getElementById("inspector-title").textContent = question;
  const content = document.getElementById("inspector-content"); content.replaceChildren();
  content.append(el("p", {class: "lead"}, answer.answer));
  if (answer.feature_ids?.length) {
    const actions = el("div", {class: "inspector-actions"});
    answer.feature_ids.filter(id => state.features.has(id)).forEach(id => {
      const feature = state.features.get(id);
      const button = el("button", {type: "button"}, `Show ${feature.label}`);
      button.addEventListener("click", () => selectFeature(id, true)); actions.append(button);
    });
    content.append(actions);
  }
  content.append(el("p", {class: "quiet"}, "Answers use the plate's governed fact and measurement ledger. They never measure the drawing."));
  document.getElementById("clear-selection").hidden = false;
  announceStatus(`Answer: ${answer.answer}`);
}

function showOutOfScope(question) {
  showAnswer(question, {answer: state.data.out_of_scope_answer, feature_ids: []});
  const link = el("a", {href: "../../world-lens/"}, "Open World Lens");
  document.getElementById("inspector-content").append(link);
}

function showSearchResults(query, results) {
  document.getElementById("inspector-kicker").textContent = "Atlas matches";
  document.getElementById("inspector-title").textContent = `${results.length} matches for “${query}”`;
  const content = document.getElementById("inspector-content"); content.replaceChildren();
  const actions = el("div", {class: "inspector-actions"});
  results.forEach(feature => {
    const button = el("button", {type: "button"}, `${feature.label} · ${feature.kind}`);
    button.addEventListener("click", () => selectFeature(feature.feature_id, true)); actions.append(button);
  });
  content.append(actions); document.getElementById("clear-selection").hidden = false;
  announceStatus(`${results.length} atlas matches found.`);
}

function answerScore(query, record) {
  const q = normalize(query); const qTokens = new Set(q.split(" "));
  return Math.max(...record.patterns.map(pattern => {
    const normalized = normalize(pattern);
    if (q.includes(normalized) || normalized.includes(q)) return 100 + normalized.length;
    return normalized.split(" ").filter(token => qTokens.has(token)).length;
  }));
}

function runQuery(raw) {
  const query = raw.trim(); if (!query) return;
  const rankedAnswers = state.data.answers.map(answer => [answerScore(query, answer), answer]).sort((a, b) => b[0] - a[0]);
  if (rankedAnswers[0][0] >= 3) { showAnswer(query, rankedAnswers[0][1]); return; }
  const q = normalize(query);
  const stopwords = new Set(["a", "all", "an", "and", "are", "do", "does", "from", "how", "in", "is", "live", "lives", "of", "the", "to", "what", "where"]);
  const meaningfulTokens = q.split(" ").filter(token => token.length >= 3 && !stopwords.has(token));
  const results = state.data.features.map(feature => {
    const haystack = normalize([feature.label, feature.kind, feature.summary, feature.layers.join(" ")].join(" "));
    return [meaningfulTokens.filter(token => haystack.includes(token)).length, feature];
  }).filter(([score]) => score >= (meaningfulTokens.length > 1 ? 2 : 1)).sort((a, b) => b[0] - a[0]).map(([, feature]) => feature).slice(0, 12);
  if (results.length === 1) selectFeature(results[0].feature_id, true);
  else if (results.length > 1) showSearchResults(query, results);
  else showOutOfScope(query);
}

function renderSearch() {
  const form = document.getElementById("search-form"), input = document.getElementById("atlas-search"), suggestions = document.getElementById("search-suggestions");
  form.addEventListener("submit", event => { event.preventDefault(); suggestions.replaceChildren(); runQuery(input.value); });
  input.addEventListener("input", () => {
    suggestions.replaceChildren(); const query = normalize(input.value); if (query.length < 2) return;
    state.data.features.filter(feature => normalize(`${feature.label} ${feature.kind}`).includes(query)).slice(0, 6).forEach(feature => {
      const button = el("button", {type: "button", role: "option"}, `${feature.label} · ${feature.kind}`);
      button.addEventListener("click", () => { input.value = feature.label; suggestions.replaceChildren(); selectFeature(feature.feature_id, true); });
      suggestions.append(button);
    });
  });
  const prompts = ["What connects Ossaray and Neris?", "How far is Candle Basin from Neris?", "What lies below Belloway?", "What changes during the Rising?"];
  const promptRoot = document.getElementById("question-prompts");
  prompts.forEach(prompt => { const button = el("button", {type: "button"}, prompt); button.addEventListener("click", () => { input.value = prompt; runQuery(prompt); }); promptRoot.append(button); });
}

function renderIndex() {
  const root = document.getElementById("index-list"), input = document.getElementById("index-filter");
  function draw(query = "") {
    root.replaceChildren(); const q = normalize(query);
    state.data.features.filter(feature => !q || normalize(`${feature.label} ${feature.kind} ${feature.layers.join(" ")} ${feature.summary}`).includes(q)).forEach(feature => {
      const button = el("button", {type: "button", class: "index-item", "data-index-feature": feature.feature_id});
      button.append(el("strong", {}, feature.label), el("span", {}, feature.kind), el("p", {}, feature.summary));
      button.addEventListener("click", () => selectFeature(feature.feature_id, true)); root.append(button);
    });
  }
  draw(); input.addEventListener("input", () => draw(input.value));
}

function showCharacterArea(area) {
  document.getElementById("inspector-kicker").textContent = "Optional character interpretation";
  document.getElementById("inspector-title").textContent = area.character_type.toLocaleLowerCase().replaceAll("_", " ");
  const content = document.getElementById("inspector-content"); content.replaceChildren(el("p", {class: "lead"}, area.place_promise), el("p", {}, `Transition: ${area.transition_mode.toLocaleLowerCase()}.`), el("p", {class: "quiet"}, "This wash organizes supported character for reading. It is not a named country, physical boundary or queryable world geometry."));
}

function showStateInspector(record) {
  document.getElementById("inspector-kicker").textContent = "Temporal reading";
  document.getElementById("inspector-title").textContent = record.label;
  const content = document.getElementById("inspector-content"); content.replaceChildren(el("p", {class: "lead"}, record.description));
  const relevant = state.data.features.filter(feature => feature.states?.includes(record.state_id));
  if (relevant.length) {
    const actions = el("div", {class: "inspector-actions"}); relevant.forEach(feature => { const button = el("button", {type: "button"}, feature.label); button.addEventListener("click", () => selectFeature(feature.feature_id, true)); actions.append(button); }); content.append(actions);
  }
  content.append(el("p", {class: "quiet"}, "State emphasis never moves static geography or turns a recurring process into a permanent region."));
}

function clearInspector() {
  state.selectedId = null; updateSelectedMarks();
  document.getElementById("inspector-kicker").textContent = "How to begin";
  document.getElementById("inspector-title").textContent = "Choose a mark or ask a question";
  const content = document.getElementById("inspector-content"); content.replaceChildren(el("p", {}, "Select any named mark for a concise account of what is known and what the drawing leaves open."), el("p", {class: "quiet"}, "This reader intentionally omits source paths, evidence IDs and extraction machinery."));
  document.getElementById("clear-selection").hidden = true;
  const url = new URL(location.href); url.searchParams.delete("feature"); history.replaceState(null, "", url);
}

function applyFrameCopy() {
  const byId = new Map(state.data.frames.map(frame => [frame.frame_id, frame]));
  const o = byId.get("FR-OSSARAY"), n = byId.get("FR-NERIS"), t = byId.get("FR-THREADING"), v = byId.get("FR-VERTICAL");
  document.getElementById("ossaray-stamp").textContent = o.stamp; document.getElementById("ossaray-note").textContent = `${o.description} ${o.unknown_policy}`;
  document.getElementById("neris-stamp").textContent = n.stamp; document.getElementById("neris-note").textContent = `${n.description} ${n.unknown_policy}`;
  document.getElementById("threading-stamp").textContent = t.stamp; document.getElementById("section-stamp").textContent = v.stamp;
}

async function boot() {
  try {
    const response = await fetch("./data/atlas.json", {cache: "no-store"});
    if (!response.ok) throw new Error(`atlas data returned ${response.status}`);
    state.data = await response.json(); state.features = new Map(state.data.features.map(feature => [feature.feature_id, feature]));
    document.getElementById("title").textContent = state.data.title; document.getElementById("subtitle").textContent = state.data.subtitle;
    document.getElementById("truth-line").textContent = state.data.truth_line; document.getElementById("scope-note").textContent = state.data.scope_note;
    applyFrameCopy(); renderChart("FR-OSSARAY", "ossaray-map"); renderChart("FR-NERIS", "neris-map"); renderThreading(); renderSections(); renderSurfaceCards(); renderLayers(); renderStates(); renderSearch(); renderIndex();
    document.querySelectorAll("[data-view-target]").forEach(button => button.addEventListener("click", () => switchMobileView(button.dataset.viewTarget)));
    document.getElementById("clear-selection").addEventListener("click", clearInspector);
    document.body.dataset.featureCount = String(state.data.features.length);
    document.body.dataset.characterAreaCount = String(state.data.character_areas.length);
    document.body.dataset.decisionId = state.data.realization.decision_id;
    document.body.dataset.coordinateSemantics = state.data.realization.coordinate_semantics;
    document.body.dataset.worldQueryGeometry = String(state.data.realization.world_query_geometry);
    document.body.dataset.ready = "true";
    const params = new URL(location.href).searchParams;
    const requestedState = params.get("state");
    if (state.data.states.some(item => item.state_id === requestedState)) setWorldState(requestedState, false);
    if (params.get("layer") === "character") {
      const input = document.querySelector('#layer-buttons input[value="character"]');
      if (input) { input.checked = true; state.activeLayers.add("character"); updateLayerVisibility(); }
    }
    const requestedView = params.get("view");
    if (["ossaray", "threading", "neris", "section"].includes(requestedView)) switchMobileView(requestedView);
    const feature = params.get("feature");
    if (feature && state.features.has(feature)) selectFeature(feature, false);
    else if (params.get("q")) { document.getElementById("atlas-search").value = params.get("q"); runQuery(params.get("q")); }
  } catch (error) {
    document.body.dataset.ready = "error";
    document.getElementById("inspector-title").textContent = "The atlas could not open";
    document.getElementById("inspector-content").textContent = error.message;
    console.error(error);
  }
}

boot();
