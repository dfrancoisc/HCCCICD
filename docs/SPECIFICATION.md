# Change Control for Health Connect Cloud — Build Specification

**Status** Ready for development
**Prepared for** The team building the production tool
**Prototype** [HCCCICD](../README.md) — a working user-experience prototype, running against IRIS
**Companion documents** [Design notes](CHANGE_CONTROL.md) · [Diagrams](DIAGRAMS.md) · [Demo script](DEMO_SCRIPT.md)

---

## How to read this

The prototype in this repository is not the deliverable. It exists to settle
the questions that arguments settle badly: what the screens are, what the tool
refuses to let someone do, and what the words on the buttons say. Those are
decided and evidenced. Build against this document, and use the prototype when
you want to see a behaviour rather than read about it.

Requirements are numbered (`FR-1`, `NFR-1`) so they can be referenced in tickets
and traced in test plans. Anything marked **Open** is a decision the build team
must make; it is not an oversight, it is a question the prototype could not
answer on a single instance.

---

## 1. The persona

Everything in this specification follows from one person. If a decision seems
odd, check it against her.

> ### Marta Oliveira — Integration Builder
>
> Marta works for a hospital group that runs its interfaces on Health Connect
> Cloud. She has built and maintained HL7 v2 and FHIR interfaces for nine years.
> She knows ADT message structures better than most developers ever will, she
> can read a Visual Trace and tell you which segment is wrong, and when the lab
> feed stops at three in the morning it is her phone that rings.
>
> She is not a developer, and she does not want to be one.
>
> **What she has**
> The Interoperability editor. The Management Portal wizards. The CSV record
> wizard. Increasingly, the Agentic Integration Builder, which she asks to make
> changes on her behalf.
>
> **What she does not have**
> A shell. Access to the file system — Health Connect Cloud is a managed
> service and the file system is not hers. A Git client, or any reason to learn
> one. The word "rebase" is not in her job description and never will be.
>
> **What her week looks like**
> A supplier changes an analyser and the lab feed needs a new mapping by the
> end of the month. Someone asks why an ORU is being rejected. A new clinic
> comes online and needs the same ADT feed as the last one. She is often the
> only person who understands a given interface end to end.
>
> **How a change reaches Production today**
> She builds it in Development. Then she raises a ticket and asks the platform
> team to move it. They move what she listed. If she forgot something — and the
> thing people forget is the business host a production points at — the
> deployment reports success, the production does not start, and she finds out
> when Test is broken. The error is a compile failure in a log she cannot read,
> in an environment she cannot inspect.
>
> **What she says she wants**
> "I want to move my own change without asking anybody, and I want to be told
> before I send it if I have forgotten something."

**Marta is not less capable than a developer. She has a different job.** A tool
that requires her to learn a developer's job in order to do her own has failed,
however elegant it is.

### Secondary personas

| | |
|---|---|
| **M. Silva — Integration Lead** | Approves changes into Test and Production. Needs to see what changed and why, in language that does not require opening a diff. |
| **Platform administrator** | Configures the promotion path, the approvers, and the reference numbering. Does this once. |
| **Agentic Integration Builder** | Not a person, but it makes changes on Marta's behalf. Anything it does must be captured identically to anything she does by hand. |

---

## 2. Problem statement

Two failures, both routine, both currently invisible until it is too late.

**Collision.** Two builders in the same namespace edit the same routing rule.
The second save wins. The first person's work is gone, with no trace and no
warning. Nothing in the Management Portal prevents this.

**Incomplete change sets.** The builder promotes a production but not the
business host it references. The deployment succeeds. The production does not
start in the target.

The second failure is well documented outside InterSystems. Salesforce change
sets provide a *View/Add Dependencies* button that finds only direct
dependencies and requires the administrator to remember to press it; nested
dependencies are missed and deployments fail. The market answer — Gearset's
"problem analyzers" — runs dependency detection automatically, reports at a
granular level, and does it *before* deployment.

