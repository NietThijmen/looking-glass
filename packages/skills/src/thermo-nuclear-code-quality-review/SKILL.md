---
name: thermo-nuclear-code-quality-review
description: Run an extremely strict maintainability review for abstraction quality, giant files, and spaghetti-condition growth. Use for a thermo-nuclear code quality review, thermonuclear review, deep code quality audit, or especially harsh maintainability review.
disable-model-invocation: true
---

# Thermo-Nuclear Code Quality Review

Review the current branch for maintainability. Keep the behavior. Make the implementation simpler, smaller, and more direct.

Be ambitious. A local cleanup is not enough when a restructuring would delete whole branches, helpers, modes, or layers. Look for the code-judo move: a reorganization that uses the existing architecture and makes the change feel inevitable afterward. If complexity can be deleted rather than rearranged, push for deletion.

Working code that leaves the codebase messier does not pass.

## What to judge

Judge each meaningful change against the standards below. A finding names the problem and the simpler structure that should replace it.

### Structural simplification

The best change removes concepts a reader has to hold. Reframing state so conditionals disappear beats gathering those conditionals into one place. Extending an abstraction that already owns the concept beats bolting on a new layer.

Flag a refactor that moves complexity around without reducing it. Flag a complicated implementation when a cleaner model would delete a whole category of branches.

### File size

Do not let a change push a file from under 1000 lines to over 1000 lines unless the resulting file is still clearly organized and splitting it would be worse. Treat crossing that line as a smell. Extract a helper, subcomponent, or module first.

### Spaghetti growth

A new ad-hoc conditional, one-off boolean, nullable mode, or special case dropped into an unrelated flow is a design problem. So is narrow edge-case handling buried in an already busy function, and a "temporary" branch that will become permanent debt.

Put that logic in a dedicated abstraction, helper, state machine, policy, or module. Prefer a simpler default flow with fewer exceptions.

### Directness

Prefer boring, direct code. Brittle or magical behavior is a quality problem. A generic mechanism that hides a simple data shape, a thin wrapper, an identity helper, or a pass-through abstraction adds indirection and buys no clarity. Delete the layer.

### Types and contracts

Unnecessary optionality, `unknown`, `any`, and casts are maintainability problems when a clearer boundary exists. Prefer an explicit typed model or shared contract over a loosely shaped object. A silent fallback that papers over an unclear invariant should become an explicit boundary. Replace a condition chain with a typed model or dispatcher when that makes the flow obvious.

### Layer and reuse

Feature logic belongs in the package, service, or module that already owns the concept. Shared paths should not absorb feature checks, and implementation details should not leak through APIs. Use the canonical helper that already exists.

### Orchestration

Independent work that is serialized for no reason should run in parallel when that also makes the flow clearer. Related updates that can leave state half-applied should be one atomic step. Skip micro-optimizations. Flag orchestration that makes the implementation more brittle.

## How to read a change

For each meaningful change, answer:

- Is there a code-judo move that deletes branches, helpers, or layers?
- Does this improve the local architecture, or does it couple a cohesive module and make it harder to scan?
- Is the logic in the right file and layer?
- Did the diff add branching where a model or helper should exist?
- Did a file cross 1000 lines?
- Is this abstraction earning its keep?
- Did casts, optionality, or ad-hoc object shapes hide the real invariant?
- Is the orchestration more sequential or less atomic than it needs to be?

## How to write the review

Lead with structural problems. Skip cosmetic nits when a structural issue is present. A few high-conviction comments beat a long list.

### Verdict

`Approve` or `Request changes`, then one sentence on why.

### Findings

One subsection per finding, in this order:

1. Structural regression
2. Missed simplification
3. Spaghetti or branching growth
4. Boundary, abstraction, or type-contract problem
5. File size
6. Modularity
7. Legibility

Write each finding like this:

### Short title

**Severity:** Blocker or Concern

**Where:** file or area

**Problem:** what got worse, and why a reader will struggle

**Instead:** the simpler structure to push for

Say it plainly:

- This pushes the file past 1k lines. Decompose it before adding more.
- This adds another special-case branch to an already busy flow. Move it behind its own abstraction.
- This works, and it makes the surrounding code more spaghetti. Keep the behavior and restructure the implementation.
- This is feature logic leaking into a shared path. Isolate it.
- This abstraction is unnecessary. Keep the direct flow.
- This cast or optional is hiding the boundary. Make the contract explicit.
- This is a bespoke helper for something that already exists. Reuse the canonical one.
- There is a code-judo move here. Reframe this so these branches disappear.
- This refactor moves complexity around and does not delete it. Simplify the model.

If nothing structural is wrong, say so in the verdict and stop. Do not invent nits to fill the findings list.

## Approval bar

Approve only when all of these hold:

- No clear structural regression.
- No obvious missed simplification when a simpler path is visible.
- No unjustified jump past 1000 lines.
- No new special-case branching that tangles an existing flow.
- No hacky or magical abstraction that makes the code harder to reason about.
- No wrapper, cast, or optionality churn that obscures the design.
- No architecture-boundary leak or avoidable helper duplication.
- No missed decomposition that would materially improve maintainability.

These are blockers unless the author can justify them:

- Incidental complexity stays when a code-judo move would delete it.
- A file crosses 1000 lines.
- Ad-hoc branching tangles an existing flow.
- A local problem is solved by scattering feature checks across shared code.
- An unnecessary abstraction, wrapper, or cast-heavy contract makes the design more indirect.
- Logic duplicates an existing helper, or it sits in the wrong layer when a canonical home is clear.

If the bar is missed, request changes and name the cleaner structure.
