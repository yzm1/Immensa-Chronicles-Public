const GRAPH_URL = "./data/graph.json";
const QUERY_URL = "./data/query-index.json";
const CAPABILITIES_URL = "./data/capabilities.json";
const MEASUREMENTS_URL = "./data/measurement-index.json";
const LAYOUT_URL = "./data/layout-state.json";
const MANIFEST_URL = "./data/explorer-manifest.json";

const LENS_LABELS = {
  balanced: "Balanced topology",
  movement: "Movement & access",
  flow: "Flows",
  visibility: "Visibility",
  refusal: "Refusals & severance",
  ecology: "Living & ecology",
  jurisdiction_control: "Governance & control",
  culture_diffusion: "Culture & diffusion",
  temporal: "History & time",
};

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
};

const LENS_PROJECTIONS = {
  balanced: new Set(["spatial_structure"]),
  movement: new Set(["spatial_structure", "traversal"]),
  flow: new Set(["flow"]),
  visibility: new Set(["visibility_influence"]),
  refusal: new Set(["refusal_conflict"]),
  ecology: new Set(["ecology"]),
  jurisdiction_control: new Set(["jurisdiction_control"]),
  culture_diffusion: new Set(["culture_diffusion"]),
  temporal: new Set(["temporal"]),
};

function element(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "htmlFor") node.htmlFor = value;
    else if (key.startsWith("aria-")) node.setAttribute(key, value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "disabled") node.disabled = Boolean(value);
    else if (key === "hidden") node.hidden = Boolean(value);
    else node.setAttribute(key, value);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replaceAll("’", "'")
    .replace(/[^\p{L}\p{N}_'\-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function humanize(value) {
  if (RELATION_LABELS[value]) return RELATION_LABELS[value];
  return String(value ?? "unknown").toLocaleLowerCase().replaceAll("_", " ");
}

function statusChip(value) {
  const lowered = String(value).toLocaleLowerCase();
  let kind = "";
  if (lowered.includes("story")) kind = "story";
  else if (lowered.includes("working")) kind = "working";
  else if (lowered.includes("unknown") || lowered.includes("unresolved")) kind = "warning";
  return element("span", { class: `chip ${kind}`, text: humanize(value) });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function setStatus(message) {
  const live = document.getElementById("live-status");
  if (live) live.textContent = message;
}

function displayLabel(node, rank, zoom, selected) {
  if (selected || rank >= 90) return node.label;
  if (zoom >= 1.35) return node.label;
  if (zoom >= 0.8 && rank >= 60) return node.label;
  if (zoom >= 0.58 && rank >= 100) return node.label;
  return "";
}

function formatDigest(value) {
  return String(value ?? "unknown").replace(/^sha256:/, "").slice(0, 12);
}

function participantLabel(participant, nodeById) {
  const node = nodeById.get(participant.entity_id);
  return `${humanize(participant.role)}: ${node?.label ?? participant.entity_id}`;
}

function supportCoverage(support, coverage) {
  return element("div", { class: "answer-status" }, [
    element("strong", { text: `Support: ${humanize(support)}` }),
    element("br"),
    element("span", { text: `Coverage: ${humanize(coverage)}` }),
  ]);
}

function buildSearchRecords(graph, queryIndex) {
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  return Object.entries(queryIndex.node_index)
    .map(([nodeId, info]) => ({
      nodeId,
      node: nodeById.get(nodeId),
      terms: info.normalized_search_terms,
      rank: info.label_rank,
      kind: info.display_kind,
    }))
    .filter((item) => item.node)
    .sort((a, b) => b.rank - a.rank || a.node.label.localeCompare(b.node.label));
}

function findMatches(records, rawTerm, limit = 20) {
  const term = normalize(rawTerm);
  if (!term) return [];
  const scored = [];
  for (const record of records) {
    let score = 0;
    for (const candidate of record.terms) {
      if (candidate === term) score = Math.max(score, 1000);
      else if (candidate.startsWith(term)) score = Math.max(score, 700);
      else if (candidate.includes(term)) score = Math.max(score, 420);
      else {
        const words = term.split(" ");
        if (words.every((word) => candidate.includes(word))) score = Math.max(score, 220);
      }
    }
    if (score) scored.push({ ...record, score: score + record.rank / 10 });
  }
  return scored.sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label)).slice(0, limit);
}

function exactOrBest(records, rawTerm) {
  const matches = findMatches(records, rawTerm, 8);
  if (!matches.length) return { state: "none", matches: [] };
  const normalized = normalize(rawTerm);
  const exact = matches.filter((match) => match.terms.includes(normalized));
  if (exact.length === 1) return { state: "one", match: exact[0], matches };
  if (exact.length > 1) return { state: "ambiguous", matches: exact };
  if (matches.length === 1) return { state: "one", match: matches[0], matches };
  return { state: "ambiguous", matches };
}