**The lesson this product takes:** the check runs on its own, it is transitive,
and every finding is actionable in one click.

---

## 3. Scope

### In scope

- Capturing every artifact change in a namespace, automatically, whatever tool
  made it
- Per-artifact edit claims to prevent silent overwrites
- Transitive dependency analysis against a target environment, before promotion
- A change-request workflow with per-environment approval
- A configurable promotion path
- In-product guidance that arrives before the first mistake

### Out of scope

- Replacing the Interoperability editor or the Management Portal
- Authoring interfaces — the tool governs change, it does not create it
- A merge or conflict-resolution user interface (see `FR-11`)
- Anything that requires the builder to read or write code

### Explicit non-goals

- **Do not expose Git.** Not the words, not the concepts, not as a fallback.
  The technical vocabulary is available behind a toggle for people who want it
  (`FR-24`) and must never be the primary path.
- **Do not require the builder to remember a step.** Capture that depends on
  someone pressing "add to source control" is capture that does not happen.

---

## 4. The model

The workflow is the documented Health Connect Cloud Embedded Git model, with
the Git removed from view.

| Environment | Contains |
|---|---|
| **Dev deployment** | One or more protected namespaces, plus a personal user namespace per builder |
| **Test deployment** | A protected namespace for pre-production testing |
| **Prod deployment** | A protected namespace for live interfaces |

Each protected namespace has a protected branch — `development`, `test`, `live`.
Work originates in a user namespace on a feature branch cut from `live`, and
reaches an environment by merge request. CI/CD deploys the protected branch into
the protected namespace; merging is the only action needed to move a change
forward.

**What the builder sees instead**

| What we call it | What it is underneath |
|---|---|
| Your change | A feature branch cut from `live`, checked out in your user namespace |
| Started a change | `git checkout -b interface/<user>/<reference> live` |
| Captured and versioned automatically | Embedded Git exports the artifact to a file on save; the version is the commit count for that file |
| Refresh from Production | Sync — commit, rebase onto `live`, update the namespace, push |
| Work not in a change yet | Uncommitted working-tree changes with no feature branch |
| Put this into a change | Create the branch now; the uncommitted changes carry across |
| Items held for you | Edit claims in the lock table, one artifact one editor |
| Change request | A GitLab merge request from your branch to the target environment branch |
| Send forward / send on | A further merge request to the next protected branch |
| Deploys itself | The CI/CD pipeline loads the protected branch into the protected namespace |
| Safety check | Dependency closure over the selection, compared with the target branch and its deployment record |

This table is a **product requirement**, not documentation. It is rendered in
the tool (`FR-24`).

---

## 5. User stories

Written in Marta's voice. Each has acceptance criteria that can be tested.

### 5.1 Starting work

> **US-1** — As Marta, I want to be told what to do before I change anything,
> so that I do not discover the process after I have already broken it.

- Landing in the Interoperability editor with no change open shows guidance
  without being asked for
- Guidance names the one step people miss: start the change *first*
- It does not appear once a change is open — nobody mid-task is interrupted
- It can be dismissed permanently, and remains reachable afterwards

> **US-2** — As Marta, I want to say what I am about to work on and get on with
> it, so that starting a change costs me ten seconds, not ten minutes.

- Starting a change requires one line of description and nothing else
- A reference is generated by default; typing one is a configurable alternative
- Confirmation states plainly that the work is private until sent forward

> **US-3** — As Marta, I want to know at a glance whether I am covered right
> now, so that I never build for an hour and then find out I was not.

- A persistent indicator is visible in the editor for as long as she is working
- It distinguishes: no change started, change open, and work not in a change
- It is visible without opening the tool

### 5.2 Building

> **US-4** — As Marta, I want my work captured without doing anything about it,
> because I will forget, and so will everyone else.

