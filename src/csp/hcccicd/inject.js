/* Change Control — launcher for the IRIS for Health Interoperability editor.
 *
 * Adds a "Change Control" icon button to the editor's dashboard strip and opens
 * the tool full-screen in an overlay. Standalone: it shares no state with the
 * Agentic Integration Builder's inject.js. The only thing both share is the
 * toolbar group (class isc-editor-tools, buttons isc-tool-btn, tooltip
 * #isc-tool-tip), so their icons sit together; whichever script loads first
 * builds the group, and either can be removed without touching the other.
 *
 * Loaded by HCCCICD.Install.Setup, which appends a <script> tag to
 * /usr/irissys/ui/interop/interop-editor/index.html.
 */
(function () {
'use strict';

if (window.__hccCicdInject) return;
window.__hccCicdInject = true;

var TAB_MARK   = 'hcccicd-tab';
var TOOLS_GROUP = 'isc-editor-tools';   // shared with the Agentic Integration Builder
var TOOL_BTN    = 'isc-tool-btn';
var TIP_ID      = 'isc-tool-tip';
var OVERLAY_ID = 'hcccicd-overlay';
var STYLE_ID   = 'hcccicd-inject-styles';
var BAR_ID     = 'hcccicd-bar';
var GUIDE_ID   = 'hcccicd-guide';
var APP        = '/hcccicd/index.html';
var API        = '/api/hcccicd';
var SEEN_KEY   = 'hcccicd.guide.seen';
var LOGIN_CLASS = 'hcccicd-login-mode';

/* The Interoperability editor authenticates its own API calls with a JSON Web
 * Token, and IRIS will accept that same token for /api/hcccicd because the two
 * applications share GroupById=%ISCMgtPortal. There is no supported way to ask
 * the editor for the token, so we watch it go past: every fetch and every
 * XMLHttpRequest the page makes is inspected for an Authorization header, and
 * the most recent one is reused.
 *
 * This is how the user gets identified as themselves instead of UnknownUser. */
var AUTH = { bearer: '', exp: 0 };

function noteBearer(v) {
  if (typeof v !== 'string' || v.indexOf('Bearer ') !== 0) return;
  AUTH.bearer = v;
  try {
    var parts = v.replace(/^Bearer\s+/i, '').split('.');
    if (parts.length === 3) {
      AUTH.exp = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0;
    }
  } catch (e) { AUTH.exp = 0; }
}

function scanHeaders(h) {
  try {
    if (!h) return;
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      noteBearer(h.get('Authorization') || h.get('authorization'));
    } else if (Array.isArray(h)) {
      for (var i = 0; i < h.length; i++) {
        if (Array.isArray(h[i]) && /^authorization$/i.test(h[i][0])) noteBearer(h[i][1]);
      }
    } else if (typeof h === 'object') {
      noteBearer(h.Authorization || h.authorization);
    }
  } catch (e) { }
}

var origFetch = window.fetch;
window.fetch = function (input, init) {
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) scanHeaders(input.headers);
    if (init && init.headers) scanHeaders(init.headers);
  } catch (e) { }
  return origFetch.apply(this, arguments);
};

var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  try { if (/^authorization$/i.test(name)) noteBearer(value); } catch (e) { }
  return origSetHeader.apply(this, arguments);
};

/* Nudge the editor into making a call, so its HTTP interceptor mints a token
 * we can observe. Needed on a cold load where nothing has been requested yet. */
function primeBearer() {
  if (AUTH.bearer) return Promise.resolve();
  return origFetch('/api/interop-editor/v1/' + (currentNamespace() || '') + '/productions',
                   { credentials: 'include' })
    .then(function () { }, function () { });
}

/* Headers for our own calls: the token if we have one, and always the
 * namespace the user has selected in the editor. */
function authHeaders() {
  var h = {};
  if (AUTH.bearer) h['Authorization'] = AUTH.bearer;
  var ns = currentNamespace();
  if (ns) h['X-IRIS-Namespace'] = ns;
  return h;
}

/* Whether this user currently has a change open. Polled, because the editor
 * and the tool are separate pages and either can change it. */
