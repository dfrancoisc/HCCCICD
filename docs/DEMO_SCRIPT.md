# Demo script

Eight minutes. Two points to land: **nobody can overwrite your work**, and
**you cannot send an incomplete change**.

Open the Interoperability editor, click **Change Control**. Or go straight to
`/hcccicd/index.html`.

There is a second, shorter demo below for the question you will always be
asked — *what if they started building before turning any of this on?* Run it
first if your audience is sceptical, because it is the one that earns trust.

---

## Setting the scene (30 seconds)

> "This is Maria. She looks after about forty interfaces for the trust. She is
> not a developer — no shell, no code, no Git. Today, to move something from
> Development to Test she raises a ticket and waits for someone else, and she
> finds out it was wrong when Test breaks."

---

## 1. My change (90 seconds)

The tool opens on an active change: *Outbound lab results to the LIS*, ticket
INT-4821, 16 items.

> "She started this on Monday. From that moment she has had her own private copy
> of the configuration. Nothing she does is visible to anyone until she decides
> to send it forward."

Scroll to **Items held for you**.

> "And these are hers. While she holds them nobody else can change them."

Point at the two rows held by `m.silva`, and the blocked-item banner below.

> "Her colleague is working on the radiology router. Maria can open it and look
> at it, but she cannot change it. Before this tool, they would both have edited
> it and whoever saved second would have won — silently. That is the first thing
> we fixed."

*Point 1 landed.*

---

## 2. What I changed (60 seconds)

Click **What I changed**.

> "Sixteen items, every one captured and given a version the moment she saved
> it. She did not export anything."

Scroll and point at the source tags.

> "It does not matter which tool she used. The routing rule came from the
> Interoperability editor. The lookup table came from the CSV wizard. The
> namespace came from the Management Portal. And these ones —"

Point at an **Agentic Integration Builder** tag.

> "— she asked the AI to build for her. Same capture, same versioning, and
> tagged so she can always see what the agent did in her name."

Filter to **Namespace**.

> "She created a new namespace on Monday. There it is, version 1. Everything is
> in scope — not just code. Settings, OAuth, lookup tables, globals, schemas."

---

## 3. Send forward (4 minutes — the main event)

Click **Send forward**.

**Step 1.** Already filled in.

> "Title, what changed, why. Mandatory, because a human reads them and 'fixes'
> wastes everyone's time. Risk, timing, how to undo it."

Click **Next: pick the changes**.

**Step 2.**

> "Five of the sixteen are ticked. She picked the production, both routers, the
> transform she fixed, and the settings. She is confident. She would have sent
> exactly this."

Click **Next: run the safety check**.

**Step 3 — pause here.**

> "Five problems. This change would have broken Test."

Read the first one aloud.

> "*The production points at a business service you have not selected.* She is
> sending the production, and the production references LabResultIn — which she
> created last Tuesday and did not tick. Test has never seen it. The deployment
> would have reported success and the production would not have started."

> "This is the single most common way a change fails, and every tool in this
> space that non-developers use gets it wrong — Salesforce change sets have a
> dependency button you have to remember to press, and it only finds the first
> level."

Click **Add LabResultIn**.

> "One click. And watch — it re-runs, and it follows what it just added."

Keep clicking each **Add** as they appear. Narrate as the count moves.

> "The business service needs the message schema. The schema was not ticked
> either. The router calls a transform, the transform reads a lookup table, the
> lookup table came out of the CSV wizard on Monday. Five items became twelve,
> and she would have missed seven of them."

Land on **0 things to fix, 2 things to check**.

> "Nothing is broken now. Two things left, and neither of them is a bug — they
> are decisions only a human can make."

Click **Show me the values**.

> "System Default Settings. Her development values stay in development — Test
> keeps its own. But four settings she added have no Test value at all. The
> hosts would start with nowhere to connect to. It is telling her exactly which
> four and who to ask."

Close. Point at the credential warning.

> "And the password on the LIS credential never leaves this environment. The
> entry gets created in Test empty, and somebody with Test access fills it in
> once. She needs to know that now, not when the socket fails authentication."

Acknowledge both, click through to **Review**, then **Submit**.

*Point 2 landed.*

---

## 4. My requests (60 seconds)

> "Twelve items on their way to Test."

Point at the pipeline strips.

> "Every change she has sent and exactly where it is. This one is live in
> Production. This one has been sitting waiting for approval for two days — she
> can nudge. And this one came back with a reason she can read: the reporting
> team still needs A31."

> "When Test is happy, she comes here and sends the same change on to
> Production. She does not pick the items again, and the safety check runs again
> against Production, because Production is not Test."

---

## 5. Environments (30 seconds)

> "Set up once. Development deploys itself, Test needs one approval, Production
> needs two and a window."

Scroll to **Handled differently on the way over**.

> "And this is the contract. Settings are per environment. Secrets never travel.
> Globals are not copied because they are usually live data. Namespaces are a
> platform request because a pipeline cannot create one. Those rules are why the
> safety check said what it said."

---

## The close

Toggle **Show the technical names** in the left rail.

> "One last thing. Underneath, this is exactly the Embedded Git workflow
> InterSystems already recommends for Health Connect Cloud — a feature branch
> off live, a personal namespace, a merge request per environment, CI/CD doing
> the deployment. Nothing new to operate."

> "Maria never has to know that. But when she wants to, it is one toggle away —
> and when she talks to your platform team, they are talking about the same
> thing she is."

---

## The recovery demo (3 minutes)

Open `/hcccicd/index.html?fresh=1`. Clear the welcome first if you have already
dismissed it — it is worth showing.

> "Different Maria. She has been building for two days and has never opened this
> tool. Somebody has just told her she has to send her work to Test. This is the
> first thing she sees."

The welcome appears, with the green callout at the bottom.

> "*You have work that is not in a change yet. Nothing is lost.* That sentence is
> the whole design. Capture never depended on her remembering to press a button —
> every save was recorded whether or not she had started a change."

Click **Get started**. **Work not in a change yet**, seven items.

> "Everything she built. The service, the operation, the transform, the router,
> the lookup table she made in the CSV wizard, the schema, the settings. All
> captured, all versioned, none of it belonging to anything yet."

> "What she is missing is not the work. It is two smaller things: a label saying
> which piece of work this is, and a hold on those items."

Click **Check nobody else touched these**.

> "And this is the second one biting. While her work was unassigned, nothing was
> holding the system default settings, and her colleague changed them too. One of
> them has the other's edit. The tool will not let her discover that in Test."

Fill in the reference. Click **Put this into a change**.

> "Ten seconds. It is now a proper change, the items are held for her, and she
> can send it forward exactly like anyone who did it in the right order."

> "The message is not 'you did it wrong'. It is 'we had you covered, here is the
> fix, and here is why doing it first is better next time'."

---

## Questions you will get

**Is it doing this against real IRIS?** No. Every screen and rule is real; the
data is a fixture. The dependency edges would be read from the production
definition, the rule definition and the host settings. The user interface does
not change when it is wired up.

**What if the dependency check is wrong?** Blocking findings are things that
would certainly fail — a class that is not there. Everything softer is a warning
the user acknowledges. It never silently drops something.

**What stops someone bypassing it?** Nothing here — the gate is the protected
branch and the approval on the merge request, which already exist. This tool
makes the right path the easy one, it does not police the wrong one.

**Locks or branches?** Both. Branches stop files colliding. Locks stop two
people building conflicting versions of the same rule and finding out at merge
time, which for this persona is the worst possible moment.
