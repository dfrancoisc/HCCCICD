/// Live change capture for the Change Control prototype.
///
/// Reads the namespace and reports what has changed since a baseline, so the
/// tool can be driven against real artifacts instead of fixtures. This is the
/// piece that makes "create a production and watch it appear" work.
///
/// It is a stand-in for Embedded Git, not a replacement for it. Embedded Git
/// captures on the save event and writes a file; this polls class metadata and
/// compares timestamps. The observable behaviour is close enough to test the
/// workflow, and the same REST shape would be served by the real thing.
///
/// State lives in ^HCCCICD in the application namespace:
///   ^HCCCICD("base",   user, key)  baseline timestamp — the "zero changes" point
///   ^HCCCICD("seen",   user, key)  last observed timestamp, drives versioning
///   ^HCCCICD("rev",    user, key)  version counter
///   ^HCCCICD("orphan", user, key)  changed before a change was started
///   ^HCCCICD("ws",     user)       the open change
///
/// UseSession=0 is deliberate and load-bearing: this is fetched from an iframe
/// with credentials, and a CSP session on these routes deadlocks the request.
Class HCCCICD.REST.Dispatch Extends %CSP.REST
{

Parameter UseSession = 0;

Parameter HandleCorsRequest = 1;

XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
    <Route Url="/whoami"    Method="GET"    Call="WhoAmI" />
    <Route Url="/state"     Method="GET"    Call="GetState" />
    <Route Url="/workspace" Method="POST"   Call="StartWorkspace" />
    <Route Url="/workspace" Method="DELETE" Call="AbandonWorkspace" />
    <Route Url="/adopt"     Method="POST"   Call="Adopt" />
    <Route Url="/reset"     Method="POST"   Call="Reset" />
    <Route Url="/config"    Method="GET"    Call="GetConfig" />
    <Route Url="/config"    Method="PUT"    Call="PutConfig" />
    <Route Url="/environments"     Method="GET" Call="ListEnvs" />
    <Route Url="/environments/:id" Method="PUT" Call="UpdateEnv" />
    <Route Url="/requests"  Method="GET"    Call="ListRequests" />
    <Route Url="/requests"  Method="POST"   Call="SubmitRequest" />
    <Route Url="/requests/:id/approve" Method="POST" Call="ApproveRequest" />
    <Route Url="/requests/:id/promote" Method="POST" Call="PromoteRequest" />
</Routes>
}

/// Description: Packages we never report — shipped product, not the user's work.
Parameter SKIPPREFIX = "Ens,EnsLib,EnsPortal,HS,HSMOD,SYS,INFORMATION,Config,Backup,%,CSP,SchemaMap,HCCCICD";

/// Description: How change references are produced.
///
///   auto   — the system allocates &lt;NAMESPACE&gt;-&lt;n&gt;, counting from 1. Default.
///   manual — the builder types their own ticket reference.
///
/// Stored per namespace, because the counter is per namespace and a site may
/// well want tickets in one and generated identifiers in another.
ClassMethod IdMode() As %String [ Internal ]
{
    Quit $get(^HCCCICD("cfg", "idMode"), "auto")
}

/// Description: Whether a change needs somebody else to sign it off.
///
///   1 — required. The change waits in the target environment's queue until a
///       second person approves it. This is what a real deployment does.
///   0 — bypassed. Submitting approves and deploys in one step, under the
///       submitter's own name and clearly labelled as such.
///
/// Bypass exists because a single-instance prototype has no second person to
/// do the approving, so without it every change stalls at the first gate and
/// the rest of the pipeline can never be seen.
ClassMethod ApprovalRequired() As %Boolean [ Internal ]
{
    Quit +$get(^HCCCICD("cfg", "approvalRequired"), 1)
}

/// Description: What the next generated reference will be, without consuming
/// it. The form is asking so it can show the user what they are about to get.
ClassMethod PeekId() As %String [ Internal ]
{
    Quit $namespace _ "-" _ ($get(^HCCCICD("seq"), 0) + 1)
}

/// Description: Allocate the next reference. $increment so two builders
/// starting a change at the same moment cannot be handed the same number.
ClassMethod NextId() As %String [ Internal ]
{
    Quit $namespace _ "-" _ $increment(^HCCCICD("seq"))
}

/// Description: Current settings, plus a preview of the next reference.
ClassMethod GetConfig() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set o = {}
        Set o.idMode = ..IdMode()
        Set o.nextId = ..PeekId()
        Set o.approvalRequired = ..ApprovalRequired()
        Set o.namespace = $namespace
        Set o.ok = 1
        Set tSC = ..Json(o)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Change the reference mode.