var STATE = { known: false, open: false, ref: '', items: 0, auth: true };

/* The Interop editor carries the namespace on the query string. Pass it
 * through so the tool's header shows the namespace the user is actually
 * looking at rather than the REST endpoint's default. */
function currentNamespace() {
  try {
    var p = new URLSearchParams(window.location.search);
    return p.get('$NAMESPACE') || p.get('%24NAMESPACE') || '';
  } catch (e) { return ''; }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  var s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = [
    /* Editor toolbar group, identical to the rules in the Agentic
     * Integration Builder's inject.js, so the icons look the same whichever
     * add-on built the group. */
    '.dashboard .' + TOOLS_GROUP + ' {',
    '  display:flex; align-items:center; gap:4px; flex:0 0 auto;',
    '  margin:4px 10px 4px auto; padding-left:10px; border-left:1px solid #e4e7ec;',
    '}',
    '.' + TOOL_BTN + ' {',
    '  position:relative; width:34px; height:30px; padding:0; box-sizing:border-box;',
    '  display:inline-flex; align-items:center; justify-content:center;',
    '  background:#fff; color:#475467; border:1px solid #d0d5dd; border-radius:7px;',
    '  cursor:pointer; transition:background .12s, border-color .12s, color .12s;',
    '}',
    '.' + TOOL_BTN + ':hover { background:#f2f4f7; border-color:#98a2b3; color:#101828; }',
    '.' + TOOL_BTN + ':focus-visible { outline:2px solid #2f6fed; outline-offset:1px; }',
    '.' + TOOL_BTN + ' svg { width:18px; height:18px; display:block; }',
    '.' + TOOL_BTN + '.is-active { background:#101828; border-color:#101828; color:#fff; }',
    '#' + TIP_ID + ' {',
    '  position:fixed; z-index:100001; display:none; max-width:300px;',
    '  padding:7px 10px; border-radius:7px; background:#101828; color:#fff;',
    '  font:500 12.5px/1.45 -apple-system,"Noto Sans",system-ui,sans-serif;',
    '  box-shadow:0 6px 18px rgba(16,24,40,.25); pointer-events:none; white-space:normal;',
    '}',
    '#' + TIP_ID + ' b { display:block; font-weight:650; margin-bottom:2px; }',

    '#' + OVERLAY_ID + ' { position:fixed; inset:0; z-index:99998; background:#0b0d11; display:none; }',
    '#' + OVERLAY_ID + '.open { display:flex; flex-direction:column; }',
    '#' + OVERLAY_ID + ' .bar {',
    '  flex:0 0 auto; display:flex; align-items:center; gap:12px;',
    '  padding:10px 16px; background:#10141a; border-bottom:1px solid #1c2128;',
    '  color:#e6e8eb; font:600 13.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '}',
    '#' + OVERLAY_ID + ' .bar span { flex:1; }',
    '#' + OVERLAY_ID + ' .bar .close {',
    '  background:none; border:0; color:#8b93a1; font-size:15px; line-height:1;',
    '  cursor:pointer; padding:4px 9px; border-radius:5px;',
    '}',
    '#' + OVERLAY_ID + ' .bar .close:hover { background:rgba(255,255,255,0.14); color:#e6e8eb; }',
    '#' + OVERLAY_ID + ' iframe { flex:1; width:100%; border:0; background:#0b0d11; }',

    /* ---- status dot on the tab ---- */
    '.' + TAB_MARK + ' .hcccicd-dot {',
    '  position:absolute; top:3px; right:3px; width:7px; height:7px; border-radius:50%;',
    '  background:#8b93a1; border:1.5px solid #fff; box-sizing:content-box;',
    '}',
    '.' + TAB_MARK + ' .hcccicd-dot.on  { background:#34d399; }',
    '.' + TAB_MARK + ' .hcccicd-dot.off { background:#fbbf24; }',

    /* ---- persistent reminder bar ---- */
    '#' + BAR_ID + ' {',
    '  position:fixed; left:0; right:0; bottom:0; z-index:99997;',
    '  display:none; align-items:center; gap:14px;',
    '  padding:11px 20px;',
    '  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '  border-top:1px solid #92400e; background:#221708; color:#fde3b0;',
    '  box-shadow:0 -6px 22px rgba(0,0,0,.35);',
    '}',
    '#' + BAR_ID + '.show { display:flex; }',
    '#' + BAR_ID + '.ok { border-top-color:#065f46; background:#0c1c17; color:#a7f3d0; }',
    '#' + BAR_ID + ' .msg { flex:1; }',
    '#' + BAR_ID + ' .msg b { color:#fff; font-weight:600; }',
    '#' + BAR_ID + ' button {',
    '  border:1px solid rgba(255,255,255,.28); background:rgba(255,255,255,.10);',
    '  color:inherit; font:inherit; font-size:13px; padding:6px 14px;',
    '  border-radius:6px; cursor:pointer; white-space:nowrap;',
    '}',
    '#' + BAR_ID + ' button:hover { background:rgba(255,255,255,.18); }',
    '#' + BAR_ID + ' button.primary { background:#d97706; border-color:#d97706; color:#fff; }',
    '#' + BAR_ID + ' button.primary:hover { background:#f59e0b; }',
    '#' + BAR_ID + '.ok button.primary { background:#059669; border-color:#059669; }',
    '#' + BAR_ID + ' button.close { background:transparent; border-color:transparent; font-size:18px; line-height:1; padding:2px 8px; opacity:.75; }',
    '#' + BAR_ID + ' button.close:hover { opacity:1; background:rgba(255,255,255,.12); }',

    /* ---- first-visit guide ---- */
    '#' + GUIDE_ID + ' {',
    '  position:fixed; inset:0; z-index:99999; display:none;',
    '  align-items:center; justify-content:center; padding:30px;',
    '  background:rgba(0,0,0,.66);',
    '  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '}',
    '#' + GUIDE_ID + '.show { display:flex; }',
    '#' + GUIDE_ID + ' .box {',
    '  background:#10141a; border:1px solid #2a313c; border-radius:11px;',
    '  width:100%; max-width:660px; color:#e6e8eb; overflow:hidden;',
    '}',
    '#' + GUIDE_ID + ' .box header {',
    '  padding:16px 22px; border-bottom:1px solid #1c2128;',
    '  font-size:16px; font-weight:600;',
    '}',
    '#' + GUIDE_ID + ' .box .body { padding:20px 22px; }',
    '#' + GUIDE_ID + ' .lede { margin:0 0 18px; font-size:14px; }',
    '#' + GUIDE_ID + ' .lede b { color:#fcd34d; }',
    '#' + GUIDE_ID + ' ol { margin:0; padding:0 0 0 20px; }',
    '#' + GUIDE_ID + ' li { margin-bottom:13px; font-size:13.5px; color:#8b93a1; }',
    '#' + GUIDE_ID + ' li b { color:#e6e8eb; font-weight:600; }',
    '#' + GUIDE_ID + ' .warnbox {',
    '  margin:18px 0 0; padding:12px 15px; border-radius:7px;',
    '  border:1px solid #92400e; background:rgba(217,119,6,.08);',
    '  font-size:13px; color:#8b93a1;',
    '}',
    '#' + GUIDE_ID + ' .warnbox b { color:#fcd34d; }',
    '#' + GUIDE_ID + ' .box footer {',
    '  display:flex; align-items:center; gap:10px;',
    '  padding:14px 22px; border-top:1px solid #1c2128;',
    '}',
    '#' + GUIDE_ID + ' .box footer .sp { flex:1; }',

    /* Login screen: nothing of ours exists. The class is toggled on every
       re-render; this rule is what makes the suppression instant rather than
       one paint behind. */
    'body.' + LOGIN_CLASS + ' .' + TAB_MARK + ',',
    'body.' + LOGIN_CLASS + ' #' + BAR_ID + ',',
    'body.' + LOGIN_CLASS + ' #' + GUIDE_ID + ',',
    'body.' + LOGIN_CLASS + ' #' + OVERLAY_ID + ' { display:none !important; }',
    '#' + GUIDE_ID + ' .box footer button {',
    '  border:1px solid #2a313c; background:#1a2029; color:#e6e8eb;',
    '  font:inherit; font-size:13px; padding:8px 16px; border-radius:6px; cursor:pointer;',
    '}',
    '#' + GUIDE_ID + ' .box footer button:hover { background:#232b36; }',
    '#' + GUIDE_ID + ' .box footer button.primary { background:#4f46e5; border-color:#4f46e5; }',
    '#' + GUIDE_ID + ' .box footer button.primary:hover { background:#6d64f0; }',
    '#' + GUIDE_ID + ' .again { display:flex; align-items:center; gap:7px; font-size:12.5px; color:#8b93a1; }'
  ].join('\n');
  document.head.appendChild(s);
}

