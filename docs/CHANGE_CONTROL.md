# Change Control — design notes

## 1. Who this is for

The **Integration Builder** in Health Connect Cloud. They build and maintain
HL7 v2, FHIR and file interfaces, they are accountable for those interfaces
working, and they are not a developer.

What that means concretely, and what every design decision follows from:

- No shell, no file-server access, no ability to read or write code. Health
  Connect Cloud is a managed service and the file system is not theirs.
- No Git client and no reason to learn one. "Rebase" is not a word in their job.
- They work in the Interoperability editor, the Management Portal wizards, and —
  increasingly — by asking the Agentic Integration Builder to make the change
  for them.
- They are frequently the only person who understands a given interface, and
  they are on the hook when it stops at 3am.

They are not less capable than a developer. They have a different job. A tool
that makes them learn a developer's job to do their own is a failed tool.

## 2. What goes wrong today

**Collision.** Two builders in the same namespace editing the same routing rule.
The second save wins and the first person's work is gone with no trace and no
warning. Nothing in the Management Portal prevents this.

**Incomplete change sets.** The builder promotes a production but not the
business host it references. The deployment reports success. The production will
not start in the target and the failure surfaces as a compile error in a log
they cannot read, in an environment they cannot inspect.

The second failure mode is well documented outside InterSystems. Salesforce
change sets have a *View/Add Dependencies* button that only finds direct
dependencies and requires the admin to remember to press it; nested dependencies
are missed and the deployment fails. The market response — Gearset's "problem
analyzers" — is dependency detection that runs automatically and reports at a
granular level *before* deployment, which is why its success rate is close to
100%. The lesson taken here: **the check runs on its own, it is transitive, and
its findings are actionable in one click.**

## 3. The model underneath

The workflow being modelled is the documented Health Connect Cloud Embedded Git
workflow, unchanged. The prototype is a different front end onto it, not a
different process.

| Health Connect Cloud reality | What the user sees |
|---|---|
| Three deployments, each with a protected namespace of the same name | Three environments: Development, Test, Production |
| Protected branches `development`, `test`, `live` | The environments themselves |
| Personal user namespace, one per builder | "Your own private copy" |
| Feature branch `interface/<user>/<ref>` cut from `live` | "Start a change", built on what is running in Production |
| Embedded Git exports each artifact to a file on save | "Versioned automatically" — no export step |
| Sync: commit, rebase on `live`, update namespace, force push | "Refresh from Production" |
| Merge request from the feature branch to a protected branch | "Change request" |
| CI/CD deploys the protected branch into the protected namespace | "Deploys itself" |
| One merge request per environment, from the same feature branch | "Send it on to Test / Production" from My requests |

The one addition to the documented workflow is the **edit claim**. Branch
isolation stops two people's *files* from colliding, but it does not stop two
people from independently building conflicting versions of the same routing rule
and discovering it at merge time — which for this persona is the worst possible
moment. An explicit item-level lock, visible to everyone, turns a late merge
conflict into an early conversation. It is the pessimistic-locking half of the
"basic system synchronization" requirement, and it is what the *Items held for
you* table represents.

## 3a. Capture does not depend on the user remembering

This is the single most important property of the design, and it comes free
from Embedded Git rather than from anything built here.

Embedded Git intercepts the save event in every editor — the Interoperability
editor, the Management Portal, the wizards, and anything driving them
programmatically such as the Agentic Integration Builder — and exports the
artifact to a file in the repository working tree. That happens whatever branch
is checked out and whether or not the user has started a change.

So the failure mode "the builder forgot to turn source control on and lost two
days of work" **cannot happen**. What a forgotten start actually costs is two
narrower things:

1. The work has no label saying which piece of work it belongs to, so it cannot
   be packaged and sent forward.
2. No edit claims were registered, so nothing stopped a colleague editing the
   same artifact.

Both are recoverable, and the tool treats them as an ordinary state rather than
an error. **Work not in a change yet** appears at the top of *My change*
whenever unassigned work is detected. The user ticks what belongs together,
supplies a reference and a description, and adopts it. Underneath, the branch is
created at that moment and the uncommitted working-tree changes carry across —
`git checkout -b` does exactly this — then claims are registered retroactively.