ClassMethod PutConfig() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set body = ..Body()

        If $isobject(body), body.%IsDefined("idMode") {
            Set mode = ..Str(body, "idMode")
            If (mode '= "auto") && (mode '= "manual") {
                Set tSC = ..Fault(400, "idMode must be auto or manual")
                Return tSC
            }
            Set ^HCCCICD("cfg", "idMode") = mode
        }

        If $isobject(body), body.%IsDefined("approvalRequired") {
            Set ^HCCCICD("cfg", "approvalRequired") = +body.approvalRequired
        }

        Set tSC = ..GetConfig()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: The environment definitions for this instance.
///
/// Seeded once with the Health Connect Cloud shape — Development, Test,
/// Production — and editable from the Environments screen thereafter. The
/// promotion path is the "next" field on each row, so changing where a change
/// goes next is a single edit rather than a code change.
ClassMethod SeedEnvs() [ Internal ]
{
    If $data(^HCCCICD("env")) { Quit }
    Set ns = $namespace
    Do ..PutEnv("dev",  "Development", ns, "test", "none", "",                     1)
    Do ..PutEnv("test", "Test",        ns, "prod", "one",  "m.silva",              2)
    Do ..PutEnv("prod", "Production",  ns, "",     "two",  "m.silva,change-board", 3)
}

ClassMethod PutEnv(pId, pName, pNs, pNext, pApproval, pApprovers, pOrder) [ Internal ]
{
    Set e = {}
    Set e.id = pId
    Set e.name = pName
    Set e.namespace = pNs
    Set e.next = pNext
    Set e.approval = pApproval
    Set e.approvers = pApprovers
    Set e.order = pOrder
    Set ^HCCCICD("env", pId) = e.%ToJSON()
}

ClassMethod GetEnv(pId As %String) As %DynamicObject [ Internal ]
{
    Do ..SeedEnvs()
    Set raw = $get(^HCCCICD("env", pId))
    If raw = "" Quit ""
    Quit ##class(%DynamicAbstractObject).%FromJSON(raw)
}

/// Description: Where a change in this environment goes next. Read from the
/// configuration, so the promotion path is data rather than code.
ClassMethod NextEnv(pEnv As %String) As %String [ Internal ]
{
    Set e = ..GetEnv(pEnv)
    If '$isobject(e) Quit ""
    Quit e.next
}

ClassMethod EnvLabel(pEnv As %String) As %String [ Internal ]
{
    Set e = ..GetEnv(pEnv)
    If '$isobject(e) Quit pEnv
    Quit e.name
}

/// Description: The whole promotion path, in order.
ClassMethod ListEnvs() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Do ..SeedEnvs()
        Set list = []
        Set ord = ""
        Kill byOrder
        Set id = ""
        For {
            Set id = $order(^HCCCICD("env", id))
            Quit:id=""
            Set e = ..GetEnv(id)
            If $isobject(e) { Set byOrder(+e.order, id) = "" }
        }
        Set o = ""
        For {
            Set o = $order(byOrder(o))
            Quit:o=""
            Set id2 = ""
            For {
                Set id2 = $order(byOrder(o, id2))
                Quit:id2=""
                Do list.%Push(..GetEnv(id2))
            }
        }
        Set out = {}
        Set out.environments = list
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Edit one environment — its namespace, where it sends to, and
/// who has to approve.
ClassMethod UpdateEnv(pId As %String) As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set e = ..GetEnv(pId)
        If '$isobject(e) {
            Set tSC = ..Fault(404, "No such environment: " _ pId)
            Return tSC
        }
        Set body = ..Body()

        If body.%IsDefined("name"),      ..Str(body, "name") '= "" { Set e.name = ..Str(body, "name") }
        If body.%IsDefined("namespace"), ..Str(body, "namespace") '= "" { Set e.namespace = ..Str(body, "namespace") }
        If body.%IsDefined("approvers")  { Set e.approvers = ..Str(body, "approvers") }

        If body.%IsDefined("approval") {
            Set a = ..Str(body, "approval")
            If (a '= "none") && (a '= "one") && (a '= "two") {
                Set tSC = ..Fault(400, "approval must be none, one or two")
                Return tSC
            }
            Set e.approval = a
        }

        If body.%IsDefined("next") {
            Set n = ..Str(body, "next")
            If n = pId {
                Set tSC = ..Fault(400, "An environment cannot send to itself")
                Return tSC
            }
            If (n '= ""), '$isobject(..GetEnv(n)) {
                Set tSC = ..Fault(400, "No such environment: " _ n)
                Return tSC
            }
            ; Refuse a cycle. Walking the path is cheap and a loop here would
            ; make promotion run forever rather than stopping at the last stop.
            Set probe = n, hops = 0
            For {
                Quit:probe=""
                If probe = pId {
                    Set tSC = ..Fault(400, "That would make the promotion path loop back on itself")
                    Return tSC
                }
                Set pe = ..GetEnv(probe)
                Quit:'$isobject(pe)
                Set probe = pe.next
                Set hops = hops + 1
                If hops > 20 { Quit }
            }
            If 'tSC { Quit }
            Set e.next = n
        }

        Set ^HCCCICD("env", pId) = e.%ToJSON()
        Set tSC = ..ListEnvs()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}


