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
        If 'tSC { Quit }
        Set o = {}
        Set o.idMode = ..IdMode()
        Set o.nextId = ..PeekId()
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
        If 'tSC { Quit }
        Set body = ..Body()
        Set mode = ..Str(body, "idMode")
        If (mode '= "auto") && (mode '= "manual") {
            Set tSC = ..Fault(400, "idMode must be auto or manual")
            Quit
        }
        Set ^HCCCICD("cfg", "idMode") = mode
        Set tSC = ..GetConfig()
    } Catch ex {
        Set tSC = ..Fail(ex)
    }
    Quit tSC
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
        If 'tSC { Quit }
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

            Set item = ..Describe(key, info, action, $get(^HCCCICD("rev", user, key), 1))
            If noWs || $data(^HCCCICD("orphan", user, key)) {
                Do orphans.%Push(item)
            } Else {
                Do changes.%Push(item)
            }
        }

        ; --- deletions --------------------------------------------------
        Set key = ""
        For {
            Set key = $order(^HCCCICD("base", user, key))
            Quit:key=""
            Continue:$data(cur(key))
            Set item = ..Describe(key, $listbuild(..GuessType(key), key, "Deleted from the namespace", ""), "del",
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
        If 'tSC { Quit }
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
            Quit
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
        If 'tSC { Quit }
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
        If 'tSC { Quit }
        Set body = ..Body()
        Set user = $username
        Set ref   = ..Str(body, "ref")
        Set title = ..Str(body, "title")

        Set items = ""
        If $isobject(body), body.%IsDefined("items") { Set items = body.items }
        If '$isobject(items) {
            Set tSC = ..Fault(400, "items must be an array of artifact keys")
            Quit
        }

        If $get(^HCCCICD("ws", user)) = "" {
            If (..IdMode() = "auto") || (ref = "") { Set ref = ..NextId() }
            If title = "" {
                Set tSC = ..Fault(400, "Say what this work is")
                Quit
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
        If 'tSC { Quit }
        Set user = $username
        ; Deliberately keeps ^HCCCICD("seq") and the settings: resetting the
        ; baseline is "everything here is the starting point", not "this
        ; namespace never had a change", and reusing spent reference
        ; numbers would collide with changes already sent forward.
        Kill ^HCCCICD("base", user), ^HCCCICD("seen", user)
        Kill ^HCCCICD("rev", user), ^HCCCICD("orphan", user)
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
    }
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
