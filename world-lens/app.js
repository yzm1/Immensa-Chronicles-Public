import {
  createQueryContext,
  findMatches,
  parseCommand,
  planSemanticQuery,
  relationRowsForNode,
} from "./semantic-query.js";

const DATA = {
  graph: "./data/graph.json",
  query: "./data/query-index.json",
  capabilities: "./data/capabilities.json",
  measurements: "./data/measurement-index.json",
  manifest: "./data/explorer-manifest.json",
};

const LAYERS = [
  ["Physical & places", "physical", "Places, regions, spatial features and physical structure", null],
  ["Movement & infrastructure", "movement", "Routes, transitions, access, flow and travel observations", null],
  ["Social & political", "social", "Peoples, polities and social organization", null],
  ["Ownership & control", "social", "Ownership, jurisdiction, control and claims", "governance_control"],
  ["Institutions & organizations", "social", "Institutions, guilds, orders and organizations", null],
  ["Culture & language", "culture", "Languages, customs and cultural participation", "culture_diffusion"],
  ["Worship & religion", "culture", "Belief, cult, shrine and pilgrimage", "culture_diffusion"],
  ["Living & ecology", "movement", "Taxa, habitats, ranges, occurrences and ecological relations", "ecology_range"],
  ["Resources, economy & industry", "physical", "Resources, trades, production and exchange", "governance_control"],
  ["Communications", "movement", "Signals, messages and communication networks", "traversal_path"],
  ["Agents & lives", "social", "People, roles, lives and biographies", null],
  ["Metaphysical", "culture", "Spirits, planes, fields and metaphysical processes", "plane_filter"],
  ["Temporal & historical", "social", "Events, periods, recurrence and change", "global_time"],
];

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

function clear(node) { node.replaceChildren(); }
function humanize(value) {
  if (RELATION_LABELS[value]) return RELATION_LABELS[value];
  return String(value ?? "unknown").toLocaleLowerCase().replaceAll("_", " ");
}
function meaningfulLayers(node) {
  return (node.layers ?? []).filter((layer) => !/debug/i.test(layer));
}
function digest(value) { return String(value ?? "unknown").replace(/^sha256:/, "").slice(0, 12); }
function setLive(message) { document.getElementById("live-status").textContent = message; }
async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function statusBoard(plan) {
  return element("div", { class: "answer-status" }, [
    statusCell("Support", plan.support_status),
    statusCell("Coverage", plan.coverage_status),
    statusCell("Capability", plan.capability_state, plan.capability_state !== "AVAILABLE"),
  ]);
}

function statusCell(label, value, gap = false) {
  return element("div", { class: `status-cell ${gap ? "gap" : ""}` }, [
    element("span", { text: label }),
    element("strong", { text: humanize(value) }),
  ]);
}

function entityCard(match, openDossier) {
  const button = element("button", {
    class: `entity-card ${match.kind ?? "ambiguous"}`,
    type: "button",
    "data-node-id": match.nodeId,
  }, [
    element("strong", { text: match.node.label }),
    element("span", { text: `${humanize(match.kind)} · ${humanize(match.node.identity_status)}` }),
  ]);
  button.addEventListener("click", () => openDossier(match.nodeId));
  return button;
}

function planHeader(plan) {
  return element("div", { class: "answer-heading" }, [
    element("div", {}, [
      element("p", { class: "eyebrow", text: `Result form · ${humanize(plan.result_shape)}` }),
      element("h2", { text: plan.summary }),
      plan.explanation ? element("p", { text: plan.explanation }) : null,
      element("div", { class: "plan-chips" }, [
        element("span", { class: "chip", text: plan.parser }),
        element("span", { class: "chip", text: humanize(plan.parsed_intent) }),
        ...plan.parsed_terms.map((term) => element("span", { class: "chip", text: term })),
      ]),
    ]),
  ]);
}

function installViewNavigation() {
  const buttons = [...document.querySelectorAll("[data-view-target]")];
  const panels = [...document.querySelectorAll(".view-panel")];
  const activate = (target) => {
    for (const panel of panels) panel.classList.toggle("mobile-active", panel.id === target);
    for (const button of buttons) button.classList.toggle("active", button.dataset.viewTarget === target);
  };
  for (const button of buttons) button.addEventListener("click", () => activate(button.dataset.viewTarget));
  activate("ask-view");
  return activate;
}