/* ---------------- state ---------------- */

function poll() {
  return origFetch(API + '/state', { credentials: 'include', headers: authHeaders() })
    .then(function (r) {
      if (r.status === 401 || r.status === 403) { STATE.auth = false; return null; }
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j) {
        /* No longer identified — a logout, an expired token, or the login
         * screen. Forget everything: anything we keep showing from here is a
         * statement about a session that no longer exists. */
        STATE.known = false;
        STATE.open = false;
        STATE.ref = '';
        STATE.items = 0;
        STATE.orphans = 0;
      } else {
        STATE.known = true;
        STATE.auth = true;
        STATE.open = !!j.workspace;
        STATE.ref = j.workspace ? j.workspace.ref : '';
        STATE.items = (j.changes || []).length;
        STATE.orphans = (j.orphans || []).length;
      }
      paint();
    })
    .catch(function () { paint(); });
}

/* The editor and its login screen are the same document — Angular swaps the
 * content in place — so "am I on the login page?" has to be re-answered on
 * every re-render, not once at load. A visible password field means not signed
 * in; so does the absence of the dashboard strip the editor always renders.
 *
 * Nothing of ours may appear before the user is through: no tab, no bar, and
 * above all no guide telling a signed-out person to start a change. */
function onLoginScreen() {
  return !document.querySelector('.dashboard') ||
         !!document.querySelector('input[type="password"]:not([hidden])');
}