- Every create, update and delete is captured on save
- Capture is identical whatever made the change: editor, portal, wizard, or the
  Agentic Integration Builder
- A new artifact is version 1 at the moment it exists
- No user action is required at any point, and none is offered

> **US-5** — As Marta, I want to see what I have changed, grouped so I can
> scan it, so that I can check I have not touched something by accident.

- The change list groups by artifact kind and shows version, timestamp and
  source for each
- Filtering by kind, by source, and by name
- Deletions appear as deletions, described by what the artifact *was*

> **US-6** — As Marta, I want nobody editing the same thing as me, so that my
> afternoon's work does not vanish because a colleague saved after I did.

- Opening an artifact for edit claims it for the builder
- A claim held by someone else makes the artifact read-only, and names the
  holder
- Claims are released when the change is sent forward or abandoned
- A handover can be requested from the holder

### 5.3 Recovering

> **US-7** — As Marta, I want the work I built before starting a change not to
> be lost, because I did not read the guidance the first time.

- Work captured with no change open is listed as unassigned, not discarded
- It can be adopted into a change, selectively — two unrelated pieces of work
  can be split into two changes
- Adoption is a deliberate act; the tool never sweeps it in silently

> **US-8** — As Marta, I want to be told if somebody else touched the same
> thing while my work was unassigned, so that I do not promote over their fix.

- Adoption offers a collision check against the base branch
- The check names who changed what, and when
- An unchecked collision requires explicit confirmation before proceeding

### 5.4 Sending it forward

> **US-9** — As Marta, I want to be stopped before I send an incomplete change,
> because finding out in Test costs me a day and my credibility.

- The check runs automatically on reaching the step; it is not a button
- It is transitive — it follows references out of references
- It compares the selection against what is actually running in the target
- Blocking findings prevent submission
- Every blocking finding that *can* be fixed by adding an item is fixable in one
  click, and the check re-runs
- Findings state the consequence in plain language: what will break, and when

> **US-10** — As Marta, I want to explain what I did and why once, so that the
> approver does not come back to me with questions.

- What changed, why, risk, rollback and timing are captured with the change
- Description is mandatory; the item list is attached automatically
- The approver sees it without opening a diff

> **US-11** — As Marta, I want to watch my change reach Test, so that I know
> whether to start testing or start chasing.

- Every change shows its position in the promotion path
- Each stage shows its state, when it changed, and who acted
- Once landed, sending it on to the next environment does not require
  re-selecting the items
- The check re-runs against the new target

### 5.5 Administration

> **US-12** — As the platform administrator, I want to configure where changes
> go and who approves, so that the tool matches how this organisation works.

- The promotion path, target namespaces, approval level and approvers are
  configurable per environment
- Cycles and self-references are refused
- Reference numbering is configurable: generated or builder-entered
- Configuration is visible read-only to builders, so they understand the route

---

## 6. Functional requirements

### Capture

- **FR-1** Every create, update and delete of a supported artifact is captured
  without user action, on save.
- **FR-2** Capture is agnostic to the tool that made the change and records
  which one it was.
- **FR-3** Each artifact carries an independent version, starting at 1.
- **FR-4** Deletions are captured, and are described using the artifact's
  recorded type and name — not inferred from its identifier after the fact.
- **FR-5** Artifact coverage: namespaces, productions, business hosts, adapters,
  data transformations, business processes, routing rules, lookup tables,
  message schemas, record maps, system default settings, OAuth clients,
  credentials, and globals. Coverage gaps must be stated in the product, not
  discovered.

### Workspace and claims

- **FR-6** A builder has at most one open change at a time, in a namespace.
- **FR-7** Starting a change requires a description; the reference is generated
  unless configured otherwise.
- **FR-8** Editing an artifact claims it. A claim names its holder and the time
  it was taken.
- **FR-9** An artifact claimed by another builder is read-only, and the tool
  says by whom.