/// Description: Append one line to a request's history. Every state change is
/// recorded with who and when, because the audit trail is the point of the
/// tool — and a bypassed approval especially must not be able to pass for a
/// real one later.
ClassMethod Note(pReq As %DynamicObject, pAction As %String, pDetail As %String = "") [ Internal ]
{
    Set e = {}
    Set e.at = $zdatetime($horolog, 3)
    Set e.who = $username
    Set e.action = pAction
    If pDetail '= "" { Set e.detail = pDetail }
    Do pReq.history.%Push(e)
}

ClassMethod SaveReq(pReq As %DynamicObject) [ Internal ]
{
    Set ^HCCCICD("req", pReq.id) = pReq.%ToJSON()
}

ClassMethod LoadReq(pId As %String) As %DynamicObject [ Internal ]
{
    Set raw = $get(^HCCCICD("req", pId))
    If raw = "" Quit ""
    Quit ##class(%DynamicAbstractObject).%FromJSON(raw)
}

/// Description: Every change request in this namespace, newest first.
ClassMethod ListRequests() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set out = {}
        Set list = []
        Set id = ""
        For {
            Set id = $order(^HCCCICD("req", id), -1)
            Quit:id=""
            Set r = ..LoadReq(id)
            If $isobject(r) { Do list.%Push(r) }
        }
        Set out.requests = list
        Set out.approvalRequired = ..ApprovalRequired()
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Send the open change forward.
///
/// Creates the change request, closes the workspace, and — when approval is
/// bypassed — approves and deploys it in the same call, so one person can walk
/// the whole pipeline.
ClassMethod SubmitRequest() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set body = ..Body()
        Set user = $username

        Set ws = $get(^HCCCICD("ws", user))
        If ws = "" {
            Set tSC = ..Fault(400, "There is no change open to send forward")
            Return tSC
        }

        Set title = ..Str(body, "title")
        If title = "" { Set title = $listget(ws, 2) }
        Set target = ..Str(body, "target")
        If target = "" { Set target = "test" }

        Set items = []
        If $isobject(body), body.%IsDefined("items"), $isobject(body.items) {
            Set items = body.items
        }

        Set r = {}
        Set r.id        = $listget(ws, 1)
        Set r.ref       = $listget(ws, 1)
        Set r.title     = title
        Set r.what      = ..Str(body, "what")
        Set r.why       = ..Str(body, "why")
        Set r.risk      = ..Str(body, "risk")
        Set r.rollback  = ..Str(body, "rollback")
        Set r.window    = ..Str(body, "window")
        Set r.target    = target
        Set r.items     = items
        Set r.itemCount = items.%Size()
        Set r.namespace = $namespace
        Set r.createdBy = user
        Set r.createdAt = $zdatetime($horolog, 3)
        Set r.history   = []
        Do ..Note(r, "Submitted", items.%Size() _ " items to " _ ..EnvLabel(target))

        If ..ApprovalRequired() {
            Set r.status = "awaiting"
            Set r.autoApproved = 0
            Do ..Note(r, "Waiting for approval", "Needs a second person to sign it off")
        } Else {
            Do ..Approve(r, 1)
        }

        Do ..SaveReq(r)
        Do ..CloseWorkspace(user, items)

        Set out = {}
        Set out.request = r
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Mark a request approved and deployed into its target.
/// pAuto records whether a person did it or the bypass did — the two must
/// never be indistinguishable in the history.
ClassMethod Approve(pReq As %DynamicObject, pAuto As %Boolean) [ Internal ]
{
    Set pReq.status = "deployed"
    Set pReq.approvedAt = $zdatetime($horolog, 3)
    Set pReq.deployedAt = $zdatetime($horolog, 3)
    Set pReq.autoApproved = +pAuto

    ; A single instance has no second person, so an explicit approval is
    ; attributed to the approver configured for the target environment and the
    ; request reads the way it would in a real deployment. Who actually pressed
    ; the button is kept alongside it — the demo reads cleanly without the
    ; underlying fact being thrown away.
    Set e = ..GetEnv(pReq.target)
    Set approver = ""
    If $isobject(e) { Set approver = $piece(e.approvers, ",", 1) }
    If approver = "" { Set approver = $username }

    Set pReq.approvedBy = approver
    Set pReq.approvedByActual = $username
    Set pReq.simulated = 1

    If pAuto {
        Do ..Note(pReq, "Approved automatically",
                  "Approval is bypassed in this environment — deployed without review")
    } Else {
        Do ..Note(pReq, "Approved", "Signed off by " _ approver)
    }
    Do ..Note(pReq, "Deployed", "Live in " _ ..EnvLabel(pReq.target))
}