function parseCommand(raw) {
  const text = raw.trim();
  const patterns = [
    ["compare", /^compare\s+(.+?)\s+(?:with|and)\s+(.+)$/i],
    ["related", /^related(?:\s+to)?\s+(.+)$/i],
    ["spatial", /^(?:where|known\s+spatial\s+relations\s+for)\s+(.+)$/i],
    ["measure", /^(?:measure|stated\s+measurements\s+involving)\s+(.+)$/i],
    ["find", /^find\s+(.+)$/i],
  ];
  for (const [verb, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { verb, arguments: match.slice(1), raw: text };
  }
  return { verb: "find", arguments: [text], raw: text };
}

function makeCytoscapeElements(graph, queryIndex, layout) {
  const index = queryIndex.node_index;
  const nodes = graph.nodes.map((node) => ({
    group: "nodes",
    data: {
      id: node.node_id,
      label: node.label,
      shownLabel: index[node.node_id].label_rank >= 90 ? node.label : "",
      displayKind: index[node.node_id].display_kind,
      identityStatus: node.identity_status,
      labelRank: index[node.node_id].label_rank,
    },
    position: {
      x: layout.positions[node.node_id].x,
      y: layout.positions[node.node_id].y,
    },
  }));

  const edges = queryIndex.display_edges.map((edge) => {
    const directed =
      edge.relation_family === "flow" ||
      !["NONE", "UNKNOWN", "UNDIRECTED"].includes(edge.traversal_direction);
    const conditional = edge.traversal_effects.some((value) =>
      ["REQUIRES_CONTEXT", "OBSERVATION_ONLY"].includes(value),
    );
    return {
      group: "edges",
      data: {
        id: edge.display_edge_id,
        source: edge.from_node,
        target: edge.to_node,
        relationType: edge.relation_type,
        relationLabel: humanize(edge.relation_type),
        relationFamily: edge.relation_family,
        projections: edge.projections.join("|"),
        directed: directed ? "yes" : "no",
        conditional: conditional ? "yes" : "no",
        polarity: edge.polarity,
      },
      classes: conditional ? "conditional" : "",
    };
  });
  return [...nodes, ...edges];
}

function cytoscapeStyles() {
  return [
    {
      selector: "node",
      style: {
        label: "data(shownLabel)",
        "font-family": "Inter, system-ui, sans-serif",
        "font-size": 11,
        "text-wrap": "wrap",
        "text-max-width": 130,
        "text-valign": "bottom",
        "text-margin-y": 8,
        color: "#273036",
        "text-background-color": "#fffdf7",
        "text-background-opacity": 0.86,
        "text-background-padding": 2,
        width: 20,
        height: 20,
        shape: "ellipse",
        "background-color": "#f8f5ed",
        "border-width": 1.5,
        "border-color": "#68747a",
        "overlay-opacity": 0,
      },
    },
    {
      selector: 'node[displayKind = "place"]',
      style: { shape: "round-rectangle", width: 34, height: 24, "background-color": "#f5efe3", "border-color": "#3f6872" },
    },
    {
      selector: 'node[displayKind = "route"]',
      style: { shape: "round-tag", width: 38, height: 18, "background-color": "#e6edf1", "border-color": "#315f85" },
    },
    {
      selector: 'node[displayKind = "concept"]',
      style: { shape: "ellipse", width: 30, height: 22, "background-color": "#eee8d7", "border-color": "#786b42" },
    },
    {
      selector: 'node[identityStatus = "CANONICAL_ANCHOR"], node[identityStatus = "CANONICAL_HOMONYM_SENSE"]',
      style: { "border-width": 3, "background-color": "#fffaf0", "z-index": 5 },
    },
    {
      selector: 'node[identityStatus = "SOURCE_SCOPED_UNRESOLVED"]',
      style: { width: 20, height: 20, "background-opacity": 0.55, "border-opacity": 0.75 },
    },
    {
      selector: 'node[identityStatus = "SOURCE_SCOPED_GENERIC"]',
      style: { "border-style": "dashed", "background-opacity": 0.22 },
    },
    {
      selector: "edge",
      style: {
        width: 1.2,
        "line-color": "#9b9489",
        "curve-style": "bezier",
        "control-point-step-size": 28,
        opacity: 0.52,
        "target-arrow-shape": "none",
        "target-arrow-color": "#9b9489",
        "arrow-scale": 0.8,
        "overlay-opacity": 0,
      },
    },
    { selector: 'edge[directed = "yes"]', style: { "target-arrow-shape": "triangle" } },
    { selector: "edge.conditional", style: { "line-style": "dashed" } },
    { selector: "edge.context", style: { opacity: 0.12, width: 0.8 } },
    { selector: "edge.emphasis", style: { opacity: 0.92, width: 2.3, "z-index": 7 } },
    { selector: 'edge[relationFamily = "movement"].emphasis', style: { "line-color": "#315f85", "target-arrow-color": "#315f85" } },
    { selector: 'edge[relationFamily = "flow"].emphasis', style: { "line-color": "#4e7451", "target-arrow-color": "#4e7451" } },
    { selector: 'edge[relationFamily = "perception"].emphasis', style: { "line-color": "#735f86", "line-style": "dotted" } },
    { selector: 'edge[relationFamily = "refusal_conflict"].emphasis', style: { "line-color": "#9a3c35", "line-style": "dashed" } },
    { selector: ".hidden", style: { display: "none" } },
    { selector: "node.faded", style: { opacity: 0.13, "text-opacity": 0.18 } },
    { selector: "edge.faded", style: { opacity: 0.04 } },
    { selector: "node.query-match", style: { "border-color": "#d1852f", "border-width": 5, "background-color": "#fff0cc", opacity: 1, "z-index": 20 } },
    { selector: "edge.query-match", style: { "line-color": "#d1852f", "target-arrow-color": "#d1852f", width: 3.2, opacity: 1, "z-index": 18 } },
    { selector: ":selected", style: { "border-color": "#c36c1b", "border-width": 5, "line-color": "#c36c1b", "target-arrow-color": "#c36c1b", opacity: 1 } },
  ];
}

function drawIslandOverlay(cy, layout) {
  const svg = document.getElementById("island-overlay");
  if (!svg) return;
  clear(svg);
  const zoom = cy.zoom();
  if (zoom > 0.78) return;
  const pan = cy.pan();
  const namespace = "http://www.w3.org/2000/svg";
  for (const island of layout.layout_islands) {
    if (island.node_count <= 1) continue;
    const bounds = island.bounds;
    const x = bounds.min_x * zoom + pan.x;
    const y = bounds.min_y * zoom + pan.y;
    const width = (bounds.max_x - bounds.min_x) * zoom;
    const height = (bounds.max_y - bounds.min_y) * zoom;
    if (width < 10 || height < 10) continue;
    const rect = document.createElementNS(namespace, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", width);
    rect.setAttribute("height", height);
    rect.setAttribute("rx", Math.min(18, width / 8));
    rect.setAttribute("class", "island-frame");
    svg.append(rect);
    if (width > 125 && height > 48) {
      const label = document.createElementNS(namespace, "text");
      label.setAttribute("x", x + 8);
      label.setAttribute("y", y + 16);
      label.setAttribute("class", "island-label");
      label.textContent = `${island.description} · ${island.node_count}`;
      svg.append(label);
    }
  }
}

function applyLens(cy, lens) {
  const projections = LENS_PROJECTIONS[lens] ?? LENS_PROJECTIONS.balanced;
  cy.batch(() => {
    cy.edges().forEach((edge) => {
      const edgeProjections = new Set(edge.data("projections").split("|"));
      const matches = [...projections].some((projection) => edgeProjections.has(projection));
      const isSpatialContext = edgeProjections.has("spatial_structure");
      edge.removeClass("hidden context emphasis");
      if (lens === "balanced") {
        if (matches) edge.addClass("emphasis");
        else edge.addClass("hidden");
      } else if (matches) {
        edge.addClass("emphasis");
      } else if (isSpatialContext) {
        edge.addClass("context");
      } else {
        edge.addClass("hidden");
      }
    });
  });
}

function updateLabels(cy, queryIndex) {
  const zoom = cy.zoom();
  cy.batch(() => {
    cy.nodes().forEach((graphNode) => {
      const nodeInfo = queryIndex.node_index[graphNode.id()];
      graphNode.data(
        "shownLabel",
        displayLabel(
          { label: graphNode.data("label") },
          nodeInfo.label_rank,
          zoom,
          graphNode.selected() || graphNode.hasClass("query-match"),
        ),
      );
    });
  });
}

function relationRowsForNode(nodeId, queryIndex, displayEdgeById) {
  const info = queryIndex.node_index[nodeId];
  return (info?.display_edge_ids ?? [])
    .map((id) => displayEdgeById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.relation_type.localeCompare(b.relation_type) || a.display_edge_id.localeCompare(b.display_edge_id));
}

function focusElements(cy, nodeIds, edgeIds = [], fit = true) {
  cy.elements().removeClass("query-match faded");
  if (!nodeIds.length && !edgeIds.length) return;
  const nodes = cy.collection(nodeIds.map((id) => cy.getElementById(id))).filter("node");
  const edges = cy.collection(edgeIds.map((id) => cy.getElementById(id))).filter("edge");
  cy.elements().difference(nodes.union(edges)).addClass("faded");
  nodes.addClass("query-match");
  edges.addClass("query-match");
  if (fit && nodes.length) cy.animate({ fit: { eles: nodes.union(edges), padding: 80 }, duration: 240 });
}

function buildCapabilityPanel(capabilities) {
  const target = document.getElementById("capability-list");
  clear(target);
  for (const [queryId, capability] of Object.entries(capabilities.queries)) {
    if (capability.state === "AVAILABLE") continue;
    const item = element("details", {}, [
      element("summary", { text: `${humanize(queryId)} — ${capability.state}` }),
      element("p", { text: capability.note }),
    ]);
    target.append(item);
  }
}

function buildStats(capabilities, graph) {
  const target = document.getElementById("stats");
  const counts = capabilities.counts;
  const unresolved = graph.nodes.filter((node) => node.identity_status === "SOURCE_SCOPED_UNRESOLVED").length;
  clear(target);
  for (const [value, label] of [
    [counts.nodes, "things"],
    [counts.layout_islands, "layout islands"],
    [counts.layout_singletons, "singletons"],
    [unresolved, "source-scoped"],
  ]) {
    target.append(element("div", { class: "stat" }, [element("strong", { text: value }), element("span", { text: label })]));
  }
}

function buildLenses(capabilities, state, setLens) {
  const target = document.getElementById("lens-list");
  clear(target);
  for (const [lens, capability] of Object.entries(capabilities.lenses)) {
    const button = element("button", {
      class: `lens-button ${lens === state.lens ? "active" : ""}`,
      type: "button",
      disabled: capability.state !== "AVAILABLE",
      title: capability.state === "AVAILABLE" ? LENS_LABELS[lens] : "Unavailable in this governed build",
    }, [
      element("span", { text: LENS_LABELS[lens] ?? humanize(lens) }),
      element("span", { class: "count", text: capability.state === "AVAILABLE" ? "on" : "—" }),
    ]);
    button.addEventListener("click", () => setLens(lens));
    target.append(button);
  }
}

function relationButton(edge, selectedNodeId, nodeById, onSelect) {
  const otherId = edge.from_node === selectedNodeId ? edge.to_node : edge.from_node;
  const other = nodeById.get(otherId);
  const button = element("button", { class: "relation-button", type: "button" }, [
    element("strong", { text: `${humanize(edge.relation_type)} — ${other?.label ?? otherId}` }),
    element("span", { text: `${edge.projections.join(", ")} · ${edge.assertion_id}` }),
  ]);
  button.addEventListener("click", () => onSelect(edge.display_edge_id));
  return button;
}

function assertionSummary(assertion, nodeById) {
  const block = element("div", {}, [
    element("div", { class: "chip-row" }, [
      statusChip(assertion.relation_type),
      statusChip(assertion.authority_state),
      statusChip(assertion.candidacy_level),
      statusChip(assertion.polarity),
    ]),
    element("p", { text: assertion.participants.map((item) => participantLabel(item, nodeById)).join(" · ") }),
  ]);
  if (assertion.conditions_as_stated) {
    block.append(element("p", {}, [element("strong", { text: "Condition: " }), assertion.conditions_as_stated]));
  }
  for (const quantity of assertion.quantities_as_stated ?? []) {
    block.append(element("p", {}, [
      element("strong", { text: `${humanize(quantity.quantity_kind)}: ` }),
      quantity.value_verbatim,
    ]));
  }
  return block;
}

function installMobileTabs() {
  const buttons = [...document.querySelectorAll("[data-mobile-target]")];
  const views = [...document.querySelectorAll(".mobile-view")];
  const activate = (targetId) => {
    for (const view of views) view.classList.toggle("mobile-active", view.id === targetId);
    for (const button of buttons) button.classList.toggle("active", button.dataset.mobileTarget === targetId);
  };
  for (const button of buttons) button.addEventListener("click", () => activate(button.dataset.mobileTarget));
  activate("world-view");
  return activate;
}

function renderSearchResults(target, matches, onChoose) {
  clear(target);
  for (const match of matches) {
    const button = element("button", { class: "search-result", type: "button" }, [
      element("strong", { text: match.node.label }),
      element("span", { text: `${humanize(match.kind)} · ${humanize(match.node.identity_status)}` }),
    ]);
    button.addEventListener("click", () => onChoose(match));
    target.append(button);
  }
}

function saveUrlState(state, cy, graph, extra = {}) {
  const url = new URL(location.href);
  if (state.focusNode) url.searchParams.set("focus", state.focusNode);
  else url.searchParams.delete("focus");
  url.searchParams.set("lens", state.lens);
  url.searchParams.set("profile", graph.authority_profile);
  url.searchParams.set("build", graph.semantic_digest);
  if (cy) {
    const pan = cy.pan();
    url.searchParams.set("z", cy.zoom().toFixed(4));
    url.searchParams.set("px", pan.x.toFixed(2));
    url.searchParams.set("py", pan.y.toFixed(2));
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

export async function startExplorer({ mode, renderModeExtras }) {
  const [graph, queryIndex, capabilities, measurementIndex, layout, manifest] = await Promise.all([
    fetchJson(GRAPH_URL),
    fetchJson(QUERY_URL),
    fetchJson(CAPABILITIES_URL),
    fetchJson(MEASUREMENTS_URL),
    fetchJson(LAYOUT_URL),
    fetchJson(MANIFEST_URL),
  ]);

  if (graph.semantic_digest !== queryIndex.semantic_digest || graph.semantic_digest !== layout.semantic_digest) {
    throw new Error("semantic digest mismatch among graph, query index and layout");
  }
  if (manifest.publication_policy !== "PUBLIC_CLEAN_PRIVATE_DEBUG") {
    throw new Error(`unexpected publication policy: ${manifest.publication_policy}`);
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const assertionById = new Map(graph.assertions.map((assertion) => [assertion.assertion_id, assertion]));
  const displayEdgeById = new Map(queryIndex.display_edges.map((edge) => [edge.display_edge_id, edge]));
  const searchRecords = buildSearchRecords(graph, queryIndex);
  const measurementsByNode = new Map();
  for (const measurement of measurementIndex.measurements) {
    for (const nodeId of measurement.participant_node_ids) {
      if (!measurementsByNode.has(nodeId)) measurementsByNode.set(nodeId, []);
      measurementsByNode.get(nodeId).push(measurement);
    }
  }

  const params = new URLSearchParams(location.search);
  const requestedBuild = params.get("build");
  const requestedLens = params.get("lens");
  const state = {
    lens: capabilities.lenses[requestedLens]?.state === "AVAILABLE" ? requestedLens : "balanced",
    focusNode: null,
    focusEdge: null,
  };

  buildStats(capabilities, graph);
  buildCapabilityPanel(capabilities);
  document.getElementById("build-id").textContent = `semantic ${formatDigest(graph.semantic_digest)} · layout ${formatDigest(layout.layout_id)}`;
  if (requestedBuild && requestedBuild !== graph.semantic_digest) {
    const warning = document.getElementById("build-warning");
    warning.hidden = false;
    warning.textContent = `This link was saved against ${formatDigest(requestedBuild)}; it is being replayed on ${formatDigest(graph.semantic_digest)}.`;
  }

  const elements = makeCytoscapeElements(graph, queryIndex, layout);
  const cy = window.cytoscape({
    container: document.getElementById("cy"),
    elements,
    style: cytoscapeStyles(),
    layout: { name: "preset", fit: true, padding: 72, animate: false },
    autoungrabify: true,
    userPanningEnabled: true,
    userZoomingEnabled: true,
    boxSelectionEnabled: false,
    minZoom: 0.08,
    maxZoom: 4.5,
    wheelSensitivity: 0.22,
  });

  const answerTarget = document.getElementById("answer-content");
  const detailsTarget = document.getElementById("details-content");
  const activateMobile = installMobileTabs();

  function setLens(lens) {
    if (capabilities.lenses[lens]?.state !== "AVAILABLE") return;
    state.lens = lens;
    applyLens(cy, lens);
    buildLenses(capabilities, state, setLens);
    saveUrlState(state, cy, graph);
    setStatus(`${LENS_LABELS[lens]} lens active. Layout positions unchanged.`);
  }

  function renderNodeDetails(nodeId) {
    const node = nodeById.get(nodeId);
    const info = queryIndex.node_index[nodeId];
    const relations = relationRowsForNode(nodeId, queryIndex, displayEdgeById);
    clear(detailsTarget);
    detailsTarget.append(
      element("h2", { class: "entity-title", text: node.label }),
      element("p", { class: "entity-kind", text: `${humanize(info.display_kind)} · ${humanize(node.identity_status)}` }),
      element("div", { class: "chip-row" }, [
        ...node.authority_states.map(statusChip),
        ...node.candidacy_levels.map(statusChip),
      ]),
    );
    const stateCard = element("div", { class: "status-card" }, [
      element("strong", { text: "Topology state" }),
      element("div", { text: `Placement: ${humanize(node.knowledge_profile.placement_policy)}` }),
      element("div", { text: node.plane_memberships.length ? `Planes: ${node.plane_memberships.join(", ")}` : "Plane membership: not governed in this build" }),
      element("div", { text: node.physical_strata.length ? `Physical strata: ${node.physical_strata.join(", ")}` : "Physical strata: not governed in this build" }),
    ]);
    detailsTarget.append(stateCard);
    const focusControls = element("div", { class: "chip-row" }, [
      element("button", { class: "quiet-button", type: "button", text: "Focus 1 hop" }),
      element("button", { class: "quiet-button", type: "button", text: "Focus 2 hops" }),
      element("button", { class: "quiet-button", type: "button", text: "Show layout island" }),
    ]);
    focusControls.children[0].addEventListener("click", () => focusNeighborhood(nodeId, 1));
    focusControls.children[1].addEventListener("click", () => focusNeighborhood(nodeId, 2));
    focusControls.children[2].addEventListener("click", () => focusLayoutIsland(nodeId));
    detailsTarget.append(focusControls);
    if (node.layers.length || node.facets.length) {
      detailsTarget.append(element("h3", { text: "Classification" }));
      detailsTarget.append(element("div", { class: "chip-row" }, [...node.layers.map(statusChip), ...node.facets.map(statusChip)]));
    }
    detailsTarget.append(element("h3", { text: `Known incident assertions (${relations.length})` }));
    const list = element("div", { class: "relation-list" });
    for (const edge of relations) list.append(relationButton(edge, nodeId, nodeById, selectEdge));
    detailsTarget.append(list);
    if (!relations.length) detailsTarget.append(element("p", { class: "muted", text: "No governed incident relation in this build." }));
    if (renderModeExtras) renderModeExtras({ target: detailsTarget, selection: { type: "node", node, info, relations }, graph, queryIndex, assertionById, nodeById, helpers: { element, clear, humanize, assertionSummary } });
  }

  function renderEdgeDetails(edgeId) {
    const edge = displayEdgeById.get(edgeId);
    const assertion = assertionById.get(edge.assertion_id);
    clear(detailsTarget);
    detailsTarget.append(
      element("h2", { class: "entity-title", text: humanize(edge.relation_type) }),
      element("p", { class: "entity-kind", text: `${nodeById.get(edge.from_node)?.label ?? edge.from_node} — ${nodeById.get(edge.to_node)?.label ?? edge.to_node}` }),
      assertionSummary(assertion, nodeById),
      element("h3", { text: "Projection behavior" }),
      element("div", { class: "chip-row" }, edge.projections.map(statusChip)),
      element("p", { class: "muted", text: `Display grouping retains ${edge.projection_edge_ids.length} projection edge ID(s).` }),
    );
    if (renderModeExtras) renderModeExtras({ target: detailsTarget, selection: { type: "edge", edge, assertion }, graph, queryIndex, assertionById, nodeById, helpers: { element, clear, humanize, assertionSummary } });
  }

  function selectNode(nodeId, fit = true) {
    if (!nodeById.has(nodeId)) return;
    state.focusNode = nodeId;
    state.focusEdge = null;
    cy.elements().unselect();
    const graphNode = cy.getElementById(nodeId);
    graphNode.select();
    focusElements(cy, [nodeId], [], false);
    if (fit) cy.animate({ center: { eles: graphNode }, zoom: Math.max(cy.zoom(), 1.05), duration: 220 });
    renderNodeDetails(nodeId);
    updateLabels(cy, queryIndex);
    saveUrlState(state, cy, graph);
    setStatus(`${nodeById.get(nodeId).label} selected.`);
  }

  function selectEdge(edgeId) {
    const edge = displayEdgeById.get(edgeId);
    if (!edge) return;
    state.focusEdge = edgeId;
    cy.elements().unselect();
    const graphEdge = cy.getElementById(edgeId);
    graphEdge.select();
    focusElements(cy, [edge.from_node, edge.to_node], [edgeId], true);
    renderEdgeDetails(edgeId);
    updateLabels(cy, queryIndex);
    saveUrlState(state, cy, graph, { edge: edgeId });
    activateMobile("details-view");
    setStatus(`${humanize(edge.relation_type)} assertion selected.`);
  }

  function focusNeighborhood(startNodeId, hops) {
    const visited = new Set([startNodeId]);
    let frontier = new Set([startNodeId]);
    const edgeIds = new Set();
    for (let depth = 0; depth < hops; depth += 1) {
      const next = new Set();
      for (const nodeId of frontier) {
        for (const edge of relationRowsForNode(nodeId, queryIndex, displayEdgeById)) {
          edgeIds.add(edge.display_edge_id);
          const other = edge.from_node === nodeId ? edge.to_node : edge.from_node;
          if (!visited.has(other)) {
            visited.add(other);
            next.add(other);
          }
        }
      }
      frontier = next;
    }
    focusElements(cy, [...visited], [...edgeIds], true);
    updateLabels(cy, queryIndex);
    setStatus(`${hops}-hop governed neighborhood: ${visited.size} nodes, ${edgeIds.size} display edges.`);
  }

  function focusLayoutIsland(nodeId) {
    const islandId = queryIndex.node_index[nodeId].layout_island_id;
    const island = queryIndex.layout_islands.find((item) => item.layout_island_id === islandId);
    if (!island) return;
    const memberSet = new Set(island.member_node_ids);
    const edgeIds = queryIndex.display_edges
      .filter((edge) => memberSet.has(edge.from_node) && memberSet.has(edge.to_node) && edge.projections.includes("spatial_structure"))
      .map((edge) => edge.display_edge_id);
    focusElements(cy, island.member_node_ids, edgeIds, true);
    updateLabels(cy, queryIndex);
    setStatus(`${island.description}: ${island.node_count} nodes.`);
  }

  function answerHeader(title, plan, support, coverage) {
    clear(answerTarget);
    answerTarget.append(
      element("h2", { text: title }),
      element("div", { class: "chip-row" }, plan.map((chip) => element("span", { class: "chip", text: chip }))),
      supportCoverage(support, coverage),
    );
  }

  function resolveOrList(rawTerm, continuation) {
    const result = exactOrBest(searchRecords, rawTerm);
    if (result.state === "one") return continuation(result.match);
    answerHeader(`Resolve “${rawTerm}”`, ["entity resolution"], "partial evidence", "unknown");
    if (result.state === "none") {
      answerTarget.append(element("p", { text: "No governed identity or name use matches this term." }));
      return;
    }
    answerTarget.append(element("p", { text: "Choose the intended governed identity; matching names are not merged automatically." }));
    const list = element("div", { class: "result-list" });
    for (const match of result.matches) {
      const button = element("button", { class: "result-button", type: "button" }, [
        element("strong", { text: match.node.label }),
        element("span", { text: `${match.node.node_id} · ${humanize(match.node.identity_status)}` }),
      ]);
      button.addEventListener("click", () => continuation(match));
      list.append(button);
    }
    answerTarget.append(list);
  }

  function answerFind(term) {
    const matches = findMatches(searchRecords, term, 30);
    answerHeader(`Find “${term}”`, ["find", term], matches.length ? "directly stated" : "unsupported", "open world known matches");
    const list = element("div", { class: "result-list" });
    for (const match of matches) {
      const button = element("button", { class: "result-button", type: "button" }, [
        element("strong", { text: match.node.label }),
        element("span", { text: `${humanize(match.kind)} · ${humanize(match.node.identity_status)}` }),
      ]);
      button.addEventListener("click", () => { selectNode(match.nodeId); activateMobile("details-view"); });
      list.append(button);
    }
    answerTarget.append(list);
    if (!matches.length) answerTarget.append(element("p", { text: "No governed identity or name use matches this term." }));
    focusElements(cy, matches.map((match) => match.nodeId), [], true);
  }

  function answerRelated(match, spatialOnly = false) {
    const relations = relationRowsForNode(match.nodeId, queryIndex, displayEdgeById).filter((edge) => !spatialOnly || edge.projections.includes("spatial_structure"));
    const title = spatialOnly ? `Known spatial relations for ${match.node.label}` : `Known relations for ${match.node.label}`;
    answerHeader(title, [spatialOnly ? "known spatial relations" : "related", match.node.label], "governed derivation", "open world known matches");
    answerTarget.append(element("p", { text: spatialOnly ? "These are governed spatial/topological assertions in this build; they are not an exhaustive location." : "These are governed incident assertions in this build, grouped only when one assertion appears in several projections." }));
    const table = element("table", { class: "answer-table" });
    table.append(element("thead", {}, element("tr", {}, [element("th", { text: "Relation" }), element("th", { text: "Other entity" }), element("th", { text: "Projection" })])));
    const body = element("tbody");
    const nodeIds = new Set([match.nodeId]);
    const edgeIds = [];
    for (const edge of relations) {
      const otherId = edge.from_node === match.nodeId ? edge.to_node : edge.from_node;
      nodeIds.add(otherId);
      edgeIds.push(edge.display_edge_id);
      const row = element("tr", {}, [
        element("td", {}, element("button", { class: "quiet-button", type: "button", text: humanize(edge.relation_type) })),
        element("td", { text: nodeById.get(otherId)?.label ?? otherId }),
        element("td", { text: edge.projections.join(", ") }),
      ]);
      row.querySelector("button").addEventListener("click", () => selectEdge(edge.display_edge_id));
      body.append(row);
    }
    table.append(body);
    answerTarget.append(table);
    if (!relations.length) answerTarget.append(element("p", { text: "No governed matching relation exists in this build." }));
    focusElements(cy, [...nodeIds], edgeIds, true);
    state.focusNode = match.nodeId;
  }

  function answerMeasure(match) {
    const measurements = measurementsByNode.get(match.nodeId) ?? [];
    answerHeader(`Stated measurements involving ${match.node.label}`, ["stated measurements", match.node.label], measurements.length ? "directly stated" : "unsupported", "open world known matches");
    answerTarget.append(element("div", { class: "status-card warning" }, [
      element("strong", { text: "No aggregation" }),
      element("div", { text: "Values may describe different domains, routes, episodes or directions. This build supplies no additivity certificate." }),
    ]));
    const table = element("table", { class: "answer-table" });
    table.append(element("thead", {}, element("tr", {}, [element("th", { text: "Kind" }), element("th", { text: "Value as stated" }), element("th", { text: "Relation" })])));
    const body = element("tbody");
    for (const measurement of measurements) {
      body.append(element("tr", {}, [
        element("td", { text: humanize(measurement.quantity_kind) }),
        element("td", { text: measurement.value_verbatim }),
        element("td", { text: humanize(measurement.relation_type) }),
      ]));
    }
    table.append(body);
    answerTarget.append(table);
    if (!measurements.length) answerTarget.append(element("p", { text: "No governed verbatim measurement involving this identity exists in this build." }));
    focusElements(cy, [match.nodeId], [], true);
    state.focusNode = match.nodeId;
  }

  function answerCompare(left, right) {
    answerHeader(`Compare ${left.node.label} with ${right.node.label}`, ["compare", left.node.label, right.node.label], "governed derivation", "open world known matches");
    const table = element("table", { class: "answer-table" });
    const leftInfo = queryIndex.node_index[left.nodeId];
    const rightInfo = queryIndex.node_index[right.nodeId];
    const rows = [
      ["Identity", humanize(left.node.identity_status), humanize(right.node.identity_status)],
      ["Display kind", humanize(leftInfo.display_kind), humanize(rightInfo.display_kind)],
      ["Layers", left.node.layers.join(", ") || "none governed", right.node.layers.join(", ") || "none governed"],
      ["Plane", left.node.plane_memberships.join(", ") || "not governed", right.node.plane_memberships.join(", ") || "not governed"],
      ["Incident assertions", leftInfo.assertion_ids.length, rightInfo.assertion_ids.length],
      ["Layout island", leftInfo.layout_island_id, rightInfo.layout_island_id],
    ];
    table.append(element("thead", {}, element("tr", {}, [element("th", { text: "Field" }), element("th", { text: left.node.label }), element("th", { text: right.node.label })])));
    const body = element("tbody");
    for (const row of rows) body.append(element("tr", {}, row.map((value) => element("td", { text: value }))));
    table.append(body);
    answerTarget.append(table, element("p", { class: "muted", text: "Counts describe governed records in this build, not world importance or exhaustive knowledge." }));
    focusElements(cy, [left.nodeId, right.nodeId], [], true);
  }

  function executeCommand(raw) {
    const command = parseCommand(raw);
    if (!command.arguments[0]) return;
    activateMobile("answer-view");
    if (command.verb === "find") answerFind(command.arguments[0]);
    else if (command.verb === "related") resolveOrList(command.arguments[0], (match) => answerRelated(match, false));
    else if (command.verb === "spatial") resolveOrList(command.arguments[0], (match) => answerRelated(match, true));
    else if (command.verb === "measure") resolveOrList(command.arguments[0], answerMeasure);
    else if (command.verb === "compare") {
      resolveOrList(command.arguments[0], (left) => resolveOrList(command.arguments[1], (right) => answerCompare(left, right)));
    }
    saveUrlState(state, cy, graph, { q: raw });
    setStatus(`Query executed: ${raw}`);
  }

  const form = document.getElementById("command-form");
  const input = document.getElementById("command-input");
  const searchTarget = document.getElementById("search-results");
  input.addEventListener("input", () => {
    const parsed = parseCommand(input.value);
    const term = parsed.arguments.at(-1) ?? input.value;
    renderSearchResults(searchTarget, findMatches(searchRecords, term, 10), (match) => {
      input.value = `find ${match.node.label}`;
      clear(searchTarget);
      selectNode(match.nodeId);
    });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clear(searchTarget);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clear(searchTarget);
    executeCommand(input.value);
  });
  document.addEventListener("click", (event) => {
    if (!form.contains(event.target)) clear(searchTarget);
  });

  cy.on("tap", "node", (event) => { selectNode(event.target.id(), false); activateMobile("details-view"); });
  cy.on("tap", "edge", (event) => selectEdge(event.target.id()));
  cy.on("zoom", () => { updateLabels(cy, queryIndex); drawIslandOverlay(cy, layout); });
  cy.on("pan resize", () => drawIslandOverlay(cy, layout));
  cy.on("select unselect", "node", () => updateLabels(cy, queryIndex));

  document.getElementById("fit-button").addEventListener("click", () => cy.animate({ fit: { eles: cy.elements(":visible"), padding: 64 }, duration: 220 }));
  document.getElementById("reset-focus-button").addEventListener("click", () => {
    state.focusNode = null;
    state.focusEdge = null;
    cy.elements().removeClass("query-match faded").unselect();
    clear(detailsTarget);
    detailsTarget.append(element("h2", { text: "Inspect Immensa" }), element("p", { text: "Search or select a node. Every incident assertion will be available here as ordinary HTML." }));
    updateLabels(cy, queryIndex);
    saveUrlState(state, cy, graph, { edge: "" });
  });

  buildLenses(capabilities, state, setLens);
  setLens(state.lens);
  answerHeader("Ask the governed topology", ["active working", "deterministic"], "directly stated", "open world known matches");
  answerTarget.append(
    element("p", { text: "Try “find Harlowe”, “related to Neris”, “where Fivedoor”, “measure Belloway”, or “compare Neris with Ossaray”." }),
    element("p", { class: "muted", text: "Ecology, strata, governance, general route-finding and time controls remain unavailable until governed prerequisites exist." }),
  );
  cy.ready(() => {
    const requestedFocus = params.get("focus");
    const requestedQuery = params.get("q");
    const z = Number(params.get("z"));
    const px = Number(params.get("px"));
    const py = Number(params.get("py"));
    if (Number.isFinite(z) && Number.isFinite(px) && Number.isFinite(py)) {
      cy.viewport({ zoom: z, pan: { x: px, y: py } });
    }
    if (requestedFocus && nodeById.has(requestedFocus)) selectNode(requestedFocus, true);
    if (requestedQuery) {
      input.value = requestedQuery;
      executeCommand(requestedQuery);
    }
    updateLabels(cy, queryIndex);
    drawIslandOverlay(cy, layout);
    document.body.dataset.ready = "true";
    document.body.dataset.nodeCount = String(cy.nodes().length);
    document.body.dataset.edgeCount = String(cy.edges().length);
    document.body.dataset.layoutId = layout.layout_id;
    document.body.dataset.positionParity = String(
      cy.nodes().every((node) => {
        const expected = layout.positions[node.id()];
        const actual = node.position();
        return expected && Math.abs(expected.x - actual.x) < 0.0001 && Math.abs(expected.y - actual.y) < 0.0001;
      }),
    );
    window.__IMMENSA_EXPLORER_READY__ = {
      mode,
      nodeCount: cy.nodes().length,
      edgeCount: cy.edges().length,
      semanticDigest: graph.semantic_digest,
      layoutId: layout.layout_id,
      positions: Object.fromEntries(cy.nodes().map((node) => [node.id(), node.position()])),
    };
    setStatus(`Explorer ready: ${cy.nodes().length} nodes and ${layout.layout_islands.length} layout islands.`);
  });

  return { cy, graph, queryIndex, capabilities, measurementIndex, layout, manifest };
}

export { element, clear, humanize, assertionSummary };