- **FR-10** Work captured with no open change is retained as unassigned and can
  be adopted selectively.
- **FR-11** Concurrent edits to the same artifact are **prevented**, not merged.
  There is no merge interface. **Open:** behaviour when a claim holder is
  unavailable — timeout, lead override, or both.

### Dependency analysis

- **FR-12** The check runs automatically when the builder reaches it.
- **FR-13** It is transitive: references are followed to closure.
- **FR-14** Edges are read from the artifacts themselves — the production
  definition, the rule definition, the transform — never from a hand-maintained
  table.
- **FR-15** Findings are classified: **blocking** (the deployment breaks),
  **warning** (it will deploy but something needs attention), **advisory**.
- **FR-16** Blocking findings prevent submission. Warnings are acknowledged
  individually, never in bulk.
- **FR-17** A blocking finding whose cause is an unselected item is resolvable
  in one click, after which the check re-runs.
- **FR-18** Items that do not travel cleanly between environments are detected
  and reported: secrets, environment-specific settings, data.

### Change requests

- **FR-19** Submitting creates a change request carrying the selection, the
  description, and the target.
- **FR-20** Submitting closes the change and releases its claims.
- **FR-21** Approval is per environment and configurable in level: none, one
  approver, two.
- **FR-22** A landed change can be sent on to the next environment without
  re-selection; the check re-runs against the new target.
- **FR-23** Every state transition is recorded with actor and timestamp, and the
  record is immutable.

### Presentation

- **FR-24** The primary vocabulary contains no version-control terminology. The
  technical equivalents are available behind an explicit toggle, and the mapping
  in §4 is rendered in the product.
- **FR-25** Guidance appears unprompted on first use and is permanently
  dismissible.
- **FR-26** Status is visible in the host editor without opening the tool.
- **FR-27** Findings and errors state the consequence, not the mechanism.

### Configuration

- **FR-28** Environments are configurable: display name, namespace, next
  environment, approval level, approvers.
- **FR-29** Promotion paths that cycle or self-reference are refused.
- **FR-30** Reference generation is configurable between system-generated and
  builder-entered. A blank builder-entered reference falls back to generated
  rather than failing.

---

## 7. Domain model

```
Environment           id, name, namespace, next, approvalLevel, approvers[], order
Change                reference, title, owner, namespace, base, startedAt, state
CapturedItem          key, type, name, action, version, capturedAt, source, requires[]
Claim                 artifactKey, holder, takenAt, releasedAt
ChangeRequest         id, change, title, what, why, risk, rollback, window,
                      items[], target, state, history[]
HistoryEntry          at, actor, action, detail          (append-only)
Finding               severity, kind, subject, requires, message, fixAction
```

**Invariants**

1. A `CapturedItem` belongs to at most one `Change`.
2. A `Claim` is held by exactly one builder for one artifact.
3. `HistoryEntry` is append-only. Nothing rewrites it.
4. `ChangeRequest.items` is fixed at submission. Promotion carries the same set.

---

## 8. Integration architecture

The prototype approximates three things the real build must do properly.

### 8.1 Capture — use Embedded Git, do not poll

The prototype polls `%Dictionary` metadata and compares timestamps. It works,
and it has one visible consequence: it cannot tell which editor made a change,
so everything reads "Captured from IRIS".

**Build it on Embedded Git**, which intercepts the save event and writes a file.
That gives, for free: the editor identity, a real commit history, correct
version numbers, and the file representation promotion needs. The REST shape in
§9 is the one Embedded Git can serve.

`SourceControl.Git.PullEventHandler` is the documented extension point for the
deployment side.

### 8.2 Promotion — merge requests, not a bespoke pipeline

Health Connect Cloud provides a GitLab instance. A change request is a merge
request from the builder's branch to the target environment branch. Approval is
merge-request approval. Deployment is the existing CI/CD pipeline. **Do not
build a parallel deployment mechanism.**