/// Description: Approve a waiting request explicitly.
ClassMethod ApproveRequest(pId As %String) As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set r = ..LoadReq(pId)
        If '$isobject(r) {
            Set tSC = ..Fault(404, "No such change request: " _ pId)
            Return tSC
        }
        If r.status = "deployed" {
            Set tSC = ..Fault(400, "That change is already deployed")
            Return tSC
        }
        Do ..Approve(r, 0)
        Do ..SaveReq(r)
        Set out = {}
        Set out.request = r
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Send an already-deployed request on to the next environment.
ClassMethod PromoteRequest(pId As %String) As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set r = ..LoadReq(pId)
        If '$isobject(r) {
            Set tSC = ..Fault(404, "No such change request: " _ pId)
            Return tSC
        }
        If r.status '= "deployed" {
            Set tSC = ..Fault(400, "That change has not landed yet, so it cannot go on")
            Return tSC
        }
        Set next = ..NextEnv(r.target)
        If next = "" {
            Set tSC = ..Fault(400, "Production is the last stop")
            Return tSC
        }
        Set r.target = next
        Do ..Note(r, "Sent on", "Same items, now targeting " _ ..EnvLabel(next))
        If ..ApprovalRequired() {
            Set r.status = "awaiting"
            Do ..Note(r, "Waiting for approval", "Needs a second person to sign it off")
        } Else {
            Do ..Approve(r, 1)
        }
        Do ..SaveReq(r)
        Set out = {}
        Set out.request = r
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: The change has been sent. Close the workspace and fold the
/// items that went with it into the baseline, so they stop being reported as
/// outstanding work in this namespace.
ClassMethod CloseWorkspace(pUser As %String, pItems As %DynamicArray) [ Internal ]
{
    Kill cur
    Do ..Scan(.cur)
    Set it = pItems.%GetIterator()
    While it.%GetNext(.i, .key) {
        If $data(cur(key), info) {
            Set ^HCCCICD("base", pUser, key) = $listget(info, 4)
            Set ^HCCCICD("seen", pUser, key) = $listget(info, 4)
        } Else {
            Kill ^HCCCICD("base", pUser, key), ^HCCCICD("seen", pUser, key)
            Kill ^HCCCICD("was", pUser, key)
        }
        Kill ^HCCCICD("rev", pUser, key), ^HCCCICD("orphan", pUser, key)
    }
    Kill ^HCCCICD("ws", pUser)
}

