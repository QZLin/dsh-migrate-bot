# Documentation index

The entry point to the documentation: `AGENTS.md` holds the rules and links here, and this table sends a reader to the one document, and the one section, that owns a subject. Read the rows for [README.md](../README.md) and [AGENTS.md](../AGENTS.md) first; everything else is looked up when a task needs it rather than read up front.

`scripts/verify-doc-index.ts` computes every entry point below from the target document's actual headings, and fails when a section is renamed, a home disappears, or a document is added without a row. The shape is fixed for the same reason: one topic, one backticked home path, and exactly one link, whose path must equal the home and whose fragment must name a real section.

| Topic | Home | Entry point |
|---|---|---|
| The product, its inputs and outputs, and how to consume the Action | `README.md` | [What it does](../README.md#what-it-does) |
| Where to start as a contributor, and what to run before pushing | `README.md` | [Contributing](../README.md#contributing) |
| Running the Action locally, and what a run without GitHub still writes | `README.md` | [Run it locally](../README.md#run-it-locally) |
| Installing the Action: the workflow, the permissions, the configuration file | `docs/operations/install.md` | [The workflow](operations/install.md#the-workflow) |
| What the proposal is, and what a maintainer does with a draft | `docs/operations/install.md` | [The proposal](operations/install.md#the-proposal) |
| What the state branch stores, and what a run without GitHub still writes | `docs/operations/install.md` | [The state branch](operations/install.md#the-state-branch) |
| A copy of the reusable workflow, for a variable of your own | `docs/operations/install.md` | [A copy of the reusable workflow](operations/install.md#a-copy-of-the-reusable-workflow) |
| Releasing the Action | `docs/operations/release.md` | [Releasing](operations/release.md#releasing) |
| Which tag a consumer pins, and release candidates | `docs/operations/release.md` | [What a consumer pins](operations/release.md#what-a-consumer-pins) |
| How a migration runs as a statechart over an event log, and why | `docs/design/workflow.md` | [Decisions](design/workflow.md#1-decisions) |
| The states of a migration and what each one does | `docs/design/workflow.md` | [The shape](design/workflow.md#2-the-shape) |
| How dsh installation targets and runtime peer compatibility are updated without dropping old support | `docs/design/workflow.md` | [Dependency version policy](design/workflow.md#dependency-version-policy) |
| The invariants the workflow keeps, and the tests that hold them | `docs/design/workflow.md` | [Invariants](design/workflow.md#3-invariants) |
| What the state branch stores, and what is derived from it | `docs/design/workflow.md` | [The state branch](design/workflow.md#4-the-state-branch) |
| What the proposal is, and how a retry finds what an attempt created | `docs/design/workflow.md` | [What a consumer sees](design/workflow.md#5-what-a-consumer-sees) |
| When a run starts, skips or takes over a migration | `docs/design/workflow.md` | [Starting a migration](design/workflow.md#6-starting-a-migration) |
| What happens to a failing check, and why nothing is repaired | `docs/design/workflow.md` | [Reporting a failure](design/workflow.md#7-reporting-a-failure) |
| The three checks, what each one runs, and what a check may read | `docs/design/checks.md` | [The checks](design/checks.md#the-checks) |
| Why the checks are keyless, and what that bounds | `docs/design/checks.md` | [What a check may read](design/checks.md#what-a-check-may-read) |
| Every state, transition and guard of the migration statechart | `docs/reference/workflow.md` | [States](reference/workflow.md#states) |
| Every configuration key, its type and its default | `docs/reference/configuration.md` | [Configuration reference](reference/configuration.md#configuration-reference) |
| The rules for every agent session in this repository | `AGENTS.md` | [Repository invariants](../AGENTS.md#repository-invariants) |
| Every project term, its name in code, and the words it replaces | `docs/glossary.md` | [Migrations](glossary.md#migrations) |
| The full engineering principles every change follows | `docs/engineering.md` | [Persistent data design](engineering.md#1-persistent-data-design) |
| The user-facing capability catalog | `docs/features.md` | [Feature catalog](features.md#feature-catalog) |
| The index of design decisions and open questions | `docs/decisions.md` | [Design decisions index](decisions.md#design-decisions-index) |
| How an open question becomes a design decision | `docs/proposals/README.md` | [Lifecycle](proposals/README.md#lifecycle) |
| How documentation is organised, written, and kept from drifting | `docs/AGENTS.md` | [The tier taxonomy: one home per fact](AGENTS.md#the-tier-taxonomy-one-home-per-fact) |