### 8.3 Host integration — the editor's own token

The tool launches from the Interoperability editor and must identify the real
user, because the change list, claims and baseline are all per user.

The editor authenticates its own API with a JSON Web Token. Set
`JWTAuthEnabled` with `GroupById=%ISCMgtPortal` on the API application and it
accepts that token.

**This is the part most likely to be got wrong, so it is worth stating why.**
Password authentication with cookies cannot work: the Management Portal scopes
its session cookie to `/csp/sys/`, and the Interoperability editor holds no IRIS
session at all. No login on the instance can hand a third web application a
session. The prototype demonstrated this by failing at it twice.

The namespace must travel with the request — the builder chooses it in the
editor and the tool must read that one.

### 8.4 Coexistence

The Agentic Integration Builder installs into the same instance and shares the
editor page. Requirements, all verified in the prototype:

- No shared DOM identifiers, CSS classes, or global JavaScript state
- Separate web applications
- Separate persistent storage
- No interference with the other product's controls

**One trap, learned the hard way.** Both products observe the editor's DOM. A
component that writes to the DOM from inside a `MutationObserver` callback
creates a feedback loop that also re-triggers the *other* product's observer,
tearing its event handlers off mid-interaction. Renders must be idempotent and
must ignore mutations they caused.

---

## 9. API contract

Implemented and exercised in the prototype. Namespace travels as
`X-IRIS-Namespace`.

```
GET    /whoami                    caller identity and namespace
GET    /state                     open change, captured items, unassigned work
POST   /workspace                 start a change        { title, ref?, base? }
DELETE /workspace                 abandon
POST   /adopt                     adopt unassigned work { ref?, title, items[] }
POST   /reset                     set the baseline to now
GET    /config                    reference mode, next reference, approval mode
PUT    /config                    { idMode?, approvalRequired? }
GET    /environments              promotion path
PUT    /environments/:id          { name?, namespace?, next?, approval?, approvers? }
GET    /requests                  change requests
POST   /requests                  submit the open change
POST   /requests/:id/approve      approve and deploy
POST   /requests/:id/promote      send on to the next environment
```

Errors use `{ "error": { "code, "message" } }`.

**Required additions for the real build**

```
GET    /claims                    who holds what, across the namespace
POST   /claims/:key/request       ask the holder to release
POST   /requests/:id/reject       send it back with a reason
POST   /requests/:id/reopen       return the items to the builder's change
GET    /requests/:id/diff         what changed, rendered for an approver
```

---

## 10. Non-functional requirements

- **NFR-1 Identity.** Every action is attributed to the authenticated IRIS user.
  No anonymous path in production. The prototype's unauthenticated mode is a
  recording aid and must not survive.
- **NFR-2 Audit.** Every state transition is append-only, with actor and
  timestamp, and is exportable. A simulated or bypassed approval must remain
  distinguishable from a real one for the life of the record.
- **NFR-3 Authorisation.** Approving requires a role the submitter need not
  hold. **Open:** whether self-approval is permitted with an audit marker, or
  refused outright.
- **NFR-4 Concurrency.** Claims must be correct under simultaneous access from
  multiple processes. Reference allocation must not collide — the prototype uses
  `$increment`.
- **NFR-5 Performance.** The change list and the safety check must stay
  responsive on a namespace with several hundred artifacts. Budget: 2 seconds
  for the list, 5 for the check.
- **NFR-6 Scale.** Multiple builders per namespace; multiple namespaces per
  deployment.
- **NFR-7 Resilience.** Losing the connection mid-submission must not produce a
  half-created change request.
- **NFR-8 Accessibility.** Keyboard navigable; status never conveyed by colour
  alone — the prototype pairs every dot with a word.
- **NFR-9 Upgrade safety.** The host editor is modified by appending one script
  tag, after backing the page up. Uninstall restores it. This must survive an
  IRIS upgrade replacing the page.