/// Description: Switch to the namespace the caller is actually working in.
///
/// The web application is bound to one namespace, but the Interoperability
/// editor lets the user pick any of them, and the change list has to describe
/// the one they are looking at. The launcher forwards it as X-IRIS-Namespace.
///
/// Callers must New $namespace first so the switch unwinds with the request.
/// Anything unknown or not accessible is refused rather than silently scanning
/// the wrong namespace, which would report someone else's productions as this
/// user's work.
ClassMethod UseNamespace() As %Status
{
    Set tSC = $$$OK
    Try {
        Set ns = $get(%request.CgiEnvs("HTTP_X_IRIS_NAMESPACE"))
        If ns = "" { Set ns = $get(%request.Data("namespace", 1)) }
        If ns = "" { Quit }
        Set ns = $zconvert(ns, "U")
        If ns = $namespace { Quit }
        If '##class(%SYS.Namespace).Exists(ns) {
            Set tSC = $$$ERROR($$$GeneralError, "Namespace " _ ns _ " does not exist")
            Quit
        }
        ; Attempt the switch rather than asking whether it is allowed:
        ; %SYS.Namespace has no IsAvailable, and the protection check the user
        ; actually needs is the one IRIS itself applies on assignment.
        Set $namespace = ns
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Who is calling, and where. The first thing the tool asks, and
/// the answer it puts in its header.
ClassMethod WhoAmI() As %Status
{
    New $namespace
    Set obj = {}
    Set sc = ..UseNamespace()
    Set obj.username = $username
    Set obj.namespace = $namespace
    Set obj.roles = $roles
    Set obj.ok = 1
    If 'sc { Set obj.namespaceError = $system.Status.GetErrorText(sc) }
    Quit ..Json(obj)
}

/// Description: Everything the tool needs in one call — the open change, the
/// artifacts that have changed since the baseline, and which of those are not
/// yet part of a change.
ClassMethod GetState() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set user = $username
        Set out = {}

        ; --- the open change -------------------------------------------
        Set ws = $get(^HCCCICD("ws", user))
        If ws = "" {
            Set out.workspace = ""
        } Else {
            Set w = {}
            Set w.ref     = $listget(ws, 1)
            Set w.title   = $listget(ws, 2)
            Set w.base    = $listget(ws, 3)
            Set w.started = $listget(ws, 4)
            Set w.branch  = $listget(ws, 5)
            Set w.usrns   = $listget(ws, 6)
            Set out.workspace = w
        }

        ; --- baseline exists? First call ever silently takes one, so that
        ;     a fresh install does not report the entire namespace as new.
        If '$data(^HCCCICD("base", user)) {
            Do ..Snapshot(user)
            Set out.seeded = 1
        }

        ; --- diff -------------------------------------------------------
        Kill cur
        Do ..Scan(.cur)

        Set changes = []
        Set orphans = []
        ; Nothing can belong to a change that is not open. With no workspace,
        ; everything detected is by definition unassigned work.
        Set noWs = (ws = "")

        Set key = ""
        For {
            Set key = $order(cur(key), 1, info)
            Quit:key=""
            Set ts     = $listget(info, 4)
            Set base   = $get(^HCCCICD("base", user, key))
            Set action = ""
            If base = "" {
                Set action = "new"
            } ElseIf ts '= base {
                Set action = "mod"
            }
            Continue:action=""

            Do ..BumpRevision(user, key, ts, action)
            Do ..Remember(user, key, info)

            Set item = ..Describe(key, info, action, $get(^HCCCICD("rev", user, key), 1))
            If noWs || $data(^HCCCICD("orphan", user, key)) {
                Do orphans.%Push(item)
            } Else {
                Do changes.%Push(item)
            }
        }

        ; --- deletions --------------------------------------------------
        ; Something built inside this change and then removed again — the
        ; Delete Artifacts button is the usual way — is a net no-op, so it is
        ; not reported. Its bookkeeping is dropped here rather than left to
        ; accumulate, otherwise a rebuilt artifact of the same name inherits a
        ; stale version number from work that no longer exists.
        Set key = ""
        For {
            Set key = $order(^HCCCICD("rev", user, key))
            Quit:key=""
            Continue:$data(cur(key))
            Continue:$get(^HCCCICD("base", user, key))'=""
            Kill ^HCCCICD("rev", user, key), ^HCCCICD("seen", user, key)
            Kill ^HCCCICD("orphan", user, key), ^HCCCICD("was", user, key)
        }

        Set key = ""
        For {
            Set key = $order(^HCCCICD("base", user, key))
            Quit:key=""
            Continue:$data(cur(key))
            Set was  = $get(^HCCCICD("was", user, key))
            Set wType = $listget(was, 1)
            Set wName = $listget(was, 2)
            If wType = "" { Set wType = ..GuessType(key) }
            If wName = "" { Set wName = key }
            Set item = ..Describe(key, $listbuild(wType, wName, "Deleted from the namespace", ""), "del",
                                  $get(^HCCCICD("rev", user, key), 1))
            If noWs || $data(^HCCCICD("orphan", user, key)) {
                Do orphans.%Push(item)
            } Else {
                Do changes.%Push(item)
            }
        }

        Set out.changes = changes
        Set out.orphans = orphans
        Set out.namespace = $namespace
        Set out.username = user
        Set out.idMode = ..IdMode()
        Set out.nextId = ..PeekId()
        Set out.ok = 1
        Set tSC = ..Json(out)
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Begin a change. Anything already showing as changed stays an
/// orphan and has to be adopted deliberately — silently sweeping it into the
/// new change would hide the fact that nothing was holding those items.
ClassMethod StartWorkspace() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set body = ..Body()
        Set user = $username
        Set ref   = ..Str(body, "ref")
        Set title = ..Str(body, "title")
        Set base  = ..Str(body, "base")
        If base = "" { Set base = "prod" }

        ; In auto mode the system owns the reference and ignores anything the
        ; client sent. In manual mode an empty box still gets a generated one
        ; rather than a failure — a change with no identifier is worse than a
        ; change with a generated identifier.
        If (..IdMode() = "auto") || (ref = "") { Set ref = ..NextId() }

        If title = "" {
            Set tSC = ..Fault(400, "Say what you are working on")
            Return tSC
        }

        ; Freeze the current change list as orphans.
        Do ..MarkCurrentAsOrphans(user)

        Set slug = $zconvert($translate(user, ".-_", ""), "L")
        Set ws = $listbuild(ref, title, base, $zdatetime($horolog, 3),
                            "interface/" _ slug _ "/" _ ref,
                            "USR" _ $extract($zconvert($translate(user, ".-_", ""), "U"), 1, 5))
        Set ^HCCCICD("ws", user) = ws
        Set tSC = ..GetState()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Drop the open change. The artifacts themselves are untouched —
/// this only forgets which piece of work they belonged to, so they revert to
/// being unassigned rather than disappearing.
ClassMethod AbandonWorkspace() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set user = $username
        Do ..MarkCurrentAsOrphans(user)
        Kill ^HCCCICD("ws", user)
        Set tSC = ..GetState()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Move unassigned work into a change, creating the change if
