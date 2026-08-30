export function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replaceAll("’", "'")
    .replace(/[^\p{L}\p{N}_'\-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildSearchRecords(graph, queryIndex) {
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

export function findMatches(records, rawTerm, limit = 20) {
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
  return scored
    .sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
    .slice(0, limit);
}

export function exactOrBest(records, rawTerm) {
  const matches = findMatches(records, rawTerm, 8);
  if (!matches.length) return { state: "none", matches: [] };
  const normalized = normalize(rawTerm);
  const exact = matches.filter((match) => match.terms.includes(normalized));
  if (exact.length === 1) return { state: "one", match: exact[0], matches };
  if (exact.length > 1) return { state: "ambiguous", matches: exact };
  if (matches.length === 1) return { state: "one", match: matches[0], matches };
  return { state: "ambiguous", matches };
}

function stripArticle(value) {
  return String(value ?? "").replace(/^(?:(?:all\s+)?the|a|an)\s+/i, "").trim();
}

export function parseCommand(raw, options = {}) {
  const text = raw.trim();
  if (options.guided) {
    const guided = [
      ["migration_distance", /^how\s+far\s+(?:does|do)\s+(.+?)\s+migrat(?:e|es|ed|ing)\b/i],
      ["habitat_trait", /^where\s+(?:do|does)\s+(.+?)\s+(?:live|occur|range)\b/i],
      ["habitat_trait", /^where\s+(?:all\s+)?(.+?)\s+(?:live|occur)\b/i],
    ];
    for (const [verb, pattern] of guided) {
      const match = text.match(pattern);
      if (match) return { verb, arguments: [stripArticle(match[1])], raw: text, parser: "guided intent" };
    }
  }
  const patterns = [
    ["compare", /^compare\s+(.+?)\s+(?:with|and)\s+(.+)$/i],
    ["related", /^related(?:\s+to)?\s+(.+)$/i],
    ["spatial", /^(?:where|known\s+spatial\s+relations\s+for)\s+(.+)$/i],
    ["measure", /^(?:measure|stated\s+measurements\s+involving)\s+(.+)$/i],
    ["find", /^find\s+(.+)$/i],
  ];
  for (const [verb, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) return { verb, arguments: match.slice(1), raw: text, parser: "semantic command" };
  }
  return { verb: "find", arguments: [text], raw: text, parser: "entity search" };
}

export function relationRowsForNode(nodeId, queryIndex, displayEdgeById) {
  const info = queryIndex.node_index[nodeId];
  return (info?.display_edge_ids ?? [])
    .map((id) => displayEdgeById.get(id))
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.relation_type.localeCompare(b.relation_type) ||
        a.display_edge_id.localeCompare(b.display_edge_id),
    );
}

export function createQueryContext(graph, queryIndex, measurementIndex, capabilities) {
  const nodeById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const assertionById = new Map(
    graph.assertions.map((assertion) => [assertion.assertion_id, assertion]),
  );
  const displayEdgeById = new Map(
    queryIndex.display_edges.map((edge) => [edge.display_edge_id, edge]),
  );
  const searchRecords = buildSearchRecords(graph, queryIndex);
  const measurementsByNode = new Map();
  for (const measurement of measurementIndex.measurements) {
    for (const nodeId of measurement.participant_node_ids) {
      if (!measurementsByNode.has(nodeId)) measurementsByNode.set(nodeId, []);
      measurementsByNode.get(nodeId).push(measurement);
    }
  }
  return {
    graph,
    queryIndex,
    measurementIndex,
    capabilities,
    nodeById,
    assertionById,
    displayEdgeById,
    searchRecords,
    measurementsByNode,
  };
}

function basePlan(command, graph) {
  return {
    query_id: command.verb,
    semantic_digest: graph.semantic_digest,
    authority_profile: graph.authority_profile,
    parsed_intent: command.verb,
    parsed_terms: command.arguments,
    parser: command.parser,
    result_shape: "NO_STRUCTURAL_RESULT",
    support_status: "UNSUPPORTED",
    coverage_status: "UNKNOWN",
    capability_state: "UNAVAILABLE",
    missing_prerequisites: [],
    matching_assertion_ids: [],
  };
}

function resolveForPlan(term, context) {
  return exactOrBest(context.searchRecords, term);
}

function resolutionPlan(plan, term, resolution) {
  return {
    ...plan,
    result_shape: "ENTITY_RESOLUTION",
    support_status: resolution.state === "none" ? "UNSUPPORTED" : "PARTIAL_EVIDENCE",
    capability_state: "DEGRADED",
    summary:
      resolution.state === "none"
        ? `No governed identity or name use matches “${term}”.`
        : `Choose the intended governed identity for “${term}”.`,
    resolution_state: resolution.state,
    matches: resolution.matches,
  };
}

export function planSemanticQuery(raw, context) {
  const command = parseCommand(raw, { guided: true });
  const plan = basePlan(command, context.graph);
  const firstTerm = command.arguments[0] ?? "";

  if (command.verb === "habitat_trait") {
    const resolution = resolveForPlan(firstTerm, context);
    const capability = context.capabilities.queries.ecology_range;
    const missing = [...(capability?.missing ?? ["HAS_RANGE or OCCURS_AT instances"])];
    if (resolution.state === "none") missing.unshift("governed taxon/people identity and trait assertion");
    return {
      ...plan,
      query_id: "ecology_range",
      result_shape: "CAPABILITY_GAP",
      support_status: "UNSUPPORTED",
      coverage_status: "UNKNOWN",
      capability_state: "UNAVAILABLE",
      missing_prerequisites: [...new Set(missing)],
      summary: "No governed habitat answer can be produced from this build.",
      explanation:
        "The viewer will not turn descriptive words into a biological trait or prose mentions into an exhaustive range.",
      resolution_state: resolution.state,
      matches: resolution.matches,
    };
  }

  if (command.verb === "migration_distance") {
    const resolution = resolveForPlan(firstTerm, context);
    const capability = context.capabilities.queries.migration_process;
    const missing = [...(capability?.missing ?? ["MIGRATES and ordered process instances"])];
    if (resolution.state === "none") missing.unshift("governed subject identity");
    missing.push("compatible non-overlapping distance legs and additivity certificate");
    return {
      ...plan,
      query_id: "migration_distance",
      result_shape: "CAPABILITY_GAP",
      support_status: "UNSUPPORTED",
      coverage_status: "INCOMPLETE_SEQUENCE",
      capability_state: "UNAVAILABLE",
      missing_prerequisites: [...new Set(missing)],
      calculation_status: "NOT_RECOVERABLE",
      summary: "Lifetime migration distance is NOT RECOVERABLE from this build.",
      explanation:
        "Topology, range extent, travel time and unrelated distances cannot substitute for an ordered lifecycle with certified additive legs.",
      resolution_state: resolution.state,
      matches: resolution.matches,
    };
  }

  if (command.verb === "find") {
    const matches = findMatches(context.searchRecords, firstTerm, 40);
    return {
      ...plan,
      result_shape: "ENTITY_SET",
      support_status: matches.length ? "DIRECTLY_STATED" : "UNSUPPORTED",
      coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
      capability_state: "AVAILABLE",
      summary: matches.length
        ? `${matches.length} governed identity record${matches.length === 1 ? "" : "s"} match “${firstTerm}” in this build.`
        : `No governed identity or name use matches “${firstTerm}”.`,
      matches,
    };
  }

  if (command.verb === "compare") {
    const left = resolveForPlan(command.arguments[0], context);
    if (left.state !== "one") return resolutionPlan(plan, command.arguments[0], left);
    const right = resolveForPlan(command.arguments[1], context);
    if (right.state !== "one") return resolutionPlan(plan, command.arguments[1], right);
    return {
      ...plan,
      result_shape: "COMPARISON",
      support_status: "GOVERNED_DERIVATION",
      coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
      capability_state: "AVAILABLE",
      summary: `Governed-record comparison of ${left.match.node.label} and ${right.match.node.label}.`,
      entities: [left.match, right.match],
    };
  }

  const resolution = resolveForPlan(firstTerm, context);
  if (resolution.state !== "one") return resolutionPlan(plan, firstTerm, resolution);
  const match = resolution.match;

  if (command.verb === "measure") {
    const measurements = context.measurementsByNode.get(match.nodeId) ?? [];
    return {
      ...plan,
      result_shape: "MEASUREMENT_LEDGER",
      support_status: measurements.length ? "DIRECTLY_STATED" : "UNSUPPORTED",
      coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
      capability_state: "AVAILABLE",
      calculation_status: "KNOWN_VALUES_NOT_SAFELY_ADDITIVE",
      summary: measurements.length
        ? `${measurements.length} stated measurement record${measurements.length === 1 ? "" : "s"} involve ${match.node.label}; no aggregation is certified.`
        : `No governed verbatim measurement involving ${match.node.label} exists in this build.`,
      entity: match,
      measurements,
      matching_assertion_ids: measurements.map((item) => item.assertion_id),
    };
  }

  const spatialOnly = command.verb === "spatial";
  const relations = relationRowsForNode(
    match.nodeId,
    context.queryIndex,
    context.displayEdgeById,
  ).filter((edge) => !spatialOnly || edge.projections.includes("spatial_structure"));
  return {
    ...plan,
    result_shape: "RELATION_BANDS",
    support_status: relations.length ? "GOVERNED_DERIVATION" : "UNSUPPORTED",
    coverage_status: "OPEN_WORLD_KNOWN_MATCHES",
    capability_state: "AVAILABLE",
    summary: spatialOnly
      ? `${relations.length} known governed spatial relation${relations.length === 1 ? "" : "s"} involve ${match.node.label}; this is not an exhaustive location.`
      : `${relations.length} known governed relation${relations.length === 1 ? "" : "s"} involve ${match.node.label}.`,
    entity: match,
    relations,
    matching_assertion_ids: relations.map((item) => item.assertion_id),
    spatial_only: spatialOnly,
  };
}