function paint() {
  var login = onLoginScreen();
  document.body.classList.toggle(LOGIN_CLASS, login);
  if (login) {
    /* Take our elements out of the document entirely rather than styling them
     * away. Two earlier attempts failed here: removing a CSS class does
     * nothing on the login screen, because the stylesheet is only injected
     * alongside the tab and the tab is never built there — so the class it
     * keys on does not exist. Removal cannot fail that way.
     *
     * buildBar and buildGuide recreate these on demand, so this costs nothing
     * once the user is through. */
    [BAR_ID, GUIDE_ID, OVERLAY_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    var t = document.querySelector('.' + TAB_MARK);
    if (t && t.parentNode) t.parentNode.removeChild(t);
    barSig = ''; tabSig = '';
    return;
  }
  paintTab();
  paintBar();
}

/* ---------------- reminder bar ---------------- */

function buildBar() {
  /* Rebuilt from scratch after a login screen removed it. */
  if (document.getElementById(BAR_ID)) return;
  injectStyles();
  var bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.innerHTML =
    '<span class="msg"></span>' +
    '<button type="button" class="why">What is this?</button>' +
    '<button type="button" class="act primary">Start a change</button>' +
    '<button type="button" class="close" aria-label="Dismiss this reminder" title="Dismiss — it returns only when something changes">&times;</button>';
  document.body.appendChild(bar);
  bar.querySelector('.why').addEventListener('click', function () { showGuide(true); });
  bar.querySelector('.act').addEventListener('click', function () { open('start'); });
  bar.querySelector('.close').addEventListener('click', function () {
    /* Remember what the bar said when it was dismissed. It stays hidden for
     * this browser session until the state changes (a change is started, or
     * the number of waiting items changes); the Change Control tab remains. */
    try { sessionStorage.setItem(DISMISS_KEY, currentBarSig()); } catch (e) {}
    barSig = '';
    paintBar();
  });
}

var DISMISS_KEY = 'hcccicd.bar.dismissed';

function currentBarSig() {
  return [STATE.open ? 'open' : 'none', STATE.ref, STATE.items, STATE.orphans].join('|');
}

function dismissedSig() {
  try { return sessionStorage.getItem(DISMISS_KEY) || ''; } catch (e) { return ''; }
}

/* Signature of what the bar currently says. Rewriting identical markup is not
 * free: this function runs from a MutationObserver, so every write schedules
 * another call, and the Agentic Integration Builder's launcher observes the
 * same document and rebuilds its own toolbar buttons on each one. That loop is
 * what stopped Clean Productions and Delete Artifacts responding — their click
 * handlers were being torn off and reattached continuously. */
var barSig = '';

function paintBar() {
  buildBar();
  var bar = document.getElementById(BAR_ID);
  if (!STATE.known) {
    if (barSig !== 'hidden') { barSig = 'hidden'; bar.classList.remove('show'); }
    return;
  }

  var sig = currentBarSig();
  if (sig === dismissedSig()) {
    /* Dismissed by the user for exactly this state. */
    if (barSig !== 'dismissed') { barSig = 'dismissed'; bar.classList.remove('show'); }
    return;
  }
  if (sig === barSig) return;
  barSig = sig;

  if (!STATE.open) {
    bar.classList.add('show');
    bar.classList.remove('ok');
    bar.querySelector('.msg').innerHTML =
      '<b>You have not started a change.</b> Start one before you build anything — ' +
      'it is what keeps your work separate from everyone else\'s and lets you send it ' +
      'to Test when you are done.' +
      (STATE.orphans
        ? ' You already have ' + STATE.orphans + ' item' + (STATE.orphans === 1 ? '' : 's') +
          ' waiting to be put into one.'
        : '');
    bar.querySelector('.act').textContent = STATE.orphans ? 'Sort this out' : 'Start a change';
    bar.querySelector('.why').style.display = '';
  } else {
    bar.classList.add('show', 'ok');
    bar.querySelector('.msg').innerHTML =
      'Working on <b>' + esc(STATE.ref) + '</b> — ' + STATE.items + ' item' +
      (STATE.items === 1 ? '' : 's') + ' captured so far. Everything you save is ' +
      'being versioned automatically.';
    bar.querySelector('.act').textContent = 'Open Change Control';
    bar.querySelector('.why').style.display = 'none';
  }
}

/* ---------------- first-visit guide ---------------- */

function buildGuide() {
  if (document.getElementById(GUIDE_ID)) return;
  injectStyles();
  var g = document.createElement('div');
  g.id = GUIDE_ID;
  g.innerHTML =
    '<div class="box">' +
      '<header>Before you change anything</header>' +
      '<div class="body">' +
        '<p class="lede">Your work in this editor is tracked, and you get to send it ' +
        'to Test and Production yourself. <b>There is one thing to do first.</b></p>' +
        '<ol>' +
          '<li><b>Start a change.</b> Give it your ticket reference and one line saying ' +
             'what you are about to do. You get your own private copy of the ' +
             'configuration, and the items you touch are held so nobody else can edit ' +
             'them at the same time.</li>' +
          '<li><b>Then build, exactly as you do today.</b> Productions, business hosts, ' +
             'transformations, rules, lookup tables — every save is captured and given a ' +
             'version on its own. There is nothing to export and nothing to remember.</li>' +
          '<li><b>Send it forward when you are ready.</b> Describe what you did, tick what ' +
             'goes, and the safety check tells you what you forgot before it reaches ' +
             'the next environment.</li>' +
        '</ol>' +
        '<div class="warnbox"><b>If you have already built something</b> — nothing is ' +
        'lost. It was all captured anyway. Open Change Control and it will offer to put ' +
        'that work into a change for you.</div>' +
      '</div>' +
      '<footer>' +
        '<label class="again"><input type="checkbox" class="hide"> Do not show this again</label>' +
        '<span class="sp"></span>' +
        '<button type="button" class="later">Later</button>' +
        '<button type="button" class="go primary">Start a change now</button>' +
      '</footer>' +
    '</div>';
  document.body.appendChild(g);

  g.querySelector('.later').addEventListener('click', function () { hideGuide(g); });
  g.querySelector('.go').addEventListener('click', function () {
    hideGuide(g);
    open('start');
  });
  g.addEventListener('click', function (e) { if (e.target === g) hideGuide(g); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && g.classList.contains('show')) hideGuide(g);
  });
}