/// there is not one open already.
ClassMethod Adopt() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set body = ..Body()
        Set user = $username
        Set ref   = ..Str(body, "ref")
        Set title = ..Str(body, "title")

        Set items = ""
        If $isobject(body), body.%IsDefined("items") { Set items = body.items }
        If '$isobject(items) {
            Set tSC = ..Fault(400, "items must be an array of artifact keys")
            Return tSC
        }

        If $get(^HCCCICD("ws", user)) = "" {
            If (..IdMode() = "auto") || (ref = "") { Set ref = ..NextId() }
            If title = "" {
                Set tSC = ..Fault(400, "Say what this work is")
                Return tSC
            }
            Set slug = $zconvert($translate(user, ".-_", ""), "L")
            Set ^HCCCICD("ws", user) = $listbuild(ref, title, "prod", $zdatetime($horolog, 3),
                "interface/" _ slug _ "/" _ ref,
                "USR" _ $extract($zconvert($translate(user, ".-_", ""), "U"), 1, 5))
        }

        Set it = items.%GetIterator()
        While it.%GetNext(.i, .v) {
            Kill ^HCCCICD("orphan", user, v)
        }
        Set tSC = ..GetState()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Declare the current state of the namespace to be the starting
/// point. Everything that exists right now becomes "already there" and the
/// change list goes empty. This is how you begin a clean test.
ClassMethod Reset() As %Status
{
    New $namespace
    Set tSC = $$$OK
    Try {
        Set tSC = ..UseNamespace()
        If 'tSC { Return tSC }
        Set user = $username
        ; Deliberately keeps ^HCCCICD("seq") and the settings: resetting the
        ; baseline is "everything here is the starting point", not "this
        ; namespace never had a change", and reusing spent reference
        ; numbers would collide with changes already sent forward.
        Kill ^HCCCICD("base", user), ^HCCCICD("seen", user)
        Kill ^HCCCICD("rev", user), ^HCCCICD("orphan", user), ^HCCCICD("was", user)
        ; ^HCCCICD("env"), ("req") and ("seq") survive on purpose: the
        ; promotion path and the changes already sent forward are not part
        ; of "what counts as new in this namespace".
        Kill ^HCCCICD("ws", user)
        Do ..Snapshot(user)
        Set tSC = ..GetState()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
}

/// Description: Record the namespace as it stands as the baseline.
ClassMethod Snapshot(pUser As %String) [ Internal ]
{
    Kill cur
    Do ..Scan(.cur)
    Set key = ""
    For {
        Set key = $order(cur(key), 1, info)
        Quit:key=""
        Set ^HCCCICD("base", pUser, key) = $listget(info, 4)
        Set ^HCCCICD("seen", pUser, key) = $listget(info, 4)
        Do ..Remember(pUser, key, info)
    }
}

/// Description: Keep the type and display name of everything we have seen.
///
/// Once an artifact is deleted its class is gone, so there is nothing left to
/// read a type from. Guessing from the name got it wrong the moment it
/// mattered: deleting AgenticInterop.TESTE.CICD.AlertRule and .RoutingRule
/// reported both as productions, because neither name contains the substring
/// the guess looked for. Recording it while the artifact still exists is the
/// only way to describe its removal correctly.
ClassMethod Remember(pUser As %String, pKey As %String, pInfo As %List) [ Internal ]
{
    Set ^HCCCICD("was", pUser, pKey) = $listbuild($listget(pInfo, 1), $listget(pInfo, 2))
}

/// Description: Flag everything currently reported as changed as unassigned.
ClassMethod MarkCurrentAsOrphans(pUser As %String) [ Internal ]
{
    Kill cur
    Do ..Scan(.cur)
    Set key = ""
    For {
        Set key = $order(cur(key), 1, info)
        Quit:key=""
        Set base = $get(^HCCCICD("base", pUser, key))
        If (base = "") || ($listget(info, 4) '= base) {
            Set ^HCCCICD("orphan", pUser, key) = 1
        }
    }
    ; deletions count too
    Set key = ""
    For {
        Set key = $order(^HCCCICD("base", pUser, key))
        Quit:key=""
        If '$data(cur(key)) { Set ^HCCCICD("orphan", pUser, key) = 1 }
    }
}

/// Description: Version numbers. A brand new artifact is version 1; every
/// distinct save after that moves it on by one.
ClassMethod BumpRevision(pUser As %String, pKey As %String, pTS As %String, pAction As %String) [ Internal ]
{
    Set seen = $get(^HCCCICD("seen", pUser, pKey))
    If seen = pTS, $data(^HCCCICD("rev", pUser, pKey)) { Quit }
    If pAction = "new", '$data(^HCCCICD("rev", pUser, pKey)) {
        Set ^HCCCICD("rev", pUser, pKey) = 1
    } Else {
        Set ^HCCCICD("rev", pUser, pKey) = $get(^HCCCICD("rev", pUser, pKey), 1) + 1
    }
    Set ^HCCCICD("seen", pUser, pKey) = pTS
}

