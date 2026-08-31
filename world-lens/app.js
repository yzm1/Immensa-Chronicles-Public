import {
  createQueryContext,
  findMatches,
  planSemanticQuery,
} from "./semantic-query.js";

const DATA = {
  graph: "./data/graph.json",
  query: "./data/query-index.json",
  capabilities: "./data/capabilities.json",
  measurements: "./data/measurement-index.json",
  manifest: "./data/explorer-manifest.json",
  representation: "./data/representation-corpus.json",
  fixtures: "./data/plate-fixtures.json",
};

const NS = "http://www.w3.org/2000/svg";
const RELATION_LABELS = {
  CONTAINMENT: "contained in / contains",
  ROUTE: "route relation",
  ROUTE_MEMBERSHIP: "route membership",
  DIRECTION: "relative direction",
  VERTICAL: "vertical relation",
  DISTANCE: "stated distance",
  TRAVEL_TIME: "observed travel time",
  ACCESS_COND: "access condition",
  FLOW: "flow",
  ADJACENCY: "adjacent",
  VISIBILITY: "visible from / to",
  SEVERED: "severed",
  SHARED_REGION: "shared reviewed region",
  EXTENT: "extent",
  UNANCHORED: "unanchored reference",
  ANON_REGION: "anonymous region context",
  ASYMMETRY: "asymmetric relation",
  PACE: "stated pace",
};
const HOME_REVIEWED_EXAMPLES = {
  physical_places: ["PL-HARLOWE", "PL-NERIS", "PL-RAVEL-SEA"],
  movement_infrastructure: ["RT-ONCEWAY-CLASS", "RT-UNDERWAY-CLASS", "RT-THREADING"],
  social_political: ["PL-BELLOWAY", "PL-NERIS", "PL-OSSARAY"],
  institutions_organizations: ["PL-NERIS"],
  culture_language: ["RT-THREADING"],
  agents_lives: ["PL-HARLOWE", "PL-ILBER"],
};

function element(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "hidden") node.hidden = Boolean(value);
    else if (key.startsWith("aria-")) node.setAttribute(key, value);
    else node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svgElement(tag, attrs = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) { node.replaceChildren(); }
