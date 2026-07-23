/// Installer for the Health Connect Cloud Change Control prototype.
///
/// Does two things, both idempotent:
///   1. Creates the /hcccicd CSP application that serves the tool's static
///      files out of /usr/irissys/csp/hcccicd/.
///   2. Appends a script tag to the shipped IRIS for Health Interoperability
///      editor so a "Change Control" tab appears in its dashboard strip.
///
/// Deliberately additive. It touches no file and no configuration belonging to
/// any other application, and Revert() puts the editor back exactly as it was.
///
/// Usage:
///   do ##class(HCCCICD.Install.Setup).Apply()
///   do ##class(HCCCICD.Install.Setup).Revert()
Class HCCCICD.Install.Setup Extends %RegisteredObject
{

/// Web application name for the static UI.
Parameter APPNAME = "/hcccicd";

/// Physical directory the web application serves.
Parameter APPPATH = "/usr/irissys/csp/hcccicd/";

/// REST application for live change capture.
Parameter APINAME = "/api/hcccicd";

/// The shipped Interoperability editor entry point.
Parameter EDITORHTML = "/usr/irissys/ui/interop/interop-editor/index.html";

/// Marker used to detect a patch that is already applied.
Parameter MARKER = "hcccicd/inject.js";

/// Backup suffix for the untouched editor page.
Parameter BACKUPSUFFIX = ".hcccicd-original";

/// Description: Create or update the /hcccicd static web application.
/// Mirrors the settings the project's other static application uses:
/// ServeFiles with no expiry so a redeploy is picked up immediately, and
/// UseCookies=2 so serving a stylesheet never mints a session cookie.
ClassMethod CreateWebApp(pNamespace As %String = "") As %Status
{
    Set tSC = $$$OK
    Try {
        If pNamespace = "" { Set pNamespace = $namespace }
        New $namespace
        Set $namespace = "%SYS"

        Kill props
        Set props("NameSpace")         = pNamespace
        Set props("Path")              = ..#APPPATH
        Set props("Description")       = "Health Connect Cloud Change Control prototype (static UI)"
        Set props("Enabled")           = 1
        Set props("ServeFiles")        = 1
        ; 0 = no Expires header. Without this the CSP gateway stamps +1h and a
        ; redeploy leaves the user's browser running the previous bundle.
        Set props("ServeFilesTimeout") = 0
        Set props("Recurse")           = 1
        Set props("AutheEnabled")      = 32
        Set props("CookiePath")        = "/"
        ; 2 = never create a session cookie for this application.
        Set props("UseCookies")        = 2
        Set props("CSRFToken")         = 0
        Set props("MatchRoles")        = ":%All"
        Set props("CSPZENEnabled")     = 1

        If ##class(Security.Applications).Exists(..#APPNAME) {
            Set tSC = ##class(Security.Applications).Modify(..#APPNAME, .props)
            If 'tSC { Quit }
            Write !,"  CreateWebApp: ",..#APPNAME," updated"
        } Else {
            Set tSC = ##class(Security.Applications).Create(..#APPNAME, .props)
            If 'tSC { Quit }
            Write !,"  CreateWebApp: ",..#APPNAME," created -> ",pNamespace
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Create or update the /api/hcccicd REST application that serves
/// live change capture.
///
/// Type 2 with AutheEnabled 32, not type 18 — a dispatch-class application on
/// this platform is still a CSP application, and creating it as type 18 leaves
/// it unreachable. No session cookies and no CSRF token: the tool is loaded in
/// an iframe and fetches with credentials, which deadlocks against a CSP
/// session on these routes.
ClassMethod CreateApiApp(pNamespace As %String = "") As %Status
{
    Set tSC = $$$OK
    Try {
        If pNamespace = "" { Set pNamespace = $namespace }
        New $namespace
        Set $namespace = "%SYS"

        Kill props
        Set props("NameSpace")     = pNamespace
        Set props("DispatchClass") = "HCCCICD.REST.Dispatch"
        Set props("Description")   = "Change Control live capture API"
        Set props("Enabled")       = 1
        Set props("AutheEnabled")  = 32
        ; Cookies on, scoped to the whole instance, so an existing
        ; Management Portal or Interoperability editor login authenticates
        ; these calls. The class keeps UseSession=0, so the session is used
        ; to identify the caller and never to hold request state — that
        ; combination is what avoids the iframe fetch deadlock.
        Set props("CookiePath")    = "/"
        Set props("UseCookies")    = 1
        Set props("CSRFToken")     = 0
        Set props("SessionScope")  = 0
        Set props("MatchRoles")    = ":%All"
        Set props("CorsCredentialsAllowed") = 1

        If ##class(Security.Applications).Exists(..#APINAME) {
            Set tSC = ##class(Security.Applications).Modify(..#APINAME, .props)
            If 'tSC { Quit }
            Write !,"  CreateApiApp: ",..#APINAME," updated"
        } Else {
            Set tSC = ##class(Security.Applications).Create(..#APINAME, .props)
            If 'tSC { Quit }
            Write !,"  CreateApiApp: ",..#APINAME," created -> ",pNamespace
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Append the Change Control launcher to the Interoperability
/// editor page. Backs the original up once, then splices the script tag in
/// immediately before the closing body tag with a cache-busting stamp so the
/// browser fetches the freshly deployed launcher on the next reload.
ClassMethod PatchInteropEditor() As %Status
{
    Set tSC = $$$OK
    Try {
        Set path = ..#EDITORHTML
        If '##class(%File).Exists(path) {
            Set tSC = $$$ERROR($$$GeneralError, "Interop editor not found at "_path_". Is this an IRIS for Health instance?")
            Quit
        }

        Set body = ..ReadFile(path, .tSC)
        If 'tSC { Quit }

        If body [ ..#MARKER {
            Write !,"  PatchInteropEditor: already applied"
            Quit
        }

        Set backup = path _ ..#BACKUPSUFFIX
        If '##class(%File).Exists(backup) {
            Set tSC = ##class(%File).CopyFile(path, backup)
            If 'tSC { Quit }
            Write !,"  PatchInteropEditor: backup at ",backup
        }

        Set v = $piece($zhorolog, ".") _ $piece($zhorolog, ".", 2)
        Set tag = "<script src=""/hcccicd/inject.js?v=" _ v _ """ defer></script>"

        Set newBody = $replace(body, "</body>", tag _ "</body>")
        If newBody = body {
            Set tSC = $$$ERROR($$$GeneralError, "No closing body tag in "_path_"; manual review required")
            Quit
        }

        Set tSC = ..WriteFile(path, newBody)
        If 'tSC { Quit }
        Write !,"  PatchInteropEditor: applied to ",path
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Full install.
ClassMethod Apply(pNamespace As %String = "") As %Status
{
    Write !,"HCCCICD.Install.Setup"
    Set tSC = ..CreateWebApp(pNamespace)
    If 'tSC { Quit tSC }
    Set tSC = ..CreateApiApp(pNamespace)
    If 'tSC { Quit tSC }
    Set tSC = ..PatchInteropEditor()
    If 'tSC { Quit tSC }
    Write !,"  Done. Open the Interoperability editor and look for the Change Control tab.",!
    Quit $$$OK
}

/// Description: Remove the editor patch and the web application, leaving the
/// instance as it was before Apply() ran.
ClassMethod Revert(pRemoveWebApp As %Boolean = 1) As %Status
{
    Set tSC = $$$OK
    Try {
        Set path = ..#EDITORHTML
        Set backup = path _ ..#BACKUPSUFFIX

        If ##class(%File).Exists(backup) {
            Set tSC = ##class(%File).CopyFile(backup, path, 1)
            If 'tSC { Quit }
            Write !,"  Revert: editor restored from backup"
        } Else {
            Set body = ..ReadFile(path, .tSC)
            If 'tSC { Quit }
            If body '[ ..#MARKER {
                Write !,"  Revert: editor was not patched"
            } Else {
                Set start = $find(body, "<script src=""/hcccicd/inject.js")
                Set stripped = 0
                If start > 0 {
                    Set start = start - $length("<script src=""/hcccicd/inject.js")
                    Set end = $find(body, "</script>", start)
                    If end > 0 {
                        Set newBody = $extract(body, 1, start - 1) _ $extract(body, end, *)
                        Set tSC = ..WriteFile(path, newBody)
                        If 'tSC { Quit }
                        Set stripped = 1
                        Write !,"  Revert: script tag stripped"
                    }
                }
                If 'stripped { Write !,"  Revert: could not locate the script tag; check ",path }
            }
        }

        If pRemoveWebApp {
            New $namespace
            Set $namespace = "%SYS"
            If ##class(Security.Applications).Exists(..#APPNAME) {
                Set tSC = ##class(Security.Applications).Delete(..#APPNAME)
                If 'tSC { Quit }
                Write !,"  Revert: ",..#APPNAME," removed"
            }
            If ##class(Security.Applications).Exists(..#APINAME) {
                Set tSC = ##class(Security.Applications).Delete(..#APINAME)
                If 'tSC { Quit }
                Write !,"  Revert: ",..#APINAME," removed"
            }
        }
        Write !
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Report what is installed. Safe to run at any time.
ClassMethod Status() As %Status
{
    Set tSC = $$$OK
    Try {
        Write !,"HCCCICD Change Control — status",!

        New $namespace
        Set $namespace = "%SYS"
        If ##class(Security.Applications).Exists(..#APPNAME) {
            Do ##class(Security.Applications).Get(..#APPNAME, .p)
            Write "  web application  : ",..#APPNAME," -> ",$get(p("NameSpace"))," (",$get(p("Path")),")",!
        } Else {
            Write "  web application  : not installed",!
        }
        If ##class(Security.Applications).Exists(..#APINAME) {
            Do ##class(Security.Applications).Get(..#APINAME, .a)
            Write "  live capture api : ",..#APINAME," -> ",$get(a("NameSpace")),!
        } Else {
            Write "  live capture api : not installed",!
        }

        Set exists = ##class(%File).Exists(..#EDITORHTML)
        If 'exists {
            Write "  interop editor   : not present on this instance",!
        } Else {
            Set body = ..ReadFile(..#EDITORHTML, .tSC)
            If 'tSC { Quit }
            Write "  interop editor   : ",$select(body [ ..#MARKER : "patched", 1 : "not patched"),!
        }

        Set n = 0
        Set dir = ..#APPPATH
        If ##class(%File).DirectoryExists(dir) {
            Set rs = ##class(%File).FileSetFunc(dir, "*.*", , 1)
            While rs.%Next() { Set n = n + 1 }
        }
        Write "  static files     : ",n," under ",dir,!!
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Description: Read a whole text file into a string.
ClassMethod ReadFile(pPath As %String, Output pSC As %Status) As %String [ Internal ]
{
    Set pSC = $$$OK
    Set out = ""
    Try {
        Set fs = ##class(%Stream.FileCharacter).%New()
        Set pSC = fs.LinkToFile(pPath)
        If 'pSC { Quit }
        Do fs.Rewind()
        While 'fs.AtEnd { Set out = out _ fs.Read(32768) }
    } Catch ex {
        Set pSC = ex.AsStatus()
    }
    Quit out
}

/// Description: Replace a text file's contents.
ClassMethod WriteFile(pPath As %String, pBody As %String) As %Status [ Internal ]
{
    Set tSC = $$$OK
    Try {
        Set out = ##class(%Stream.FileCharacter).%New()
        Set tSC = out.LinkToFile(pPath)
        If 'tSC { Quit }
        Do out.Clear()
        Do out.Write(pBody)
        Set tSC = out.%Save()
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