Selection is per item, so a builder who did two unrelated things in one sitting
splits them into two changes rather than being forced to send both together.

Problem 2 is the one that cannot be undone, so it is surfaced rather than
glossed over. **Check nobody else touched these** compares each adopted item
against the base branch for a newer commit touching the same file, and names
who changed what and when. Adoption is not blocked — the work is real and
refusing to package it helps nobody — but an unchecked collision forces an
explicit confirmation first. The wording says plainly that starting the change
first is what avoids the situation, because the goal is for the user to want to
do step 1 next time, not to feel punished for having missed it.

The guide leads with this. Telling a non-developer "you must remember to do X
before you start" produces anxiety and, eventually, a support ticket. Telling
them "we captured it either way, and here is the ten-second fix" produces a user
who trusts the tool.

## 4. Vocabulary

The main flow uses no Git vocabulary. This is not dumbing down; it is naming
things after what they do for the person doing them.

| Never shown | Shown instead |
|---|---|
| Branch | Your change |
| Commit | Saved automatically |
| Rebase / pull | Refresh from Production |
| Merge request / pull request | Change request |
| Pipeline / CI job | Deployment |
| Diff | What I changed |
| Conflict | Someone else is editing this |

Two escape hatches keep this honest:

1. **Show the technical names** in the left rail reveals branch names, user
   namespaces and deployment identifiers inline, everywhere.
2. Every card has a collapsible *what this does behind the scenes* note naming
   the real mechanism.

A builder who wants to understand the machine can. One who does not, does not
have to. Neither is punished.

## 5. Artifact coverage

Everything the Interoperability editor, the Management Portal and the wizards
can produce is in scope, because a change set that covers only classes is a
change set that silently drops half of what the builder did.

| Type | Versioned as | Promotion treatment |
|---|---|---|
| Namespace | Configuration file, v1 on creation | **Platform request** — a pipeline cannot create a namespace |
| Production | Class with `ProductionDefinition` XData | Normal |
| Business service / process / operation | Class | Normal |
| Adapter | Class | Normal |
| DTL, BPL | Class with XData | Normal |
| Routing rule | Class with `RuleDefinition` XData | Normal |
| Lookup table | Export file | Normal |
| Record map (CSV wizard) | Class plus generated classes | Normal — generated classes travel with it |
| Message schema, custom Z-segments | Schema export | Normal |
| Web application | Configuration file | Normal |
| System Default Settings | **One file per environment** | Target keeps its own values |
| Credential | Entry only | Secret never copied |
| OAuth client | Configuration only | Client secret never copied |
| Global | Export file | Not copied unless explicitly marked as configuration |

The per-environment System Default Settings file is the mechanism Embedded Git
already provides: a mapping whose target folder contains the `<env>` keyword,
which expands to the environment name. This is why the tool can promise that
your development host names and ports stay in development.

Every change carries its **source** — Interoperability editor, Management
Portal, CSV record wizard, or Agentic Integration Builder. Changes the agent
made on the builder's behalf are versioned identically to ones they made by
hand and are visually tagged, so the builder can always see what the agent did
in their name.

## 6. The dependency engine

Implemented in `analyse()` in `change.js`. Three passes.

### Pass 1 — reference walk

Breadth-first over the selection, following each item's `requires` edges
transitively. For each reference, four outcomes:

| Outcome | Condition | Severity |
|---|---|---|
| Satisfied | In the selection, or already deployed in the target | — |
| **Missing** | In the workspace, not selected, not in the target | Block, one-click fix |
| **Absent** | Not in the workspace and not in the target | Block, no self-service fix |
| **Downgrade** | In the target at an older version than the one the selected item was built against | Warn |

Because the walk is transitive, the one-click fix cascades: adding a business
host pulls its own references into scope and the check re-runs against the new
selection. That is what takes the seeded demo from 5 items to 12.

*Missing* and *absent* are deliberately different findings. Missing is the
user's own oversight and is one click from fixed. Absent needs someone else, so
the tool explains who — build it yourself, wait for a colleague's change, or ask
whoever administers the target.

### Pass 2 — items that do not travel cleanly

