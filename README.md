# Immensa Chronicles — Public Renderings

This repository is the public publication target for generated Immensa artifacts and the GitHub Pages home for Immensa's browser-facing maps, graphs, explorers and tools.

The authoritative source corpus, evidence, build tooling and homepage generator live in the private `yzm1/immensa` repository. Files published here are generated outputs intended for browser viewing; they should not be maintained independently by hand.

GitHub Pages serves this repository directly from the `main` branch root. Rendering happens only in the private repository's tag-triggered CI; this public repository does not need its own Actions deployment workflow.

## Root navigation hub

`index.html` is the durable entry point for the published Immensa toolset. The private publisher regenerates it after every release by discovering every top-level component directory that contains an `index.html`.

A component's optional `build.json` fields can control how it appears in the hub:

- `title`
- `description`
- `category` and `category_label`
- `featured`
- `status`

Components without presentation metadata still appear automatically, so adding a new renderer does not require maintaining a second hard-coded navigation list.

## Publication convention

- `interactive-graph-v*` — rebuild and publish the current knowledge/topology explorer family.
- `all-v*` — rebuild and publish every registered public renderer.
- Future renderer-specific tags follow the same `<renderer>-v*` convention.

A renderer-specific publication replaces only that renderer's directory, leaving other published components intact. The root site index and `build.json` are regenerated from the complete assembled site so navigation always reflects everything currently available.