function hideGuide(g) {
  if (g.querySelector('.hide').checked) {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { }
  }
  g.classList.remove('show');
}

function showGuide(force) {
  if (onLoginScreen()) return;
  buildGuide();
  if (!force) {
    var seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { }
    if (seen) return;
  }
  document.getElementById(GUIDE_ID).classList.add('show');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOverlay() {
  if (document.getElementById(OVERLAY_ID)) return;
  var o = document.createElement('div');
  o.id = OVERLAY_ID;
  o.innerHTML =
    '<div class="bar"><span>Change Control</span>' +
    '<button class="close" type="button" title="Close">✕</button></div>' +
    '<iframe src="about:blank" title="Change Control"></iframe>';
  document.body.appendChild(o);
  o.querySelector('.close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && o.classList.contains('open')) close();
  });
}

function open(focus) {
  buildOverlay();
  var o = document.getElementById(OVERLAY_ID);
  var f = o.querySelector('iframe');
  /* Load once per session so a half-filled change request is not wiped by a
   * stray re-render of the host Angular page. Opening explicitly to start a
   * change is the exception — that must always land on the form. */
  if (!f.src || f.src === 'about:blank' || focus === 'start') {
    var ns = currentNamespace();
    f.src = APP + '?live=1&t=' + Date.now() +
            (ns ? '&ns=' + encodeURIComponent(ns) : '') +
            (focus ? '&focus=' + focus : '');
  }
  /* The tool calls the same API and needs the same credentials. It asks for
   * them on boot; answer unprompted too, in case it booted before we looked. */
  if (f.contentWindow) {
    try {
      f.contentWindow.postMessage(
        { type: 'hcccicd:auth', bearer: AUTH.bearer, namespace: ns }, '*');
    } catch (e) { }
  }
  o.classList.add('open');
  var tab = document.querySelector('.' + TAB_MARK);
  if (tab) tab.classList.add('is-active');
}