/// Description: Walk the namespace for interoperability artifacts the user
/// could plausibly have authored. arr(key) = $lb(type, name, detail, timestamp)
ClassMethod Scan(Output arr) [ Internal ]
{
    Kill arr

    Set sql = "SELECT c.Name, c.PrimarySuper, d.TimeChanged, d.Description "
            _ "FROM %Dictionary.CompiledClass c "
            _ "LEFT JOIN %Dictionary.ClassDefinition d ON c.Name = d.ID "
            _ "WHERE c.PrimarySuper [ '~Ens.' AND c.Deployed = 0 AND c.System = 0"
    Set rs = ##class(%SQL.Statement).%ExecDirect(, sql)
    While rs.%Next() {
        Set cls = rs.%GetData(1)
        Continue:..Skip(cls)
        Set sup = rs.%GetData(2)
        Set type = ..Classify(sup)
        Continue:type=""
        Set ts = rs.%GetData(3)
        Set desc = $piece($replace(rs.%GetData(4), $char(13), " "), $char(10), 1)
        Set arr(cls) = $listbuild(type, cls, ..Detail(cls, type, desc), ts)
    }

    ; Lookup tables are rows, not classes. No timestamp is available, so they
    ; register as present or absent rather than modified.
    Try {
        Set rs2 = ##class(%SQL.Statement).%ExecDirect(,
            "SELECT DISTINCT TableName FROM Ens_Util.LookupTable")
        While rs2.%Next() {
            Set tbl = rs2.%GetData(1)
            Continue:tbl=""
            Set cnt = 0
            Set rs3 = ##class(%SQL.Statement).%ExecDirect(,
                "SELECT COUNT(*) FROM Ens_Util.LookupTable WHERE TableName = ?", tbl)
            If rs3.%Next() { Set cnt = rs3.%GetData(1) }
            Set arr("lookup:" _ tbl) = $listbuild("lookup", tbl, cnt _ " rows", "rows=" _ cnt)
        }
    } Catch { }
}