function humanize(value) {
  if (RELATION_LABELS[value]) return RELATION_LABELS[value];
  return String(value ?? "unknown").toLocaleLowerCase().replaceAll("_", " ");
}
function digest(value) { return String(value ?? "unknown").replace(/^sha256:/, "").slice(0, 12); }
function normalize(value) {
  return String(value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function setLive(message) { document.getElementById("live-status").textContent = message; }
async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function markShape(parent, record, x, y, size = 19, open = false) {
  const mark = record.interface_mark ?? {};
  const family = mark.mark_family ?? "circle";
  const group = svgElement("g", {
    transform: `translate(${x} ${y}) rotate(${(mark.rotation_quadrants ?? 0) * 90})`,
    "aria-hidden": "true",
  });
  const common = {
    fill: open ? "none" : "#fbfaf5",
    stroke: "currentColor",
    "stroke-width": open ? 1.3 : 1.7,
  };
  if (family === "block") group.append(svgElement("rect", { x: -size, y: -size, width: size * 2, height: size * 2, ...common }));
  else if (family === "chevron") group.append(svgElement("path", { d: `M-${size},-${size} L${size},0 L-${size},${size} Z`, ...common }));
  else if (family === "diamond") group.append(svgElement("path", { d: `M0,-${size} L${size},0 L0,${size} L-${size},0 Z`, ...common }));
  else if (family === "bracket") group.append(svgElement("path", { d: `M${size},-${size} H-${size} V${size} H${size}`, ...common }));
  else if (family === "branch") group.append(svgElement("path", { d: `M0,${size} V-${size} M0,-2 L-${size},-${size} M0,5 L${size},-${size * .55}`, ...common }));
  else if (family === "paired") {
    group.append(svgElement("circle", { cx: -size * .45, cy: 0, r: size * .55, ...common }));
    group.append(svgElement("circle", { cx: size * .45, cy: 0, r: size * .55, ...common }));
  } else if (family === "ring") group.append(svgElement("circle", { cx: 0, cy: 0, r: size, ...common }));
  else if (family === "arc") group.append(svgElement("path", { d: `M-${size},${size * .4} A${size},${size} 0 0 1 ${size},${size * .4} M0,-${size} V${size}`, ...common }));
  else group.append(svgElement("circle", { cx: 0, cy: 0, r: size, ...common }));
  const strokes = mark.stroke_count ?? 2;
  for (let index = 0; index < strokes; index += 1) {
    const offset = -size * .55 + index * (size * 1.1 / Math.max(1, strokes - 1));
    group.append(svgElement("line", {
      x1: -size * .42, y1: offset, x2: size * .42, y2: -offset,
      stroke: "currentColor", "stroke-width": 1, opacity: .72,
    }));
  }
  parent.append(group);
  return group;
}

function layerMotif(parent, layer, x, y, scale = 1) {
  const group = svgElement("g", {
    transform: `translate(${x} ${y}) scale(${scale})`,
    stroke: layer.accent,
    fill: "none",
    "stroke-width": 1.8,
    "aria-hidden": "true",
  });
  const id = layer.layer_id;
  if (id === "physical_places") group.append(svgElement("path", { d: "M-17,-4 H17 M-17,4 H17 M-10,-8 V8" }));
  else if (id === "movement_infrastructure") group.append(svgElement("path", { d: "M-17,-5 H12 L17,0 L12,5 H-17 M-12,0 H8" }));
  else if (id === "living_ecology") group.append(svgElement("path", { d: "M0,10 V-10 M0,-2 L-13,-10 M0,3 L13,-7 M0,7 L-10,1" }));
  else if (id === "resources_economy_industry") group.append(svgElement("path", { d: "M-17,-6 H-3 V6 H-17 Z M3,-6 H17 V6 H3 Z M-3,0 H3" }));
  else if (id === "social_political") group.append(svgElement("path", { d: "M12,-10 H-14 V10 H12 M17,-6 H-8 V6 H17" }));
  else if (id === "ownership_control") group.append(svgElement("path", { d: "M-10,-10 V10 M-4,-10 V10 M6,-7 H17 M6,7 H17" }));
  else if (id === "institutions_organizations") group.append(svgElement("path", { d: "M-15,-10 H15 V10 H-15 Z M-6,-4 H6 V4 H-6 Z" }));
  else if (id === "culture_language") group.append(svgElement("path", { d: "M-18,-4 Q-10,-11 -2,-4 T14,-4 M-14,5 Q-6,-2 2,5 T18,5" }));
  else if (id === "worship_religion") group.append(svgElement("path", { d: "M0,-11 A11,11 0 1 1 -1,-11 M0,-16 V-9 M0,9 V16 M-16,0 H-9 M9,0 H16" }));
  else if (id === "communications") group.append(svgElement("path", { d: "M-18,0 H-11 L-7,-7 L0,7 L7,-7 L11,0 H18", "stroke-dasharray": "2 2" }));
  else if (id === "agents_lives") group.append(svgElement("path", { d: "M-7,-3 A6,6 0 1 1 -7,9 A6,6 0 1 1 -7,-3 M7,-9 A6,6 0 1 1 7,3" }));
  else if (id === "metaphysical") group.append(svgElement("path", { d: "M-14,4 A14,14 0 0 1 -5,-13 M5,-13 A14,14 0 0 1 14,4 M10,10 A14,14 0 0 1 -10,10" }));
  else group.append(svgElement("path", { d: "M-16,8 A18,18 0 0 1 16,8 M-12,2 V11 M-4,-3 V11 M4,-3 V11 M12,2 V11" }));
  parent.append(group);
  return group;
}

function makeSvg(label, height = 760) {
  return svgElement("svg", {
    class: "plate-figure",
    viewBox: `0 0 1200 ${height}`,
    role: "img",
    "aria-label": label,
    preserveAspectRatio: "xMidYMid meet",
  });
}

function plateShell({ plateType, kicker, title, dek, figure, index = "", synthetic = false, note = [] }) {
  const article = element("article", {
    class: "knowledge-plate",
    "data-plate-type": plateType,
    "data-synthetic": synthetic ? "true" : "false",
  });
  article.append(element("header", { class: "plate-heading" }, [
    element("div", {}, [
      element("p", { class: "plate-kicker", text: `${synthetic ? "SYNTHETIC PRESENTATION FIXTURE · " : ""}${kicker}` }),
      element("h1", { text: title }),
      dek ? element("p", { class: "plate-dek", text: dek }) : null,
    ]),
    index ? element("span", { class: "plate-index", text: index }) : null,
  ]));
  article.append(element("div", { class: "figure-scroll" }, figure));
  if (note.length) article.append(element("div", { class: "plate-note" }, note));
  return article;
}

function outlineHeading(title, dek = "") {
  const root = document.getElementById("outline-content");
  clear(root);
  root.append(element("h2", { text: title }));
  if (dek) root.append(element("p", { text: dek }));
  return root;
}

function setEpistemic(support, coverage, state) {
  clear(document.getElementById("epistemic-footer"));
  document.getElementById("epistemic-footer").append(
    element("span", { text: `● support · ${humanize(support)}` }),
    element("span", { text: `◐ coverage · ${humanize(coverage)}` }),
    element("span", { text: `✓ state · ${humanize(state)}` }),
  );
}

function stableExamples(records, layerId, limit = 3) {
  return records
    .filter((record) => record.layer_ids.includes(layerId))
    .sort((a, b) => {
      const av = a.interface_mark.variant ?? 0;
      const bv = b.interface_mark.variant ?? 0;
      return av - bv || a.record_id.localeCompare(b.record_id);
    })
    .slice(0, limit);
}

async function start() {
  const [graph, queryIndex, capabilities, measurementIndex, manifest, representation, fixtures] = await Promise.all([
    fetchJson(DATA.graph),
    fetchJson(DATA.query),
    fetchJson(DATA.capabilities),
    fetchJson(DATA.measurements),
    fetchJson(DATA.manifest),
    fetchJson(DATA.representation),
    fetchJson(DATA.fixtures),
  ]);
  const semanticDigests = [queryIndex.semantic_digest, capabilities.semantic_digest, measurementIndex.semantic_digest];
  if (!semanticDigests.every((value) => value === graph.semantic_digest)) throw new Error("Knowledge inputs do not share one semantic digest");
  if (representation.topology_semantic_digest !== graph.semantic_digest) throw new Error("Representation corpus does not match the topology build");
  if (manifest.publication_policy !== "PUBLIC_CLEAN_PRIVATE_DEBUG") throw new Error("Unexpected publication policy");

  const context = createQueryContext(graph, queryIndex, measurementIndex, capabilities);
  const reviewedByEntity = new Map(representation.reviewed_entities.map((row) => [row.entity_id, row]));
  const catalogueById = new Map(representation.catalogue_records.map((row) => [row.record_id, row]));
  const assertionById = new Map(representation.assertions.map((row) => [row.assertion_id, row]));
  const layerById = new Map(representation.layers.map((row) => [row.layer_id, row]));
  const fixtureById = new Map(fixtures.fixtures.map((row) => [row.fixture_id, row]));
  const catalogueSearch = representation.catalogue_records.map((row) => ({ ...row, search: normalize(`${row.label} ${row.entry_code}`) }));
  const stage = document.getElementById("answer-panel");
  const trail = [];

  document.getElementById("build-id").textContent =
    `active working · representation ${digest(representation.representation_digest)} · ${representation.statistics.catalogue_records.toLocaleString()} catalogue records`;

  function updateTrail(label, action) {
    if (trail.at(-1)?.label !== label) trail.push({ label, action });
    if (trail.length > 5) trail.shift();
    const nav = document.getElementById("history-trail");
    clear(nav);
    trail.forEach((item, index) => {
      if (index === trail.length - 1) nav.append(element("span", { text: item.label }));
      else {
        const button = element("button", { type: "button", text: item.label });
        button.addEventListener("click", item.action);
        nav.append(button);
      }
    });
  }

  function setUrl(values, replace = false) {
    const url = new URL(location.href);
    for (const key of ["q", "focus", "layer", "fixture", "catalogue"]) url.searchParams.delete(key);
    url.searchParams.set("build", representation.representation_digest);
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value);
    history[replace ? "replaceState" : "pushState"](null, "", url);
  }

  function pivotButton(label, action) {
    const button = element("button", { type: "button", text: label });
    button.addEventListener("click", action);
    return button;
  }

  function topologyLink(entityId) {
    return element("a", {
      href: `../world-topology/?focus=${encodeURIComponent(entityId)}&build=${encodeURIComponent(graph.semantic_digest)}`,
      text: "Inspect topology",
    });
  }

  function relationRecords(entityId) {
    const record = reviewedByEntity.get(entityId);
    return (record?.assertion_ids ?? []).map((id) => assertionById.get(id)).filter(Boolean);
  }

  function otherParticipants(assertion, entityId) {
    return assertion.participants.filter((row) => row.entity_id !== entityId);
  }

  function renderHome({ navigate = true } = {}) {
    document.body.dataset.queryKind = "home_layers";
    document.body.dataset.queryCapability = "AVAILABLE";
    const svg = makeSvg("Immensa in semantic layers; ribbon order is editorial and non-geographic", 780);
    svg.append(
      svgElement("text", { x: 42, y: 38, class: "micro muted" }, "IMMensa in layers"),
      svgElement("text", { x: 42, y: 68, class: "serif", "font-size": 26 }, "Thirteen aspects of one open record"),
      svgElement("text", { x: 42, y: 92, class: "annotation muted" }, "Equal tracks · stable examples · no width, order or position implies world magnitude"),
    );
    const combined = [...representation.reviewed_entities, ...representation.catalogue_records];
    representation.layers.forEach((layer, index) => {
      const y = 122 + index * 48;
      const group = svgElement("g", {
        class: "ribbon-hit",
        tabindex: 0,
        role: "button",
        "data-layer-ribbon": layer.layer_id,
        "aria-label": `Open ${layer.label}`,
      });
      group.append(
        svgElement("rect", { x: 42, y, width: 1116, height: 37, rx: 1, class: "ribbon-bg" }),
        svgElement("line", { x1: 304, y1: y + 29, x2: 1138, y2: y + 29, stroke: layer.accent, "stroke-width": 1.4 }),
        svgElement("text", { x: 58, y: y + 23, class: "layer-label" }, layer.label),
      );
      layerMotif(group, layer, 280, y + 19, .58);
      const preferred = (HOME_REVIEWED_EXAMPLES[layer.layer_id] ?? [])
        .map((entityId) => reviewedByEntity.get(entityId))
        .filter(Boolean);
      const samples = [
        ...preferred,
        ...stableExamples(combined, layer.layer_id, 6)
          .filter((record) => !preferred.some((item) => item.record_id === record.record_id)),
      ].slice(0, 3);
      samples.forEach((record, sampleIndex) => {
        const x = 390 + sampleIndex * 248;
        markShape(group, record, x, y + 18, 9, record.record_state !== "REVIEWED_IDENTITY");
        group.append(svgElement("text", { x: x + 18, y: y + 22, class: "annotation" }, record.label.slice(0, 31)));
      });
      if (!samples.length) group.append(svgElement("text", { x: 310, y: y + 22, class: "annotation muted" }, "Representable · no public example in this projection"));
      const open = () => renderLayer(layer.layer_id);
      group.addEventListener("click", open);
      group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") open(); });
      svg.append(group);
    });
    clear(stage);
    stage.append(plateShell({
      plateType: "HOME_LAYER_COMPOSITION",
      kicker: "Opening plate",
      title: "A world seen in layers",
      dek: "Focus one ribbon, find a named thing, or ask a bounded question. The figure changes shape to match what the record can actually support.",
      figure: svg,
      index: "PLATE 00",
      note: [
        element("span", {}, [element("strong", { text: "How to read it: " }), "ribbons are semantic aspects, not physical strata."]),
        element("span", { text: "Examples are deterministic orientation marks, never rankings." }),
      ],
    }));
    const outline = outlineHeading("Immensa in layers", "The semantic order is editorial and non-hierarchical.");
    const list = element("ol");
    representation.layers.forEach((layer) => list.append(element("li", { text: `${layer.label} — ${layer.motif}` })));
    outline.append(list);
    setEpistemic("governed and source-scoped display records", "open world", "available");
    updateTrail("Immensa in layers", () => renderHome());
    if (navigate) setUrl({}, true);
    setLive("Immensa in Layers plate opened.");
  }

  function addEntityHit(parent, record, x, y, label, sublabel = "") {
    const group = svgElement("g", {
      class: "entity-hit",
      tabindex: 0,
      role: "button",
      "aria-label": `Open ${record.label}`,
    });
    markShape(group, record, x, y, 11, record.record_state !== "REVIEWED_IDENTITY");
    group.append(svgElement("text", { x: x + 20, y: y + 4, class: "label" }, label.slice(0, 25)));
    if (sublabel) group.append(svgElement("text", { x: x + 20, y: y + 18, class: "micro muted" }, sublabel.slice(0, 31)));
    const open = () => openRecord(record);
    group.addEventListener("click", open);
    group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") open(); });
    parent.append(group);
  }

  function renderEntity(entityId, plan = null, { navigate = true } = {}) {
    const record = reviewedByEntity.get(entityId);
    if (!record) return;
    const relations = relationRecords(entityId);
    const byLayer = new Map(representation.layers.map((layer) => [layer.layer_id, []]));
    relations.forEach((row) => byLayer.get(row.layer_id)?.push(row));
    const svg = makeSvg(`${record.label} entity layer score`, 880);
    markShape(svg, record, 78, 57, 27);
    svg.append(
      svgElement("text", { x: 126, y: 53, class: "micro muted" }, "PRESENTATION MARK · NOT AN IN-WORLD SYMBOL"),
      svgElement("text", { x: 126, y: 72, class: "annotation" }, `${humanize(record.display_kind)} · ${humanize(record.identity_status)}`),
    );
    representation.layers.forEach((layer, index) => {
      const y = 105 + index * 56;
      const rows = byLayer.get(layer.layer_id) ?? [];
      const participates = record.layer_ids.includes(layer.layer_id) || rows.length;
      svg.append(
        svgElement("text", { x: 42, y: y + 21, class: `layer-label ${participates ? "" : "muted"}` }, layer.label),
        svgElement("rect", {
          x: 275, y, width: 883, height: participates ? 46 : 23, class: "ribbon-bg",
          stroke: participates ? layer.accent : "rgba(23,39,51,.12)",
        }),
        svgElement("line", {
          x1: 275, y1: y + (participates ? 41 : 18), x2: 1158, y2: y + (participates ? 41 : 18),
          stroke: participates ? layer.accent : "rgba(23,39,51,.16)", "stroke-width": 1.2,
        }),
      );
      layerMotif(svg, layer, 250, y + 18, .52);
      if (!participates) return;
      if (!rows.length) {
        svg.append(svgElement("text", { x: 298, y: y + 27, class: "annotation muted" }, "Known classification · no governed relation displayed in this layer"));
        return;
      }
      rows.slice(0, 4).forEach((assertion, relationIndex) => {
        const others = otherParticipants(assertion, entityId);
        const other = reviewedByEntity.get(others[0]?.entity_id);
        const x = 320 + relationIndex * 200;
        if (other) addEntityHit(svg, other, x, y + 17, other.label, humanize(assertion.relation_type));
        else svg.append(svgElement("text", { x, y: y + 23, class: "annotation" }, humanize(assertion.relation_type)));
      });
      if (rows.length > 4) svg.append(svgElement("text", { x: 1116, y: y + 23, class: "annotation muted", "text-anchor": "end" }, `+${rows.length - 4}`));
    });
    clear(stage);
    stage.append(plateShell({
      plateType: "ENTITY_LAYER_SCORE",
      kicker: plan ? `Answer · ${humanize(plan.result_shape)}` : "Entity portrait · layer score",
      title: record.label,
      dek: plan?.summary ?? `${relations.length} governed assertions participate in this open-world portrait. Empty tracks mean no governed relation in this build, not absence in Immensa.`,
      figure: svg,
      index: record.entity_id,
      note: [
        element("span", {}, [element("strong", { text: "Placement: " }), humanize(record.placement_status)]),
        element("span", {}, [element("strong", { text: "Planes: " }), record.plane_memberships.length ? record.plane_memberships.join(", ") : "not governed"]),
        element("div", { class: "plate-pivots" }, [
          topologyLink(entityId),
          pivotButton("Focus physical layer", () => renderLayer("physical_places")),
          pivotButton("Compare…", () => {
            const input = document.getElementById("command-input");
            input.value = `compare ${record.label} with `;
            input.focus();
          }),
        ]),
      ],
    }));
    const outline = outlineHeading(record.label, `${relations.length} governed assertions; known matches are open-world.`);
    const list = element("ul");
    relations.forEach((row) => {
      const otherNames = otherParticipants(row, entityId).map((p) => reviewedByEntity.get(p.entity_id)?.label ?? p.entity_id);
      list.append(element("li", { text: `${humanize(row.relation_type)} — ${otherNames.join(", ") || "no other displayed participant"}${row.conditions_as_stated ? ` — condition: ${row.conditions_as_stated}` : ""}` }));
    });
    if (!relations.length) list.append(element("li", { text: "No governed incident relation in this projection." }));
    outline.append(list);
    document.body.dataset.queryKind = plan?.query_id ?? "entity";
    document.body.dataset.queryCapability = plan?.capability_state ?? "AVAILABLE";
    setEpistemic(plan?.support_status ?? "governed identity", plan?.coverage_status ?? "open world known matches", plan?.capability_state ?? "available");
    updateTrail(record.label, () => renderEntity(entityId));
    if (navigate) setUrl({ focus: entityId });
    setLive(`${record.label} entity layer score opened.`);
  }

  function renderCatalogueRecord(record, { navigate = true } = {}) {
    const layer = layerById.get(record.layer_ids[0]);
    const svg = makeSvg(`${record.label} source-scoped catalogue record`, 440);
    markShape(svg, record, 126, 110, 44, true);
    svg.append(
      svgElement("text", { x: 205, y: 92, class: "micro muted" }, "OPEN FRAME · IDENTITY NOT MERGED"),
      svgElement("text", { x: 205, y: 125, class: "serif", "font-size": 28 }, humanize(record.category)),
      svgElement("rect", { x: 205, y: 175, width: 900, height: 74, class: "ribbon-bg", stroke: layer.accent }),
      svgElement("line", { x1: 205, y1: 237, x2: 1105, y2: 237, stroke: layer.accent, "stroke-width": 2 }),
      svgElement("text", { x: 230, y: 207, class: "layer-label" }, layer.label),
      svgElement("text", { x: 230, y: 228, class: "annotation muted" }, "Single classified source record; no cross-source identity or relationship asserted"),
      svgElement("path", { d: "M205,316 H535 M665,316 H1105", class: "unknown-rift" }),
      svgElement("text", { x: 600, y: 321, class: "micro", "text-anchor": "middle" }, "IDENTITY REVIEW RIFT"),
    );
    clear(stage);
    stage.append(plateShell({
      plateType: "SOURCE_SCOPED_CATALOGUE",
      kicker: "Corpus representation record",
      title: record.label,
      dek: "This high-confidence catalogue item is useful for discovery and future mapping, but it remains source-scoped. Similar names elsewhere have not been silently merged.",
      figure: svg,
      index: record.entry_code || record.candidate_id,
      note: [
        element("span", {}, [element("strong", { text: "Authority: " }), humanize(record.authority_state)]),
        element("span", {}, [element("strong", { text: "Location: " }), humanize(record.location_status)]),
        element("span", {}, [element("strong", { text: "Placement: " }), humanize(record.placement_status)]),
      ],
    }));
    const outline = outlineHeading(record.label, "Source-scoped catalogue representation; not a reviewed global identity.");
    outline.append(element("dl", {}, [
      element("dt", { text: "Layer" }), element("dd", { text: layer.label }),
      element("dt", { text: "Category" }), element("dd", { text: humanize(record.category) }),
      element("dt", { text: "Geometry capability" }), element("dd", { text: humanize(record.geometry_capability) }),
    ]));
    document.body.dataset.queryKind = "catalogue_record";
    document.body.dataset.queryCapability = "DEGRADED";
    setEpistemic("high-confidence source-scoped entry", "identity unresolved / open world", "discovery only");
    updateTrail(record.label, () => renderCatalogueRecord(record));
    if (navigate) setUrl({ catalogue: record.record_id });
    setLive(`${record.label} source-scoped catalogue plate opened.`);
  }

  function renderLayer(layerId, { navigate = true } = {}) {
    const layer = layerById.get(layerId);
    if (!layer) return;
    const reviewed = stableExamples(representation.reviewed_entities, layerId, 12);
    const catalogue = stableExamples(representation.catalogue_records, layerId, 18);
    const svg = makeSvg(`${layer.label} layer plate`, 780);
    representation.layers.forEach((contextLayer, index) => {
      const y = 28 + index * 8;
      svg.append(svgElement("line", {
        x1: 55, y1: y, x2: 1145, y2: y,
        stroke: contextLayer.accent,
        "stroke-width": contextLayer.layer_id === layerId ? 4 : .8,
        opacity: contextLayer.layer_id === layerId ? 1 : .45,
      }));
    });
    svg.append(
      svgElement("line", { x1: 55, y1: 158, x2: 1145, y2: 158, stroke: layer.accent, "stroke-width": 5 }),
      svgElement("text", { x: 55, y: 142, class: "micro muted" }, `${layer.motif} · selected ribbon expanded; twelve ribbons remain compressed above`),
      svgElement("text", { x: 55, y: 205, class: "serif", "font-size": 26 }, "Reviewed identities"),
    );
    layerMotif(svg, layer, 1110, 134, 1);
    reviewed.forEach((record, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      addEntityHit(svg, record, 85 + col * 275, 248 + row * 70, record.label, record.display_kind);
    });
    svg.append(
      svgElement("text", { x: 55, y: 480, class: "serif", "font-size": 26 }, "Source-scoped catalogue examples"),
      svgElement("text", { x: 55, y: 505, class: "annotation muted" }, "Open marks have not been merged across the corpus"),
    );
    catalogue.slice(0, 12).forEach((record, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      addEntityHit(svg, record, 85 + col * 275, 550 + row * 62, record.label, humanize(record.category));
    });
    clear(stage);
    stage.append(plateShell({
      plateType: "LAYER_PLATE",
      kicker: "Semantic layer focus",
      title: layer.label,
      dek: `${reviewed.length} stable reviewed examples and ${catalogue.length} stable catalogue examples are shown for orientation, never as rankings or a complete inventory.`,
      figure: svg,
      index: `LAYER ${String(layer.order).padStart(2, "0")}`,
      note: [
        element("span", {}, [element("strong", { text: "Motif: " }), humanize(layer.motif)]),
        element("span", { text: "Ribbon order is editorial, not a world hierarchy." }),
      ],
    }));
    const outline = outlineHeading(layer.label, "Examples are deterministic and non-ranked.");
    const list = element("ul");
    [...reviewed, ...catalogue].forEach((record) => list.append(element("li", { text: `${record.label} — ${record.record_state === "REVIEWED_IDENTITY" ? "reviewed identity" : "source-scoped catalogue record"}` })));
    outline.append(list);
    document.body.dataset.queryKind = "browse_layer";
    document.body.dataset.queryCapability = "AVAILABLE";
    setEpistemic("mixed reviewed and source-scoped records", "stable examples / open world", "available");
    updateTrail(layer.label, () => renderLayer(layerId));
    if (navigate) setUrl({ layer: layerId });
    setLive(`${layer.label} layer plate opened.`);
  }

  function renderComparison(leftId, rightId, plan = null, { navigate = true } = {}) {
    const left = reviewedByEntity.get(leftId);
    const right = reviewedByEntity.get(rightId);
    if (!left || !right) return;
    const leftRows = relationRecords(leftId);
    const rightRows = relationRecords(rightId);
    const svg = makeSvg(`${left.label} and ${right.label} comparison plate`, 760);
    markShape(svg, left, 310, 70, 24);
    markShape(svg, right, 890, 70, 24);
    svg.append(
      svgElement("text", { x: 310, y: 112, class: "serif", "font-size": 24, "text-anchor": "middle" }, left.label),
      svgElement("text", { x: 890, y: 112, class: "serif", "font-size": 24, "text-anchor": "middle" }, right.label),
      svgElement("line", { x1: 600, y1: 42, x2: 600, y2: 724, stroke: "rgba(23,39,51,.2)" }),
    );
    representation.layers.forEach((layer, index) => {
      const y = 154 + index * 42;
      const lc = leftRows.filter((row) => row.layer_id === layer.layer_id).length;
      const rc = rightRows.filter((row) => row.layer_id === layer.layer_id).length;
      svg.append(
        svgElement("text", { x: 600, y: y + 18, class: "micro muted", "text-anchor": "middle" }, layer.label),
        svgElement("line", { x1: 110, y1: y + 28, x2: 518, y2: y + 28, stroke: layer.accent, "stroke-width": lc ? 2 : .5 }),
        svgElement("line", { x1: 682, y1: y + 28, x2: 1090, y2: y + 28, stroke: layer.accent, "stroke-width": rc ? 2 : .5 }),
        svgElement("text", { x: 510, y: y + 20, class: lc ? "label" : "annotation muted", "text-anchor": "end" }, lc ? `${lc} governed` : "none governed"),
        svgElement("text", { x: 690, y: y + 20, class: rc ? "label" : "annotation muted" }, rc ? `${rc} governed` : "none governed"),
      );
    });
    clear(stage);
    stage.append(plateShell({
      plateType: "COMPARISON",
      kicker: "Aligned semantic small multiples",
      title: `${left.label} / ${right.label}`,
      dek: plan?.summary ?? "Counts refer to governed assertion records in the same semantic layers. They do not measure importance, size or completeness.",
      figure: svg,
      index: "COMPARISON",
      note: [element("span", { text: "Aligned by layer; open-world evidence; no geographic ordering." })],
    }));
    const outline = outlineHeading(`${left.label} and ${right.label}`, "Governed assertion counts aligned by semantic layer.");
    const table = element("table");
    table.append(element("thead", {}, element("tr", {}, [
      element("th", { text: "Layer" }), element("th", { text: left.label }), element("th", { text: right.label }),
    ])));
    const tbody = element("tbody");
    representation.layers.forEach((layer) => tbody.append(element("tr", {}, [
      element("td", { text: layer.label }),
      element("td", { text: leftRows.filter((row) => row.layer_id === layer.layer_id).length }),
      element("td", { text: rightRows.filter((row) => row.layer_id === layer.layer_id).length }),
    ])));
    table.append(tbody);
    outline.append(table);
    document.body.dataset.queryKind = plan?.query_id ?? "compare";
    document.body.dataset.queryCapability = "AVAILABLE";
    setEpistemic(plan?.support_status ?? "governed derivation", plan?.coverage_status ?? "open world", "available");
    updateTrail(`${left.label} / ${right.label}`, () => renderComparison(leftId, rightId));
    if (navigate) setUrl({ q: `compare ${left.label} with ${right.label}` });
    setLive(`${left.label} and ${right.label} comparison plate opened.`);
  }

  function renderMeasurements(plan, { navigate = true } = {}) {
    const entityId = plan.entity.nodeId;
    const record = reviewedByEntity.get(entityId);
    const svg = makeSvg(`Stated measurements involving ${record.label}`, Math.max(420, 190 + plan.measurements.length * 76));
    plan.measurements.slice(0, 10).forEach((measurement, index) => {
      const y = 85 + index * 76;
      svg.append(
        svgElement("text", { x: 60, y: y - 10, class: "micro muted" }, humanize(measurement.quantity_kind)),
        svgElement("line", { x1: 60, y1: y + 15, x2: 1080, y2: y + 15, stroke: "#375b61", "stroke-width": 1.5 }),
        svgElement("line", { x1: 60, y1: y + 6, x2: 60, y2: y + 24, stroke: "#375b61" }),
        svgElement("line", { x1: 1080, y1: y + 6, x2: 1080, y2: y + 24, stroke: "#375b61" }),
        svgElement("text", { x: 570, y: y + 8, class: "serif", "font-size": 18, "text-anchor": "middle" }, measurement.value_verbatim),
        svgElement("text", { x: 1140, y: y + 18, class: "micro muted", "text-anchor": "end" }, "NOT SCALED"),
      );
    });
    if (!plan.measurements.length) {
      svg.append(
        svgElement("path", { d: "M80,190 H500 M700,190 H1120", class: "unknown-rift" }),
        svgElement("text", { x: 600, y: 198, class: "micro", "text-anchor": "middle" }, "NO GOVERNED MEASURE"),
      );
    }
    clear(stage);
    stage.append(plateShell({
      plateType: "MEASUREMENT_PLATE",
      kicker: "Measure marks · equal explanatory rails",
      title: `Measurements involving ${record.label}`,
      dek: plan.summary,
      figure: svg,
      index: "MEASURE",
      note: [element("span", {}, [element("strong", { text: "Aggregation: " }), "not certified; equal rail length encodes no quantity."])],
    }));
    const outline = outlineHeading(`Measurements involving ${record.label}`, "Values are verbatim and not aggregated.");
    const list = element("ul");
    plan.measurements.forEach((measurement) => list.append(element("li", { text: `${humanize(measurement.quantity_kind)} — ${measurement.value_verbatim}` })));
    if (!plan.measurements.length) list.append(element("li", { text: "No governed measurement in this build." }));
    outline.append(list);
    document.body.dataset.queryKind = plan.query_id;
    document.body.dataset.queryCapability = plan.capability_state;
    setEpistemic(plan.support_status, plan.coverage_status, plan.capability_state);
    updateTrail(`Measure ${record.label}`, () => renderMeasurements(plan));
    if (navigate) setUrl({ q: `measure ${record.label}` });
  }

  function renderGap(plan, raw, { navigate = true } = {}) {
    const svg = makeSvg(plan.summary, 470);
    svg.append(
      svgElement("path", { d: "M65,115 H468 L520,82 L565,156 L618,98 L678,168 L736,115 H1135", class: "unknown-rift" }),
      svgElement("text", { x: 600, y: 225, class: "serif", "font-size": 30, "text-anchor": "middle" }, plan.query_id === "migration_distance" ? "TOTAL NOT RECOVERABLE" : "ANSWER NOT GOVERNED"),
      svgElement("text", { x: 600, y: 258, class: "annotation muted", "text-anchor": "middle" }, "The rift is the result: the viewer does not bridge missing evidence."),
    );
    plan.missing_prerequisites.slice(0, 4).forEach((item, index) => {
      svg.append(
        svgElement("line", { x1: 190, y1: 320 + index * 34, x2: 220, y2: 320 + index * 34, stroke: "#a34232", "stroke-width": 2 }),
        svgElement("text", { x: 238, y: 325 + index * 34, class: "annotation" }, item),
      );
    });
    clear(stage);
    stage.append(plateShell({
      plateType: "CAPABILITY_RIFT",
      kicker: "Honest refusal · unknown remains visible",
      title: plan.summary,
      dek: plan.explanation,
      figure: svg,
      index: humanize(plan.query_id).toLocaleUpperCase(),
      note: [element("span", {}, [element("strong", { text: "Missing: " }), plan.missing_prerequisites.join(" · ")])],
    }));
    const outline = outlineHeading(plan.summary, plan.explanation);
    const list = element("ul");
    plan.missing_prerequisites.forEach((item) => list.append(element("li", { text: item })));
    outline.append(list);
    document.body.dataset.queryKind = plan.query_id;
    document.body.dataset.queryCapability = plan.capability_state;
    setEpistemic(plan.support_status, plan.coverage_status, plan.capability_state);
    updateTrail("Knowledge rift", () => renderGap(plan, raw));
    if (navigate) setUrl({ q: raw });
    setLive(`${plan.summary} ${plan.missing_prerequisites.length} prerequisites are missing.`);
  }

  function renderCatalogueResults(term, graphMatches = [], { navigate = true } = {}) {
    const needle = normalize(term);
    const catalogue = catalogueSearch.filter((row) => row.search.includes(needle)).slice(0, 36);
    const svg = makeSvg(`Representation index results for ${term}`, 230);
    svg.append(
      svgElement("path", { d: "M55,72 H1145", stroke: "#172733", "stroke-width": 1.5 }),
      svgElement("text", { x: 55, y: 115, class: "serif", "font-size": 29 }, `${graphMatches.length} reviewed · ${catalogue.length} source-scoped shown`),
      svgElement("text", { x: 55, y: 150, class: "annotation muted" }, "Reviewed identities can answer governed relation questions. Open-frame catalogue records support discovery and future mapping only."),
    );
    const article = plateShell({
      plateType: "REPRESENTATION_INDEX",
      kicker: "Corpus representation index",
      title: catalogue.length || graphMatches.length ? `Matches for “${term}”` : `No represented match for “${term}”`,
      dek: "The index separates reviewed identities from high-confidence source-scoped catalogue records instead of collapsing equal names.",
      figure: svg,
      index: "INDEX",
      note: [element("span", { text: "Known matches only · open-world coverage." })],
    });
    const list = element("div", { class: "catalogue-list" });
    graphMatches.forEach((match) => {
      const record = reviewedByEntity.get(match.nodeId);
      const button = element("button", { type: "button" }, [
        element("strong", { text: record.label }),
        element("small", { text: `reviewed identity · ${humanize(record.display_kind)}` }),
      ]);
      button.addEventListener("click", () => renderEntity(record.entity_id));
      list.append(button);
    });
    catalogue.forEach((record) => {
      const button = element("button", { type: "button" }, [
        element("strong", { text: record.label }),
        element("small", { text: `${humanize(record.category)} · source-scoped` }),
      ]);
      button.addEventListener("click", () => renderCatalogueRecord(record));
      list.append(button);
    });
    article.append(list);
    clear(stage);
    stage.append(article);
    const outline = outlineHeading(`Matches for ${term}`, "Reviewed and source-scoped records remain distinct.");
    const ol = element("ol");
    graphMatches.forEach((match) => ol.append(element("li", { text: `${match.node.label} — reviewed identity` })));
    catalogue.forEach((record) => ol.append(element("li", { text: `${record.label} — source-scoped ${humanize(record.category)}` })));
    outline.append(ol);
    document.body.dataset.queryKind = "find_representation";
    document.body.dataset.queryCapability = "AVAILABLE";
    setEpistemic("reviewed plus high-confidence source-scoped", "known matches / open world", "discovery available");
    updateTrail(`Find ${term}`, () => renderCatalogueResults(term, graphMatches));
    if (navigate) setUrl({ q: term });
  }

  function fixtureNote() {
    return [
      element("span", {}, [element("strong", { text: "Authority: " }), "synthetic presentation fixture"]),
      element("span", { text: "Tests visual grammar only; adds no corpus or map fact." }),
    ];
  }

  function renderFixture(fixtureId, { navigate = true } = {}) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) return;
    if (fixture.fixture_state === "GOVERNED_CURRENT_DATA" && fixture.plate_type === "ENTITY_LAYER_SCORE") {
      renderEntity(fixture.subject_entity_ids[0], null, { navigate: false });
    } else if (fixture.fixture_state === "GOVERNED_CURRENT_DATA" && fixture.plate_type === "COMPARISON") {
      renderComparison(fixture.subject_entity_ids[0], fixture.subject_entity_ids[1], null, { navigate: false });
    } else if (fixture.plate_type === "RANGE_HABITAT") {
      const svg = makeSvg(`${fixture.label} synthetic range fixture`, 520);
      svg.append(
        svgElement("path", { d: "M120,112 V78 H1080 V112", stroke: "#172733", fill: "none", "stroke-width": 2 }),
        svgElement("text", { x: 600, y: 60, class: "micro", "text-anchor": "middle" }, "KNOWN GOVERNED RANGE / OCCURRENCES · OPEN WORLD FIXTURE"),
      );
      fixture.components.forEach((component, index) => {
        const x = 155 + index * 510;
        svg.append(
          svgElement("rect", { x, y: 135, width: 380, height: 255, fill: "none", stroke: "#375b61", "stroke-width": 1.5 }),
          svgElement("text", { x: x + 28, y: 182, class: "serif", "font-size": 27 }, component.label),
        );
        component.address.forEach((line, lineIndex) => svg.append(svgElement("text", { x: x + 28, y: 230 + lineIndex * 38, class: "label" }, line)));
      });
      (fixture.observations ?? []).forEach((observation, index) => {
        const x = 260 + index * 420;
        svg.append(
          svgElement("circle", { cx: x, cy: 447, r: 7, fill: "none", stroke: "#b35b3f", "stroke-width": 2 }),
          svgElement("line", { x1: x - 11, y1: 447, x2: x + 11, y2: 447, stroke: "#b35b3f" }),
          svgElement("text", { x: x + 20, y: 442, class: "micro" }, "OBSERVATION · NOT RANGE"),
          svgElement("text", { x: x + 20, y: 461, class: "annotation" }, `${observation.label} · ${observation.address.join(" / ")}`),
        );
      });
      clear(stage);
      stage.append(plateShell({
        plateType: "RANGE_HABITAT",
        kicker: "Extent bracket · equal address stacks",
        title: fixture.label,
        dek: "Components are equal explanatory stacks. Their order and size assert no geography or prevalence.",
        figure: svg,
        synthetic: true,
        index: "FIXTURE 02",
        note: fixtureNote(),
      }));
      outlineHeading(fixture.label, "Synthetic range fixture.").append(element("ul", {}, fixture.components.map((row) => element("li", { text: `${row.label}: ${row.address.join(", ")}` }))));
    } else if (fixture.plate_type === "PROCESS_LIFECYCLE") {
      const svg = makeSvg(`${fixture.label} synthetic process fixture`, 480);
      const gapIndex = fixture.stages.findIndex((row) => row.measure_after === "unknown");
      fixture.stages.forEach((stageItem, index) => {
        const x = 105 + index * 245;
        svg.append(svgElement("circle", { cx: x, cy: 180, r: 22, fill: "#fbfaf5", stroke: "#172733", "stroke-width": 2 }));
        svg.append(svgElement("text", { x, y: 230, class: "label", "text-anchor": "middle" }, stageItem.label));
        if (stageItem.event) svg.append(svgElement("text", { x, y: 257, class: "micro", "text-anchor": "middle" }, stageItem.event));
        if (index < fixture.stages.length - 1) {
          const next = x + 245;
          if (index === gapIndex) {
            svg.append(svgElement("path", { d: `M${x + 24},180 H${x + 92} M${next - 92},180 H${next - 24}`, class: "unknown-rift" }));
            svg.append(svgElement("text", { x: x + 122, y: 162, class: "micro", "text-anchor": "middle" }, "UNKNOWN LEG"));
          } else svg.append(svgElement("line", { x1: x + 24, y1: 180, x2: next - 24, y2: 180, stroke: "#b35b3f", "stroke-width": 2 }));
          if (stageItem.measure_after) svg.append(svgElement("text", { x: x + 122, y: 205, class: "annotation", "text-anchor": "middle" }, stageItem.measure_after));
        }
      });
      svg.append(
        svgElement("text", { x: 600, y: 340, class: "label", "text-anchor": "middle" }, fixture.certified_partial_sum),
        svgElement("text", { x: 600, y: 382, class: "serif", "font-size": 30, "text-anchor": "middle" }, "Lifetime total unknown"),
      );
      clear(stage);
      stage.append(plateShell({
        plateType: "PROCESS_LIFECYCLE",
        kicker: "Ordered thread · visible unknown leg",
        title: fixture.label,
        dek: "Equal stage spacing is explanatory. Measurements attach to their own legs; the unknown leg prevents a lifetime total.",
        figure: svg,
        synthetic: true,
        index: "FIXTURE 03",
        note: fixtureNote(),
      }));
      outlineHeading(fixture.label, `Synthetic lifecycle fixture; ${fixture.certified_partial_sum}; lifetime total unknown.`).append(element("ol", {}, fixture.stages.map((row) => element("li", { text: `${row.label}${row.measure_after ? ` — next leg: ${row.measure_after}` : ""}${row.event ? ` — ${row.event}` : ""}` }))));
    } else if (fixture.plate_type === "JURISDICTION_WEAVE") {
      const svg = makeSvg(`${fixture.label} synthetic governance weave`, 530);
      fixture.components.forEach((component, index) => {
        const x = 330 + index * 370;
        svg.append(svgElement("rect", { x, y: 72, width: 320, height: 350, fill: "none", stroke: "#bdc1bd" }));
        svg.append(svgElement("text", { x: x + 160, y: 52, class: "label", "text-anchor": "middle" }, component));
      });
      fixture.roles.forEach((role, index) => {
        const y = 130 + index * 92;
        const start = 330 + Math.min(...role.spans) * 370;
        const end = 330 + Math.max(...role.spans) * 370 + 320;
        svg.append(
          svgElement("text", { x: 60, y: y + 8, class: "micro" }, role.role),
          svgElement("rect", { x: start, y: y - 20, width: end - start, height: 42, rx: 21, fill: "none", stroke: "#80506d", "stroke-width": 2 }),
          svgElement("text", { x: (start + end) / 2, y: y + 7, class: "label", "text-anchor": "middle" }, role.actor),
        );
      });
      clear(stage);
      stage.append(plateShell({
        plateType: "JURISDICTION_WEAVE",
        kicker: "Roles across equal multipart extents",
        title: fixture.label,
        dek: "Columns are named components in presentation order. Actor ribbons show qualified roles, not mapped territory.",
        figure: svg,
        synthetic: true,
        index: "FIXTURE 04",
        note: fixtureNote(),
      }));
      outlineHeading(fixture.label, "Synthetic multipart governance fixture.").append(element("ul", {}, fixture.roles.map((row) => element("li", { text: `${row.actor} ${row.role}: ${row.spans.map((index) => fixture.components[index]).join(", ")}` }))));
    } else if (fixture.plate_type === "PHYSICAL_STRATA") {
      const svg = makeSvg(`${fixture.label} synthetic local strata section`, 560);
      fixture.bands.forEach((band, index) => {
        const y = 62 + index * 92;
        svg.append(
          svgElement("rect", {
            x: 140, y, width: 920, height: 78,
            fill: index === 2 ? "none" : index % 2 ? "rgba(55,91,97,.08)" : "rgba(167,119,41,.07)",
            stroke: index === 2 ? "#a34232" : "#172733",
            "stroke-dasharray": index === 2 ? "8 7" : "none",
          }),
          svgElement("text", { x: 175, y: y + 47, class: "label" }, band),
        );
      });
      svg.append(
        svgElement("path", { d: "M890,50 L825,140 L900,230 L818,326 L875,428", stroke: "#b35b3f", "stroke-width": 4, fill: "none" }),
        svgElement("text", { x: 930, y: 245, class: "micro" }, fixture.trace),
        svgElement("text", { x: 600, y: 485, class: "micro muted", "text-anchor": "middle" }, "LOCAL ORDER · EQUAL SCHEMATIC BANDS · NOT A GLOBAL SECTION"),
      );
      clear(stage);
      stage.append(plateShell({
        plateType: "PHYSICAL_STRATA",
        kicker: "Local physical order · equal bands",
        title: fixture.label,
        dek: "Vertical order is local to the fixture. Band thickness is equal by design and encodes no measured thickness.",
        figure: svg,
        synthetic: true,
        index: "FIXTURE 05",
        note: fixtureNote(),
      }));
      outlineHeading(fixture.label, "Synthetic local section; equal schematic bands.").append(element("ol", {}, fixture.bands.map((row) => element("li", { text: row }))));
    }
    document.body.dataset.queryKind = `fixture_${fixture.plate_type.toLocaleLowerCase()}`;
    document.body.dataset.queryCapability = "SYNTHETIC_FIXTURE";
    setEpistemic("synthetic fixture", "presentation test only", "not corpus evidence");
    updateTrail(fixture.label, () => renderFixture(fixtureId));
    if (navigate) setUrl({ fixture: fixtureId });
    setLive(`${fixture.label} visual grammar fixture opened.`);
  }

  function openRecord(record) {
    if (record.record_state === "REVIEWED_IDENTITY") renderEntity(record.entity_id);
    else renderCatalogueRecord(record);
  }

  function submitQuery(raw, { navigate = true } = {}) {
    const query = raw.trim();
    if (!query) {
      renderHome({ navigate });
      return;
    }
    const plan = planSemanticQuery(query, context);
    if (plan.result_shape === "RELATION_BANDS") renderEntity(plan.entity.nodeId, plan, { navigate: false });
    else if (plan.result_shape === "COMPARISON") renderComparison(plan.entities[0].nodeId, plan.entities[1].nodeId, plan, { navigate: false });
    else if (plan.result_shape === "MEASUREMENT_LEDGER") renderMeasurements(plan, { navigate: false });
    else if (plan.result_shape === "CAPABILITY_GAP") renderGap(plan, query, { navigate: false });
    else if (plan.result_shape === "ENTITY_SET") {
      if (plan.matches.length === 1) renderEntity(plan.matches[0].nodeId, plan, { navigate: false });
      else renderCatalogueResults(query, plan.matches, { navigate: false });
    } else if (plan.result_shape === "ENTITY_RESOLUTION") renderCatalogueResults(query, plan.matches ?? [], { navigate: false });
    else renderCatalogueResults(query, [], { navigate: false });
    if (navigate) setUrl({ q: query });
  }

  function installFixtures() {
    const list = document.getElementById("fixture-list");
    fixtures.fixtures.forEach((fixture, index) => {
      const button = element("button", {
        type: "button",
        text: `${index + 1}. ${fixture.label}${fixture.fixture_state.startsWith("SYNTHETIC") ? " · synthetic" : ""}`,
      });
      button.addEventListener("click", () => renderFixture(fixture.fixture_id));
      list.append(button);
    });
  }

  function installSearch() {
    const form = document.getElementById("command-form");
    const input = document.getElementById("command-input");
    const results = document.getElementById("search-results");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      results.hidden = true;
      submitQuery(input.value);
    });
    input.addEventListener("input", () => {
      const term = input.value.trim();
      clear(results);
      if (term.length < 2 || /^(related|compare|measure|where|how)\b/i.test(term)) {
        results.hidden = true;
        return;
      }
      const reviewed = findMatches(context.searchRecords, term, 5);
      const needle = normalize(term);
      const catalogue = catalogueSearch.filter((row) => row.search.includes(needle)).slice(0, 5);
      [...reviewed.map((match) => ({ record: reviewedByEntity.get(match.nodeId), scope: "reviewed identity" })),
        ...catalogue.map((record) => ({ record, scope: "source-scoped catalogue" }))].forEach(({ record, scope }) => {
        if (!record) return;
        const button = element("button", { type: "button", role: "option" }, [
          element("span", { text: record.label }),
          element("small", { text: scope }),
        ]);
        button.addEventListener("click", () => {
          input.value = record.label;
          results.hidden = true;
          openRecord(record);
        });
        results.append(button);
      });
      results.hidden = !results.childElementCount;
    });
    document.addEventListener("click", (event) => {
      if (!form.contains(event.target)) results.hidden = true;
    });
  }

  installFixtures();
  installSearch();

  const params = new URLSearchParams(location.search);
  const requestedBuild = params.get("build");
  if (requestedBuild && requestedBuild !== representation.representation_digest) {
    setLive(`Saved view used representation ${digest(requestedBuild)}; replaying on ${digest(representation.representation_digest)}.`);
  }
  if (params.get("fixture")) renderFixture(params.get("fixture"), { navigate: false });
  else if (params.get("catalogue") && catalogueById.has(params.get("catalogue"))) renderCatalogueRecord(catalogueById.get(params.get("catalogue")), { navigate: false });
  else if (params.get("focus") && reviewedByEntity.has(params.get("focus"))) renderEntity(params.get("focus"), null, { navigate: false });
  else if (params.get("layer")) {
    const raw = params.get("layer");
    const layer = representation.layers.find((row) => row.layer_id === raw || row.label === raw);
    if (layer) renderLayer(layer.layer_id, { navigate: false });
    else renderHome({ navigate: false });
  } else if (params.get("q")) {
    document.getElementById("command-input").value = params.get("q");
    submitQuery(params.get("q"), { navigate: false });
  } else renderHome({ navigate: false });

  window.addEventListener("popstate", () => location.reload());
  document.body.dataset.nodeCount = String(graph.nodes.length);
  document.body.dataset.catalogueCount = String(representation.catalogue_records.length);
  document.body.dataset.representationDigest = representation.representation_digest;
  document.body.dataset.ready = "true";
}

start().catch((error) => {
  document.body.dataset.ready = "error";
  const stage = document.getElementById("answer-panel");
  clear(stage);
  stage.append(element("article", { class: "knowledge-plate" }, [
    element("header", { class: "plate-heading" }, [
      element("div", {}, [
        element("p", { class: "plate-kicker", text: "Build failure" }),
        element("h1", { text: "The knowledge plate could not be composed." }),
        element("p", { class: "plate-dek", text: error.message }),
      ]),
    ]),
  ]));
  setLive(`Knowledge viewer error: ${error.message}`);
  console.error(error);
});
