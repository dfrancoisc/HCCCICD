# Change Control for Health Connect Cloud

A change-promotion tool for the **Integration Builder** — the person who builds
and maintains interfaces in Health Connect Cloud, is accountable for them
working, and is not a developer.

They have no shell, no file-server access, no Git client and no appetite for
learning one. Today, moving what they built from Development to Test to
Production means asking someone else to do it, and finding out it was wrong
when it fails in the target environment. This tool closes that gap without
turning them into a developer.

This repository is a **working user-experience prototype**. Every screen,
interaction and rule behaves for real; the data behind it is a fixture rather
than a live IRIS query. The design is grounded in the documented InterSystems
Health Connect Cloud Embedded Git workflow, so the mock is a description of
something buildable, not a wish.

---

## The problem it solves

Two things go wrong when a non-developer promotes a change.

**They collide with each other.** Two people editing the same routing rule in
the same namespace, and the second save silently wins.

**They send an incomplete set.** They tick the production but not the business
host it points at. The deployment succeeds, the production will not start, and
nobody finds out until Test is broken. This is the classic failure mode of
Salesforce change sets, and the reason tools like Gearset exist — dependency
detection that is proactive rather than a button you have to remember to press.

The tool answers both: an explicit workspace with item-level locks, and a
safety check that walks the dependency graph before anything moves.

---

## What it does

| Screen | What the user does |
|---|---|
| **My change** | Starts a piece of work under a ticket reference. Gets a private workspace and holds the items they touch. Sees what other people are holding. |
| **What I changed** | Reviews everything that was captured and versioned automatically — no export step, whatever tool made the change. |
| **Send forward** | A four-step wizard: describe it, pick the items, run the safety check, submit. |
| **My requests** | Where each submitted change is in the Development → Test → Production pipeline, and the button to send it on. |
| **Environments** | The promotion path, who approves at each stop, and which kinds of artifact are handled differently on the way over. |

### Vocabulary

The main flow contains no Git words at all. "Branch" is *your change*, "commit"
is *saved automatically*, "merge request" is *change request*, "pipeline" is
*deployment*. A **Show the technical names** toggle in the left rail reveals
branch names, user namespaces and deployment identifiers for anyone who wants
them, and every card carries a collapsible "what this does behind the scenes"
note. Nothing is hidden — it is just not in the way.

---

## The safety check

This is the part worth looking at. Given the selected items and a target
environment, it walks every reference out of every selected item, transitively,
and classifies what it finds.

**Blocking — the deployment would break**

- *Missing.* The item is in your workspace, you did not tick it, and the target
  has never had it. One click adds it, and the check re-runs and follows the
  newly added item's own references. In the seeded demo, resolving the chain
  takes a 5-item selection to 12.
- *Absent.* Nothing in your workspace and nothing in the target provides it.
  You cannot fix this yourself, so the tool explains who can.

**Warning — needs a human decision, does not block**

- *Secrets.* Credentials and OAuth clients travel as an empty shell. The
  password never leaves the environment it was typed into.
- *Per-environment settings.* System Default Settings hold host names, ports and
  directories that differ per environment. The tool shows a side-by-side of your
  values against the target's and flags every setting with no target value.
- *Data.* Globals overwrite whatever is in the target. Explicit confirmation.
- *Platform objects.* A namespace cannot be created by a deployment pipeline; it
  becomes a platform request raised alongside the change.
- *Downgrade.* You are shipping a caller built against a newer version of
  something you did not tick.

**Information** — e.g. the change edits interfaces currently carrying traffic,
which is why Production needs a window.

Blocking findings disable the submit button. Warnings must each be
acknowledged, and anything left unacknowledged is attached to the request for
the approver to see.

### Dependencies it knows about

Production → business hosts · business host → adapter, message class, schema
category, credential, per-host settings · routing rule → transforms it calls,
targets it sends to, lookup tables it reads · DTL → source and target classes,
lookup tables · BPL → called hosts, context classes, transforms · record map →
generated classes.

In a real implementation these come from reading the production definition
XData, the rule definition, the DTL source and the host settings — not from a
hand-maintained list.

---

## Install

Requires a running IRIS for Health or Health Connect container with the
Interoperability editor present.

```bash
./scripts/deploy.sh <container> <namespace>
```

Defaults are `iris-agentic` and `HSCUSTOM`. The script copies the static UI to
`/usr/irissys/csp/hcccicd/`, compiles the installer, and runs it.

The installer, `HCCCICD.Install.Setup`, is idempotent and additive:

```objectscript
do ##class(HCCCICD.Install.Setup).Apply()    // web app + editor tab
do ##class(HCCCICD.Install.Setup).Status()   // what is installed
do ##class(HCCCICD.Install.Setup).Revert()   // put everything back
```

It creates the `/hcccicd` web application and appends one script tag to the
shipped editor page, backing the original up first. It shares no identifier,
style or file with any other application on the instance, so it can be removed
without disturbing anything else.

### Open it

- Standalone: `http://<host>:<port>/hcccicd/index.html`
- In context: open the Interoperability editor and click **Change Control** in
  the dashboard strip.

`?fresh=1` starts with no workspace, so you can walk through "Start a change"
from the beginning. Without it the prototype opens on a populated change with
16 modified items, which is the better demo.

---

## Where the mock ends

Everything goes through the `DATA` block at the top of
[`change.js`](src/csp/hcccicd/change.js). Each function names the IRIS or
Embedded Git call that would back it. Nothing below that block knows the data is
fixed.

The one live call is `/api/agentic/whoami`, so the header shows the real
signed-in user and namespace when the tool is opened from an authenticated
session.

To make it real, the work is: read the working-tree diff for the user's branch
and decorate it with artifact type; compute `requires` from the IRIS metadata
rather than the fixture; replace the baseline with the target branch's file list
and the pipeline's deployment record; and raise a real merge request on submit.
The user interface does not change.

---

## Documentation

- [Design notes](docs/CHANGE_CONTROL.md) — persona, the workflow it models, the
  dependency rules in full, and how each screen maps to Embedded Git and the
  Health Connect Cloud pipeline.
- [Demo script](docs/DEMO_SCRIPT.md) — a walkthrough that lands the two points
  the tool exists to make.

## References

- [Embedded Git for InterSystems](https://github.com/intersystems/git-source-control)
- [Health Connect Cloud workflow](https://github.com/intersystems/git-source-control/blob/main/docs/hcc.md)
- [Introducing InterSystems Health Connect Cloud](https://docs.intersystems.com/services/csp/docbook/DocBook.UI.Page.cls?KEY=HCC_intro)