Over the selection itself, keyed on the artifact type's promotion treatment:
secret, per-environment, data, platform. Each produces a warning with a specific
acknowledgement, not a generic "are you sure". The per-environment finding opens
a side-by-side comparison of your values against the target's, with every
setting that has no target value flagged — because a business operation that
starts with a blank IP address is a 3am problem.

### Pass 3 — advisory

Context the approver needs: whether the change edits interfaces currently
carrying traffic, which is what justifies a change window.

### Where the edges come from

In the prototype, `requires` is a fixture. In an implementation it is read from
IRIS metadata:

- Production → hosts: the `ProductionDefinition` XData item list.
- Host → adapter, message class, schema category, credential: the host's class
  definition and its settings.
- Routing rule → transforms and targets: the `transform` and `target` attributes
  in the `RuleDefinition` XData.
- DTL → source/target classes and lookup tables: the transform's `sourceClass`
  and `targetClass`, plus `Lookup()` calls in its expressions.
- BPL → called hosts, context classes, transforms: `<call>`, `<transform>` and
  the context declaration.
- Record map → generated classes: the record map's generated class names.

None of it requires the user to maintain anything.

## 7. Gate policy

- **Blocking findings disable submit.** Not a warning the user can click past —
  the deployment would fail, and the entire point is that they should not find
  that out in the target environment.
- **Warnings must be acknowledged individually**, each with wording specific to
  what is being agreed to. Anything left unacknowledged is attached to the
  request for the approver, rather than silently dropped.
- **The change log is mandatory.** Title, what changed, why. The approver reads
  these; a request that says "fixes" wastes their time and the builder's.
- **Rollback is prompted but optional**, defaulting to "roll back to the
  previously deployed version", which is what the pipeline can actually do.

## 8. Deliberate omissions

Things a developer would expect that are not here, and why:

- **No file or line diffs.** The builder cannot read the export format and it
  would not help them. What changed is expressed as behaviour: "added 2 items,
  changed pool size on EMRAdtOut from 1 to 2".
- **No conflict resolution UI.** Merge conflicts are prevented by locks rather
  than resolved after the fact. If a lock is genuinely contested, the answer is a
  conversation, so the tool offers "ask them to release it".
- **No branch or history graph.** The pipeline view answers the only question
  they actually ask: where is my change, and what is holding it up.
- **No partial-file promotion.** The unit is the artifact. Half a routing rule is
  not a thing.

## 9. In-system guidance

The persona will not read documentation before using a tool, and will not find
a wiki page when they are stuck. So the guidance is in the product.

**Welcome overlay.** Shown the first time the tool is opened in a browser.
Three cards — say what you are working on, build as you always do, send it
forward — plus a live callout if unassigned work was detected, because that
person's very next question is "so where is my stuff?". Dismissible for good
with a checkbox; the same content lives permanently under *How this works*, so
dismissing it loses nothing.

**How this works.** First item in the rail. Six steps, each with what the user
does and a *why it matters* / *what happens on its own* note explaining the
mechanism. Step 1 carries a callout for people who already started building, and
step 6 covers that case in full including the collision risk. Below the steps: a
FAQ of the eight questions this persona actually asks, and a glossary mapping
every plain-language term on these screens to what the platform team calls it.

**Inline notes.** Every card has a collapsible *what this does behind the
scenes*, and the **Show the technical names** toggle reveals branch names, user
namespaces and deployment identifiers throughout. The guide is the long-form
version of the same commitment: nothing is hidden, it is just not in the way.

## 10. Implementation notes

- `HCCCICD.Install.Setup` is additive and reversible. It creates one web
  application and appends one script tag to the shipped editor page, backing the
  original up first.
- `inject.js` shares no identifier, style or global with the Agentic Integration
  Builder's injector. Both load on the same page; either can be removed alone.
- The static application is created with `ServeFilesTimeout=0` so a redeploy is
  picked up immediately — the CSP gateway otherwise stamps `Expires: +1h` and
  the browser keeps serving the previous bundle after a deploy. `UseCookies=2`
  stops a stylesheet request from minting a session cookie.
- The tool is namespace-agnostic. The editor passes its namespace through on the
  query string; the header falls back to the REST endpoint's namespace.