function saveState(context, extras = {}) {
  const url = new URL(location.href);
  url.searchParams.set("build", context.graph.semantic_digest);
  for (const [key, value] of Object.entries(extras)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

async function start() {
  const [graph, queryIndex, capabilities, measurementIndex, manifest] = await Promise.all([
    fetchJson(DATA.graph), fetchJson(DATA.query), fetchJson(DATA.capabilities),
    fetchJson(DATA.measurements), fetchJson(DATA.manifest),
  ]);
  if (![queryIndex.semantic_digest, capabilities.semantic_digest, measurementIndex.semantic_digest].every((value) => value === graph.semantic_digest)) {
    throw new Error("World Lens semantic inputs do not share one digest");
  }
  if (manifest.publication_policy !== "PUBLIC_CLEAN_PRIVATE_DEBUG") {
    throw new Error(`Unexpected publication policy: ${manifest.publication_policy}`);
  }
  const context = createQueryContext(graph, queryIndex, measurementIndex, capabilities);
  const activateView = installViewNavigation();
  const answer = document.getElementById("answer-panel");
  const dossier = document.getElementById("dossier-content");
  const params = new URLSearchParams(location.search);
  const requestedBuild = params.get("build");
  document.getElementById("build-id").textContent = `active working · semantic ${digest(graph.semantic_digest)}`;
  if (requestedBuild && requestedBuild !== graph.semantic_digest) {
    const warning = document.getElementById("build-warning");
    warning.hidden = false;
    warning.textContent = `This view was saved against ${digest(requestedBuild)} and is being replayed on ${digest(graph.semantic_digest)}.`;
  }

  function openDossier(nodeId) {
    const node = context.nodeById.get(nodeId);
    const info = queryIndex.node_index[nodeId];
    if (!node || !info) return;
    const relations = relationRowsForNode(nodeId, queryIndex, context.displayEdgeById);
    const measures = context.measurementsByNode.get(nodeId) ?? [];
    clear(dossier);
    dossier.append(
      element("p", { class: "eyebrow", text: "Entity dossier" }),
      element("h2", { class: "dossier-title", text: node.label }),
      element("p", { class: "dossier-kind", text: `${humanize(info.display_kind)} · ${humanize(node.identity_status)}` }),
    );
    if (node.identity_status.startsWith("SOURCE_SCOPED")) {
      dossier.append(element("div", { class: "identity-warning", text: "This is a source-scoped identity. Similar wording elsewhere has not been silently merged or promoted." }));
    }
    dossier.append(element("div", { class: "dossier-section" }, [
      element("h3", { text: "Known state" }),
      element("div", { class: "fact-list" }, [
        fact("Layers", meaningfulLayers(node).join(", ") || "none meaningfully governed"),
        fact("Planes", node.plane_memberships.length ? node.plane_memberships.join(", ") : "not governed in this build"),
        fact("Strata", node.physical_strata.length ? node.physical_strata.join(", ") : "not governed in this build"),
        fact("Placement", humanize(node.knowledge_profile.placement_policy)),
        fact("Relations", `${relations.length} governed display records`),
        fact("Measures", `${measures.length} stated records`),
      ]),
    ]));
    if (meaningfulLayers(node).length || node.facets.length) {
      dossier.append(element("div", { class: "dossier-section" }, [
        element("h3", { text: "Classification" }),
        element("div", { class: "chip-row" }, [
          ...meaningfulLayers(node).map((value) => element("span", { class: "chip", text: value })),
          ...node.facets.filter((value) => !/debug|unclassified_candidate/i.test(value)).map((value) => element("span", { class: "chip", text: humanize(value) })),
        ]),
      ]));
    }
    dossier.append(element("div", { class: "dossier-section" }, [
      element("h3", { text: `Known relations (${relations.length})` }),
      element("div", { class: "mini-relations" }, relations.slice(0, 16).map((edge) => {
        const otherId = edge.from_node === nodeId ? edge.to_node : edge.from_node;
        return element("div", { class: "mini-relation", text: `${humanize(edge.relation_type)} · ${context.nodeById.get(otherId)?.label ?? otherId}` });
      })),
      relations.length > 16 ? element("p", { text: `${relations.length - 16} further governed relation records are available through a relation query.` }) : null,
    ]));
    const topologyLink = element("a", {
      class: "dossier-link",
      href: `../world-topology/?focus=${encodeURIComponent(nodeId)}&build=${encodeURIComponent(graph.semantic_digest)}`,
      text: "Examine this identity in World Topology",
    });
    dossier.append(topologyLink);
    saveState(context, { focus: nodeId });
    activateView("details-view");
    setLive(`${node.label} dossier opened.`);
  }

  function fact(label, value) {
    return element("div", {}, [element("strong", { text: label }), element("span", { text: value })]);
  }

  function renderPlan(plan, raw) {
    clear(answer);
    answer.append(planHeader(plan), statusBoard(plan));
    if (plan.result_shape === "ENTITY_SET") renderEntitySet(plan);
    else if (plan.result_shape === "ENTITY_RESOLUTION") renderResolution(plan, raw);
    else if (plan.result_shape === "RELATION_BANDS") renderRelations(plan);
    else if (plan.result_shape === "MEASUREMENT_LEDGER") renderMeasurements(plan);
    else if (plan.result_shape === "COMPARISON") renderComparison(plan);
    else if (plan.result_shape === "CAPABILITY_GAP") renderGap(plan);
    document.body.dataset.queryKind = plan.query_id;
    document.body.dataset.queryCapability = plan.capability_state;
    saveState(context, { q: raw });
    activateView("ask-view");
    answer.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    setLive(`${plan.summary} Support ${humanize(plan.support_status)}. Coverage ${humanize(plan.coverage_status)}.`);
  }

  function renderEntitySet(plan) {
    answer.append(element("p", { class: "coverage-label", text: "Known governed identity records in this build" }));
    if (!plan.matches.length) {
      answer.append(element("div", { class: "capability-gap" }, [
        element("h3", { text: "No governed identity match" }),
        element("p", { text: "The clean knowledge view does not substitute unreviewed corpus text for a governed identity." }),
      ]));
      return;
    }
    const cabinet = element("div", { class: "set-cabinet" });
    for (const match of plan.matches) cabinet.append(entityCard(match, openDossier));
    answer.append(cabinet);
  }

  function renderResolution(plan, raw) {
    if (!plan.matches.length) {
      answer.append(element("div", { class: "capability-gap" }, [
        element("h3", { text: "Identity not governed" }),
        element("p", { text: "The clean knowledge view does not fall back to corpus text search or invent an entity." }),
      ]));
      return;
    }
    answer.append(element("p", { text: "Matching name records remain distinct. Choose one to continue." }));
    const cabinet = element("div", { class: "set-cabinet" });
    for (const match of plan.matches) {
      const card = entityCard(match, (nodeId) => {
        openDossier(nodeId);
        document.getElementById("command-input").value = `find ${match.node.label}`;
      });
      cabinet.append(card);
    }
    answer.append(cabinet);
  }

  function renderRelations(plan) {
    const subjectId = plan.entity.nodeId;
    const board = element("div", { class: "relation-board" });
    board.append(element("div", { class: "subject-plaque" }, [
      element("strong", { text: plan.entity.node.label }),
      element("span", { text: `${plan.relations.length} known records` }),
    ]));
    for (const edge of plan.relations) {
      const otherId = edge.from_node === subjectId ? edge.to_node : edge.from_node;
      const target = context.nodeById.get(otherId);
      const button = element("button", { class: "relation-target", type: "button", text: target?.label ?? otherId });
      button.addEventListener("click", () => openDossier(otherId));
      board.append(element("div", { class: "relation-band", "data-relation-type": edge.relation_type }, [
        element("div", { class: "relation-predicate", text: humanize(edge.relation_type) }),
        button,
        element("div", { class: "relation-meta", text: edge.projections.join(" · ") }),
      ]));
    }
    if (!plan.relations.length) board.append(element("div", { class: "capability-gap", text: "No governed matching relation exists in this build." }));
    answer.append(board);
  }

  function renderMeasurements(plan) {
    answer.append(element("div", { class: "safety-card" }, [
      element("strong", { text: "Known values are not safely additive" }),
      element("div", { text: "They may concern different domains, routes, episodes, directions or overlapping extents. No total or lower bound is inferred." }),
    ]));
    const ledger = element("div", { class: "measurement-ledger" });
    if (!plan.measurements.length) {
      ledger.append(element("div", { class: "capability-gap" }, [
        element("h3", { text: "No stated measurement record" }),
        element("p", { text: "No quantity involving this governed identity is present in the compiled clean view." }),
      ]));
    }
    for (const measure of plan.measurements) {
      ledger.append(element("article", { class: "measure-tile" }, [
        element("small", { text: humanize(measure.quantity_kind) }),
        element("strong", { text: measure.value_verbatim }),
        element("span", { text: humanize(measure.relation_type) }),
      ]));
    }
    answer.append(ledger);
  }

  function renderComparison(plan) {
    const [left, right] = plan.entities;
    const leftInfo = queryIndex.node_index[left.nodeId];
    const rightInfo = queryIndex.node_index[right.nodeId];
    const rows = [
      ["Identity", humanize(left.node.identity_status), humanize(right.node.identity_status)],
      ["Display kind", humanize(leftInfo.display_kind), humanize(rightInfo.display_kind)],
      ["Meaningful layers", meaningfulLayers(left.node).join(", ") || "none governed", meaningfulLayers(right.node).join(", ") || "none governed"],
      ["Plane", left.node.plane_memberships.join(", ") || "not governed", right.node.plane_memberships.join(", ") || "not governed"],
      ["Known assertion records", leftInfo.assertion_ids.length, rightInfo.assertion_ids.length],
    ];
    const table = element("table", { class: "answer-table" });
    table.append(element("thead", {}, element("tr", {}, [
      element("th", { text: "Dimension" }), element("th", { text: left.node.label }), element("th", { text: right.node.label }),
    ])));
    const body = element("tbody");
    for (const row of rows) body.append(element("tr", {}, row.map((value) => element("td", { text: value }))));
    table.append(body);
    answer.append(table, element("p", { class: "coverage-label", text: "Record counts are not world importance or exhaustive knowledge." }));
  }

  function renderGap(plan) {
    const gap = element("div", { class: "capability-gap" }, [
      element("h3", { text: "The record is dark here" }),
      plan.calculation_status ? element("span", { class: "calculation-state", text: plan.calculation_status.replaceAll("_", " ") }) : null,
      element("p", { text: plan.explanation }),
      element("h4", { text: "Missing governed prerequisites" }),
      element("ul", {}, plan.missing_prerequisites.map((item) => element("li", { text: item }))),
      element("p", { text: "No corpus text approximation, topology-distance inference or invented ordering was used." }),
    ]);
    answer.append(gap);
  }

  function showLayer(name) {
    const records = context.searchRecords.filter((record) => meaningfulLayers(record.node).includes(name));
    const registry = LAYERS.find(([layer]) => layer === name);
    const capabilityId = registry?.[3];
    const capability = capabilityId ? capabilities.queries[capabilityId] : null;
    const plan = {
      query_id: "browse_layer",
      semantic_digest: graph.semantic_digest,
      parsed_intent: "browse layer",
      parsed_terms: [name],
      parser: "layer browser",
      result_shape: records.length ? "ENTITY_SET" : "CAPABILITY_GAP",
      support_status: records.length ? "DIRECTLY_STATED" : "UNSUPPORTED",
      coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
      capability_state: records.length ? "AVAILABLE" : "UNAVAILABLE",
      missing_prerequisites: capability?.missing ?? ["governed layer membership or relation instances"],
      summary: records.length
        ? `${records.length} governed identity record${records.length === 1 ? "" : "s"} participate in ${name} in this build.`
        : `${name} is representable but has no governed reader records in this build.`,
      explanation: registry?.[2],
      matches: records,
    };
    renderPlan(plan, "");
    saveState(context, { layer: name, q: "" });
  }

  function showFeature(kind) {
    const records = context.searchRecords.filter((record) => record.kind === kind);
    renderPlan({
      query_id: "browse_feature",
      semantic_digest: graph.semantic_digest,
      parsed_intent: "browse feature",
      parsed_terms: [kind],
      parser: "feature cabinet",
      result_shape: "ENTITY_SET",
      support_status: "DIRECTLY_STATED",
      coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
      capability_state: "AVAILABLE",
      summary: `${records.length} governed ${humanize(kind)} identity record${records.length === 1 ? "" : "s"} in this build.`,
      matches: records,
    }, "");
  }

  function buildSpectrum() {
    const layerList = document.getElementById("layer-list");
    const gaps = document.getElementById("capability-gaps");
    for (const [name, tone, description, capabilityId] of LAYERS) {
      const count = graph.nodes.filter((node) => meaningfulLayers(node).includes(name)).length;
      const capability = capabilityId ? capabilities.queries[capabilityId] : null;
      const button = element("button", { class: `layer-button ${tone} ${count ? "" : "dark"}`, type: "button" }, [
        element("span", { class: "layer-swatch", "aria-hidden": "true" }),
        element("span", { text: name }),
        element("small", { text: count ? String(count) : "dark" }),
      ]);
      button.title = description;
      button.addEventListener("click", () => showLayer(name));
      layerList.append(button);
      if (!count) gaps.append(element("div", { class: "gap-note" }, [
        element("strong", { text: name }),
        element("span", { text: capability?.note ?? "No governed layer membership in this reviewed build." }),
      ]));
    }
    const kinds = new Map();
    for (const record of context.searchRecords) kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
    const featureList = document.getElementById("feature-list");
    for (const [kind, count] of [...kinds].sort()) {
      const label = kind === "ambiguous" ? `source-scoped / unresolved · ${count}` : `${humanize(kind)} · ${count}`;
      const button = element("button", { type: "button", text: label });
      button.addEventListener("click", () => showFeature(kind));
      featureList.append(button);
    }
  }

  function buildAnchors() {
    const target = document.getElementById("anchor-cabinet");
    const anchors = context.searchRecords
      .filter((record) => record.node.identity_status.startsWith("CANONICAL"))
      .sort((a, b) => b.rank - a.rank || a.node.label.localeCompare(b.node.label))
      .slice(0, 12);
    for (const record of anchors) target.append(entityCard(record, openDossier));
  }

  buildSpectrum();
  buildAnchors();

  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  const suggestions = document.getElementById("search-results");
  function execute(raw) {
    if (!raw.trim()) return;
    renderPlan(planSemanticQuery(raw, context), raw);
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); clear(suggestions); execute(input.value); });
  input.addEventListener("input", () => {
    clear(suggestions);
    const parsed = parseCommand(input.value, { guided: true });
    const term = parsed.arguments.at(-1) ?? input.value;
    for (const match of findMatches(context.searchRecords, term, 8)) {
      const button = element("button", { type: "button" }, [
        element("strong", { text: match.node.label }),
        element("small", { text: `${humanize(match.kind)} · ${humanize(match.node.identity_status)}` }),
      ]);
      button.addEventListener("click", () => { input.value = `find ${match.node.label}`; clear(suggestions); execute(input.value); });
      suggestions.append(button);
    }
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") clear(suggestions); });
  document.addEventListener("click", (event) => { if (!form.contains(event.target)) clear(suggestions); });
  for (const button of document.querySelectorAll("[data-query]")) {
    button.addEventListener("click", () => { input.value = button.dataset.query; execute(input.value); });
  }

  const focus = params.get("focus");
  const query = params.get("q");
  const layer = params.get("layer");
  if (focus && context.nodeById.has(focus)) openDossier(focus);
  if (layer && LAYERS.some(([name]) => name === layer)) showLayer(layer);
  if (query) { input.value = query; execute(query); }

  document.body.dataset.ready = "true";
  document.body.dataset.nodeCount = String(graph.nodes.length);
  document.body.dataset.semanticDigest = graph.semantic_digest;
  window.__IMMENSA_WORLD_LENS_READY__ = {
    nodeCount: graph.nodes.length,
    semanticDigest: graph.semantic_digest,
    publicationPolicy: manifest.publication_policy,
  };
  setLive(`World Lens ready with ${graph.nodes.length} governed identity records.`);
}

start().catch((error) => {
  console.error(error);
  document.body.dataset.ready = "error";
  const target = document.getElementById("answer-panel");
  target.replaceChildren(element("h2", { text: "World Lens failed to load" }), element("p", { text: error.message }));
});