- **NFR-10 Localisation.** Copy is a product surface and carries most of the
  design. Externalise it. **Open:** which languages.

---

## 11. What the prototype settled, and what it did not

Being straight about this is the point of the handover.

### Settled — behaviour you can copy

- The screen set, and what belongs on each
- The vocabulary, end to end
- That dependency edges can be read from the artifacts themselves — the
  prototype parses the production definition, the rule definition and the
  transform, and finds the missing business host in practice, not in theory
- The gate policy: block on missing dependencies, acknowledge warnings
  individually
- Guidance placement: it must be in the host editor, before the work, not in
  the tool after it
- That capture works without the builder doing anything, verified by creating
  productions in IRIS and watching them appear

### Not settled — you will have to decide

- **Deploying into a second environment.** One instance, one namespace. Target
  baselines are fixtures. Everything about *sending* is real; nothing about
  *arriving* is.
- **Rejection and reopen.** Designed, not built.
- **Cross-environment settings comparison.** The screen exists; the comparison
  is fixture data.
- **Merge and conflict resolution.** Deliberately absent. `FR-11` prevents
  rather than resolves. Whether that survives contact with real users is the
  biggest open product question here.
- **Multi-user behaviour.** One instance, one user. Claims are modelled and
  demonstrated against fixtures; they have never been contended for real.
- **Scale.** Never run against a namespace with hundreds of artifacts.

---

## 12. Risks

| Risk | Why it matters | Suggested response |
|---|---|---|
| Dependency detection is incomplete | A missed edge is exactly the failure the product exists to prevent, and it will be trusted | Build a corpus of real productions and assert the closure. Treat a missed edge as a Sev-1 defect |
| Capture misses an artifact kind | Silent gaps are worse than declared ones | State coverage in the product. Fail loudly on unknown kinds |
| Claims become an obstruction | If holders block colleagues, people will route around the tool | Resolve `FR-11` early. Instrument how often handover is requested |
| Vocabulary erodes | One "merge conflict" in an error message undoes the whole approach | Copy review as a merge gate. Externalised strings make this reviewable |
| Editor page patching breaks on upgrade | The launcher is the only way in | `NFR-9`. Prefer a supported extension point if one becomes available |
| Approval theatre | An approver who cannot see what changed will rubber-stamp | Build `GET /requests/:id/diff` for the approver, in their language |

---

## 13. Suggested delivery

Each phase ends with something demonstrable to Marta.

| Phase | Delivers | Done when |
|---|---|---|
| **1 — Capture** | Embedded Git capture, change list, versioning, editor launcher and status strip | Marta builds a production and sees it appear, versioned, having done nothing |
| **2 — Change and claims** | Start/abandon, claims, unassigned work and adoption, collision check | Two builders cannot overwrite each other, and the second is told why |
| **3 — Safety check** | Transitive analysis, gate policy, one-click fixes | A production submitted without its business service is refused, and fixable in one click |
| **4 — Promotion** | Merge requests, approval, pipeline deployment, request tracking | A change reaches Test by merge request and Marta watches it land |
| **5 — Administration** | Environment configuration, approvers, reference numbering, audit export | An administrator configures the route without a developer |
| **6 — Hardening** | Rejection and reopen, approver diff, performance, accessibility, localisation | Meets §10 |

---

## 14. Acceptance

The product is done, for the first release, when Marta can:

1. Sign in to Health Connect Cloud, open Interoperability, and be told what to
   do before she touches anything
2. Start a change in under ten seconds without typing a reference
3. Build a production and a business service in the editor she already uses,
   and see both captured and versioned without having done anything
4. Attempt to send only the production, and be stopped — with the missing
   business service named, and added in one click
5. Describe the change once and submit it
6. Watch it approved and deployed into Test
7. Send the same items on to Production without picking them again

— without a shell, a file system, a Git client, or asking anybody.
