# Plan: Agents page live map

Status: approved 2026-11-22
Scope: the top of the Agents page. History, Tell your agents, and the activity contract stay.

This is Revision 2 of the Agents live view. The three defaults below were confirmed by the owner in the task brief. Figma is not available in this session (the Figma connection needs a sign-in), so the design is specified here and built in the dashboard. Do not redraw it in the warm-wood Atelier palette. BearRok's own system leads: the dark run panel, Geist on this page, Grok bots from `GrokBot.tsx`.

## What the student does

Watch the current search as a picture: one layer per level, each agent as its own icon, the latest action under the icon, and arrows that show which way work is moving. Hover or focus an icon to read the detail. History under the map still answers why a run returned nothing.

## What is restored from the old page (eaecae6)

- Dark run panel (`.ag-hero`, `.ag-xai`): title "Live run #n", status and elapsed, Live / Reconnecting chip, Run now / Stop search, Agent settings.
- Honest one-line source note, Tell your agents bar, stats strip (agents working, agents done, pages read, found, kept, in your feed).
- Picture language: Goal pill, a Grok bot per agent (shape and colour per level), a dashed box around a manager's workers and around its reviews, arrow connectors, the "Your feed" card.
- Not restored: the fixed five-bot chain, and the "What your agents do" side panel. The popover carries that detail. Sample panels stay on the no-server demo only.

## Confirmed decisions

| Decision | Confirmed |
|---|---|
| Assignments point down. Results point up from a manager's workers to that manager, then down the pipeline: validation, presentation, Your feed. | owner, 2026-11-22 |
| The old side panel is dropped. Hover and keyboard focus open the detail popover. | owner, 2026-11-22 |
| A long group scrolls inside its box, about three rows, with a fade at the edge. | owner, 2026-11-22 |

## Elements

| Element | Shows | Action |
|---|---|---|
| Goal pill | What this run was asked to find | — |
| Layer band (x5) | Master, search managers, workers, validation, presentation, with running / done / failed counts | — |
| Agent node | Grok bot, kind badge, status ring, name, latest action (two lines), elapsed | Hover, focus, or Enter opens the popover. Escape or leaving closes it. |
| Group box | One manager's workers, or that manager's reviews. "Other work" when a row has no manager. | Scrolls inside past about three rows |
| Arrow, assignment | Down: master to the managers ("n briefs"); each manager to its workers ("n tasks") | Moves only while those receivers are queued or running |
| Arrow, result | Up: a manager's workers to that manager ("n brought back"). Down: workers to validation ("n to review"), validation to presentation ("n kept"), presentation to Your feed ("n saved") | Moves only while the receiver is queued or running |
| Detail popover | Now doing, task, target, status, elapsed, recent actions (newest first, up to 4), result counts | `aria-describedby` points at it while it is open |
| Your feed card | How many new postings were saved | Link to the feed |

## States

No run yet (empty hint per layer, Run now) · connecting skeleton · running · partly failed · finished · failed · reconnecting (dimmed, run actions disabled) · error with Retry · overflow (a group scrolls inside its box) · reduced motion (static arrows, bots still, an active arrow stays a solid line) · popover open by hover and by keyboard.

## Layout

- 1024 px and up: one column per search manager, so a manager, its workers and its reviews line up.
- 768 px: the same columns, two per row.
- 360 px: bands stack, groups full width, one centred arrow between bands.

## Data

One additive field on each activity agent: `recent: { at, text }[]`, the last 4 distinct action lines, newest first. History, the funnel and the stream are unchanged.

## Milestones

| ID | Stage | Deliverable | Acceptance |
|---|---|---|---|
| M4 | design | This section. Figma skipped: no Figma connection. | Every state above is named. Components match the old panel and the Grok bots. |
| M5 | build | `recent` on the activity feed. Live map, popover, arrows. History and Tell your agents unchanged. | Tests for layer grouping, action text, popover content, arrow direction. Typecheck. Full suites. |
| M6 | test | Simulated run on 5186 / 8796, during and after. Widths 360, 768, 1024, 1440. Reduced motion. Keyboard. | No overlap. Popover reachable by keyboard and a screen reader. |