function close() {
  var o = document.getElementById(OVERLAY_ID);
  if (!o) return;
  o.classList.remove('open');
  var tab = document.querySelector('.' + TAB_MARK);
  if (tab) tab.classList.remove('is-active');
  /* The user may have started or abandoned a change in there. */
  poll();
}

/* The icon group at the right end of .dashboard, shared with the Agentic
 * Integration Builder. Created here if that add-on has not built it yet. */
function toolsGroup(dash) {
  var g = dash.querySelector('.' + TOOLS_GROUP);
  if (!g) {
    g = document.createElement('div');
    g.className = TOOLS_GROUP;
    g.setAttribute('role', 'toolbar');
    g.setAttribute('aria-label', 'Add-on tools');
    dash.appendChild(g);
  }
  return g;
}

/* Tooltip on <body>: .dashboard scrolls horizontally and would clip it. */
function showTip(el) {
  var t = document.getElementById(TIP_ID);
  if (!t) { t = document.createElement('div'); t.id = TIP_ID; t.setAttribute('role', 'tooltip'); document.body.appendChild(t); }
  t.innerHTML = '<b>Change Control</b>' + esc(el.getAttribute('data-tip') || '');
  t.style.display = 'block';
  var r = el.getBoundingClientRect();
  var w = t.offsetWidth;
  t.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  t.style.top = (r.bottom + 6) + 'px';
}
function hideTip() {
  var t = document.getElementById(TIP_ID);
  if (t) t.style.display = 'none';
}

