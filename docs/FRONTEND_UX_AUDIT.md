# Frontend UX Audit

Date: 2026-10-01
Baseline: `cd17267f8e47370ed3df3843eaa0aff200f4cfa7`
Scope: frontend presentation, navigation, accessibility, responsive behavior, and usability only.

## Evidence And Constraints

The audit covers 40 App Router pages, the shared shell, seven UI primitives, feature components, and nearby tests. The staging alias was inspected at 1440x900: home and login render without horizontal overflow; protected routes redirect to login in the available unauthenticated browser session. Protected-page findings therefore combine source inspection, test coverage, and existing query/read-model contracts rather than real professional data. No backend, Prisma, migration, worker, queue, provider, authorization, or domain-semantic change is proposed.

## A. Navigation Problems

- The backoffice sidebar exposes more than 18 undifferentiated links in one continuous list. Core work, knowledge, demos, verticals, and administration compete at the same level.
- Fascicoli appears after secondary operational areas even though it is the principal professional workspace.
- Orchestrazione is visually adjacent to Normativa but has no group context; Audit and Runtime do not share an administration group.
- Profile switching and logout are duplicated in both sidebar and topbar.
- Mobile has no dedicated navigation control. The desktop sidebar becomes a normal block above content, producing a long navigation preamble.
- Page-level breadcrumbs and stable intra-fascicolo navigation are absent.

## B. Visual Hierarchy Problems

- Slate cards, borders, headings, metrics, and action links have nearly equal visual weight across pages.
- The dashboard begins with eleven equally sized metric cards, so urgent work is not distinguishable from inventory totals.
- Page titles live in Topbar while some pages repeat another H1 inside content, weakening heading hierarchy.
- Primary and secondary actions are frequently hand-styled links, so command priority varies by page.
- Role, date, product name, and session actions occupy more header attention than the current task.

## C. Excessively Dense Screens

- Fascicoli renders seven summary cards and a fourteen-column table before the user reaches interpretive guidance.
- Fascicolo detail is a long sequential document: cover, documents, processing, automatic workflow, sources, management data, reviews, requirements, checklist, decisions, and related records have no persistent local navigation.
- `FascicoloAutomaticWorkflowPanel` mixes job state, knowledge, questions, missions, sources, structured reports, and operational proposals in one component and one visual stream.
- Filter bars expose many controls simultaneously and have weak intermediate tablet/laptop breakpoints.
- Automatic research shows internal states and identifiers alongside professional content rather than behind disclosure.

## D. Hard-To-Find Actions

- The Fascicoli primary action is separated from the page title and placed below summary metrics.
- Row actions sit at the far right of wide tables, requiring horizontal travel or scrolling.
- Workflow review/materialization actions appear deep inside a long panel with the same emphasis as secondary information.
- Document actions are mixed with metadata and processing output rather than grouped by document lifecycle.
- Retry and recovery affordances are inconsistent; several errors explain failure but do not clarify the available next step.

## E. Duplications

- Session actions are duplicated in Sidebar and Topbar.
- Status-to-color and status-to-label mappings are repeated across dashboard, badges, workflow, documents, and feature pages.
- Filter layouts and action link class strings are repeated across list pages.
- Fascicolo cover data is repeated again in the numbered management sections.
- Cards are used both as page sections and repeated records, causing nested and visually repetitive framing.

## F. Component Inconsistency

- UI primitives cover basic controls but not page headers, section headers, empty states, alerts, disclosure, segmented tabs, or semantic status labels.
- `Badge` forces uppercase for every semantic domain, reducing readability and making legal direction resemble system severity.
- `Button` has no destructive, ghost, or icon treatment; many links reimplement button styling.
- `Card` uses a fixed border, shadow, and header divider even when the content is a page section rather than a framed item.
- `Table` supports overflow but provides no accessible region label, sticky header, row-link pattern, or mobile guidance.

## G. Responsive Problems

- The shell lacks an intentional mobile/sidebar mode.
- Dense filter grids jump from single-column to very wide desktop layouts without enough intermediate structure.
- Fourteen-column tables remain technically scrollable but are not practically scannable on tablet/mobile.
- Topbar metadata stacks into a tall block on small screens.
- Detail sections use dense multi-column grids and long unbroken technical text; controls can become detached from labels and context.
- Desktop is the correct primary target, but mobile consultation needs summary-first views rather than compressed desktop composition.

## H. Empty, Loading, And Error States

- Empty states are generally plain table rows or short “Nessun …” messages without explaining how data appears or what action is available.
- Server-rendered pages have no shared loading presentation for route transitions or expensive detail surfaces.
- Error messages use local color classes and vary in tone, structure, and recovery guidance.
- Automatic workflow can disappear entirely when empty, leaving no explanation that analysis has not started.
- Technical failure codes are sometimes printed next to user labels in primary content.

## I. Accessibility Problems

- Focus treatment exists on basic controls but is not consistently present on hand-styled links and complex action areas.
- The sidebar has `aria-current`, but no mobile disclosure semantics or grouped navigation labels.
- Complex fascicolo sections lack named landmarks and internal navigation.
- Tables have no accessible scroll-region label and rows are not keyboard-clickable as a unit.
- Badge-only state communication relies heavily on color and uppercase text.
- Repeated H1 usage can create an ambiguous document outline.
- Labels are often wrappers around controls, but explicit `htmlFor`/`id`, error association, and `aria-describedby` are inconsistent.

## J. UX Priorities

### P0 — Foundation And Orientation

1. Establish neutral and semantic tokens, focus styles, typography, spacing, status language, and shared page/section/empty-state primitives.
2. Redesign AppShell, grouped Sidebar, compact Topbar, and responsive mobile navigation without changing routes or permissions.
3. Make actions consistently primary, secondary, quiet, or destructive.

### P1 — Core Daily Work

4. Reframe Dashboard around “what requires attention today”, retaining every metric in a compact secondary layer.
5. Turn Fascicoli into a scan-first registry with compact summary, clearer filters, fewer primary columns, row deep links, and informative empty state.
6. Give Fascicolo detail a professional header and in-page navigation with progressive disclosure; preserve every existing function and server contract.
7. Split automatic workflow presentation into named frontend sections and distinguish legal direction from source usability.

### P2 — Supporting Workspaces

8. Standardize documents, timeline, structured report, proposals, legal research, normative, deadlines, criticalities, and runtime states using shared patterns.
9. Improve responsive table behavior, loading/error/empty states, and keyboard/accessibility coverage.
10. Validate desktop-first viewports (1920, 1440, 1280) and consultation viewports (768, 390) with browser screenshots and overflow checks.

## Implementation Guardrails

- Preserve Server Components and existing server actions/read models.
- Add client state only where interaction requires it; prefer anchors and native disclosure for intra-page navigation.
- Do not alter Prisma, migrations, domain logic, auth semantics, worker, queue, cost gates, providers, or report/proposal semantics.
- Do not expose real staging records in screenshots; use public pages, local fixtures, or structural QA.
- Keep protected worker mode unchanged throughout release alignment.
