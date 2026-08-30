# Immensa Chronicles — Public Renderings

This repository is the public publication target for generated Immensa artifacts.

The authoritative source corpus, evidence, and build tooling live in the private `yzm1/immensa` repository. Files published here are generated outputs intended for browser viewing; they should not be edited by hand.

GitHub Pages serves this repository directly from the `main` branch root. Rendering happens only in the private repository's tag-triggered CI; this public repository does not need its own Actions deployment workflow.

## Publication convention

- `interactive-graph-v*` — rebuild and publish the interactive topology graph.
- `all-v*` — rebuild and publish every registered public renderer.
- Future renderer-specific tags follow the same `<renderer>-v*` convention.

The root site index records the release label and source commit for each published component. A renderer-specific publication replaces only that renderer's directory, leaving other published components intact.