/// Description: Map a superclass chain to one of our artifact types. Order
/// matters — BPL is a business process, DTL is a data transform.
ClassMethod Classify(pSuper As %String) As %String [ Internal ]
{
    Set s = "~" _ $translate(pSuper, ",", "~") _ "~"
    If s [ "~Ens.Production~"           Quit "production"
    If s [ "~Ens.BusinessProcessBPL~"   Quit "bpl"
    If s [ "~Ens.DataTransformDTL~"     Quit "dtl"
    If s [ "~Ens.Rule.Definition~"      Quit "rule"
    If s [ "~Ens.BusinessService~"      Quit "service"
    If s [ "~Ens.BusinessOperation~"    Quit "operation"
    If s [ "~Ens.BusinessProcess~"      Quit "process"
    If s [ "~Ens.DataTransform~"        Quit "dtl"
    If s [ "~Ens.OutboundAdapter~"      Quit "adapter"
    If s [ "~Ens.InboundAdapter~"       Quit "adapter"
    Quit ""
}

/// Description: Best guess at a type for something that no longer exists.
ClassMethod GuessType(pKey As %String) As %String [ Internal ]
{
    If pKey [ "lookup:"     Quit "lookup"
    If pKey [ ".Production" Quit "production"
    If pKey [ ".DTL"        Quit "dtl"
    If pKey [ ".Rule"       Quit "rule"
    Quit "production"
}

/// Description: A one-line human description of the artifact.
ClassMethod Detail(pClass As %String, pType As %String, pDesc As %String) As %String [ Internal ]
{
    Set out = pDesc
    If pType = "production" {
        Set n = ..CountItems(pClass)
        Set out = $select(n = 0 : "Empty production, no items yet", 1 : n _ " items")
        If pDesc '= "" { Set out = out _ " — " _ pDesc }
    }
    If out = "" { Set out = "No description" }
    Quit $extract(out, 1, 200)
}

/// Description: How many business hosts a production declares.
ClassMethod CountItems(pClass As %String) As %Integer [ Internal ]
{
    Set n = 0
    Try {
        Set body = ..XData(pClass, "ProductionDefinition")
        Set p = 1
        For {
            Set p = $find(body, "<Item ", p)
            Quit:p=0
            Set n = n + 1
        }
    } Catch { }
    Quit n
}

/// Description: What this artifact needs in order to work. Read from the
/// artifact itself, so it stays true when the user edits it.
ClassMethod Requires(pClass As %String, pType As %String) As %DynamicArray [ Internal ]
{
    Set out = []
    Try {
        If pType = "production" {
            Do ..Attr(..XData(pClass, "ProductionDefinition"), "ClassName", .list)
        } ElseIf pType = "rule" {
            Do ..Attr(..XData(pClass, "RuleDefinition"), "transform", .list)
            Do ..Attr(..XData(pClass, "RuleDefinition"), "target", .list)
        } ElseIf (pType = "dtl") || (pType = "bpl") {
            Do ..Attr(..XData(pClass, "DTL"), "sourceClass", .list)
            Do ..Attr(..XData(pClass, "DTL"), "targetClass", .list)
            Do ..Attr(..XData(pClass, "BPL"), "className", .list)
        }
        Set k = ""
        For {
            Set k = $order(list(k))
            Quit:k=""
            ; Only report things the user could own. A reference to a shipped
            ; EnsLib class is always satisfied and is noise.
            Continue:..Skip(k)
            Continue:k=pClass
            Do out.%Push(k)
        }
    } Catch { }
    Quit out
}

/// Description: Collect the distinct values of one XML attribute.
ClassMethod Attr(pBody As %String, pAttr As %String, ByRef pList) [ Internal ]
{
    Set needle = pAttr _ "="""
    Set p = 1
    For {
        Set p = $find(pBody, needle, p)
        Quit:p=0
        Set v = $piece($extract(pBody, p, *), """", 1)
        If v '= "" { Set pList(v) = 1 }
    }
}

/// Description: Read an XData block as a string. Empty if absent.
ClassMethod XData(pClass As %String, pName As %String) As %String [ Internal ]
{
    Set out = ""
    Try {
        Set xd = ##class(%Dictionary.XDataDefinition).%OpenId(pClass _ "||" _ pName)
        If $isobject(xd) {
            Do xd.Data.Rewind()
            While 'xd.Data.AtEnd { Set out = out _ xd.Data.Read(32000) }
        }
    } Catch { }
    Quit out
}

/// Description: Is this a shipped class rather than the user's own work?
ClassMethod Skip(pClass As %String) As %Boolean [ Internal ]
{
    Set pkg = $piece(pClass, ".", 1)
    Set skip = 0
    For i = 1:1:$length(..#SKIPPREFIX, ",") {
        If pkg = $piece(..#SKIPPREFIX, ",", i) { Set skip = 1 Quit }
    }
    If $extract(pClass) = "%" { Set skip = 1 }
    Quit skip
}

/// Description: Shape one artifact for the wire.
ClassMethod Describe(pKey As %String, pInfo As %List, pAction As %String, pRev As %Integer) As %DynamicObject [ Internal ]
{
    Set type = $listget(pInfo, 1)
    Set o = {}
    Set o.key     = pKey
    Set o.type    = type
    Set o.name    = $listget(pInfo, 2)
    Set o.action  = pAction
    Set o.version = pRev
    Set o.detail  = $listget(pInfo, 3)
    Set o.when    = ..When($listget(pInfo, 4))
    Set o.source  = "IRIS"
    Set o.requires = $select(pAction = "del" : [], 1 : ..Requires(pKey, type))
    Quit o
}

/// Description: Render a timestamp for display. TimeChanged comes back in
/// logical $horolog form, not ODBC, so it has to be converted before it means
/// anything to a human.
ClassMethod When(pTS As %String) As %String [ Internal ]
{
    Set out = ""
    Try {
        If pTS = "" { Quit }
        If pTS [ "rows=" { Quit }
        If pTS [ "," {
            Set out = $extract($zdatetime(pTS, 3), 1, 16)
        } Else {
            Set out = $extract($translate(pTS, "T", " "), 1, 16)
        }
    } Catch {
        Set out = ""
    }
    Quit out
}

/// Description: Read and parse the request body. Class-method %FromJSON —
/// the instance form returns empty on this build.
ClassMethod Body() As %DynamicObject [ Internal ]
{
    Set obj = {}
    Try {
        Set txt = ""
        While '%request.Content.AtEnd { Set txt = txt _ %request.Content.Read(32000) }
        If txt '= "" { Set obj = ##class(%DynamicAbstractObject).%FromJSON(txt) }
    } Catch { }
    Quit obj
}

/// Description: Safe string read off a dynamic object. $get() on a property
/// throws INVALID CLASS, so test with %IsDefined first.
ClassMethod Str(pObj As %DynamicObject, pName As %String) As %String [ Internal ]
{
    If '$isobject(pObj) Quit ""
    If 'pObj.%IsDefined(pName) Quit ""
    Set v = pObj.%Get(pName)
    Quit $select($isobject(v) : "", 1 : v)
}

/// Description: Write a JSON response.
ClassMethod Json(pObj As %DynamicObject) As %Status [ Internal ]
{
    Set %response.ContentType = "application/json"
    Set %response.Headers("Cache-Control") = "no-store"
    Write pObj.%ToJSON()
    Quit $$$OK
}

/// Description: Error envelope, matching the project convention.
ClassMethod Fault(pStatus As %Integer, pMessage As %String) As %Status [ Internal ]
{
    Set %response.Status = pStatus
    Set o = {}
    Set o.error = {}
    Set o.error.code = pStatus
    Set o.error.message = pMessage
    Quit ..Json(o)
}

/// Description: Turn a caught exception into the error envelope.
ClassMethod Fail(pEx As %Exception.AbstractException) As %Status [ Internal ]
{
    Quit ..Fault(500, pEx.DisplayString())
}

}