function ensureTab() {
  if (onLoginScreen()) return;
  var dash = document.querySelector('.dashboard');
  if (!dash) return;
  if (dash.querySelector('.' + TAB_MARK)) return;
  injectStyles();
  var tab = document.createElement('button');
  tab.type = 'button';
  tab.className = TOOL_BTN + ' ' + TAB_MARK;
  tab.style.order = 20;
  tab.setAttribute('aria-label', 'Change Control');
  tab.setAttribute('data-tip', 'Track what you build in this namespace as a change you can review and deploy.');
  tab.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true">' +
    '<path fill="currentColor" d="M6 3a2.5 2.5 0 0 0-.9 4.83v4.34a2.5 2.5 0 1 0 1.8 0V7.83A2.5 2.5 0 0 0 6 3zm8 0a2.5 2.5 0 0 0-.9 4.83A3.6 3.6 0 0 1 9.9 11H8.6v1.8h1.3a5.4 5.4 0 0 0 5-3.02A2.5 2.5 0 0 0 14 3z"/>' +
    '</svg>' +
    '<span class="hcccicd-dot"></span>';
  tab.addEventListener('mouseenter', function () { showTip(tab); });
  tab.addEventListener('focus', function () { showTip(tab); });
  tab.addEventListener('mouseleave', hideTip);
  tab.addEventListener('blur', hideTip);
  tab.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    hideTip();
    open();
  });
  toolsGroup(dash).appendChild(tab);
  tabSig = '';
  paintTab();
}

/* Green when a change is open, amber when nothing is started. The tab is on
 * screen the whole time the user is building, so it is the cheapest possible
 * place to answer "am I covered right now?". */
var tabSig = '';

function paintTab() {
  var dot = document.querySelector('.' + TAB_MARK + ' .hcccicd-dot');
  if (!dot) return;
  var sig = [STATE.known, STATE.open, STATE.ref, STATE.items].join('|');
  if (sig === tabSig) return;
  tabSig = sig;
  dot.className = 'hcccicd-dot' + (STATE.known ? (STATE.open ? ' on' : ' off') : '');
  var tab = document.querySelector('.' + TAB_MARK);
  if (tab) {
    tab.setAttribute('data-tip', !STATE.known
      ? 'Track what you build in this namespace as a change you can review and deploy.'
      : STATE.open ? 'Working on ' + STATE.ref + ': ' + STATE.items + ' items captured.'
      : 'No change started. Start one before you build anything.');
  }
}

/* The editor is an Angular single-page app that re-renders its chrome on
 * navigation, so the tab has to be re-asserted rather than added once. */
var pending = null;
function schedule() {
  if (pending) return;
  pending = setTimeout(function () {
    pending = null;
    /* Angular swaps login and editor in place, so this is the only reliable
     * moment to notice which one is on screen. */
    if (onLoginScreen()) { paint(); return; }
    ensureTab();
    paint();
  }, 150);
}

function start() {
  paint();
  ensureTab();

  /* Ignore mutations inside our own elements. Combined with the signature
   * checks above this makes the observer quiet: it fires when the editor
   * re-renders, not when we paint. */
  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var t = records[i].target;
      if (t && t.closest && t.closest('#' + BAR_ID + ',#' + GUIDE_ID + ',#' + OVERLAY_ID + ',.' + TAB_MARK)) {
        continue;
      }
      schedule();
      return;
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* Read the current state, then guide. The guide only appears when there is
   * genuinely nothing started — somebody mid-change is not interrupted. */
  /* Wait for the editor proper before offering any guidance. On a cold load
   * the login screen is what renders first, and firing here is exactly the bug
   * that put "start a change" in front of a signed-out user. */
  var waited = 0;
  (function awaitEditor() {
    if (onLoginScreen()) {
      if ((waited += 400) > 120000) return;
      setTimeout(awaitEditor, 400);
      return;
    }
    primeBearer().then(poll).then(function () {
      if (STATE.known && !STATE.open && !onLoginScreen()) showGuide(false);
    });
  })();

  /* The user may start or abandon a change in another tab. */
  setInterval(poll, 20000);
  window.addEventListener('focus', poll);

  /* The tool posts this the moment a change is started or abandoned, so the
   * bar and the dot update without waiting for the next poll. */
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (!d) return;
    if (d.type === 'hcccicd:state-changed') poll();
    if (d.type === 'hcccicd:need-auth' && e.source) {
      primeBearer().then(function () {
        try {
          e.source.postMessage({ type: 'hcccicd:auth', bearer: AUTH.bearer,
                                 namespace: currentNamespace() }, '*');
        } catch (err) { }
      });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

})();
