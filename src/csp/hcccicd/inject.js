/* Change Control — launcher for the IRIS for Health Interoperability editor.
 *
 * Adds a single "Change Control" tab to the editor's dashboard strip and opens
 * the tool full-screen in an overlay. Deliberately standalone: it shares no
 * identifiers, styles or state with the Agentic Integration Builder's own
 * inject.js, so both can be loaded on the same page and either can be removed
 * without touching the other.
 *
 * Loaded by HCCCICD.Install.Setup, which appends a <script> tag to
 * /usr/irissys/ui/interop/interop-editor/index.html.
 */
(function () {
'use strict';

if (window.__hccCicdInject) return;
window.__hccCicdInject = true;

var TAB_MARK   = 'hcccicd-tab';
var OVERLAY_ID = 'hcccicd-overlay';
var STYLE_ID   = 'hcccicd-inject-styles';
var BAR_ID     = 'hcccicd-bar';
var GUIDE_ID   = 'hcccicd-guide';
var APP        = '/hcccicd/index.html';
var API        = '/api/hcccicd';
var SEEN_KEY   = 'hcccicd.guide.seen';

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
    '.dashboard .navbuttons.' + TAB_MARK + ' {',
    '  display:flex; flex:0 1 auto;',
    '  margin:5px; height:32px; box-sizing:border-box;',
    '  background:#0f766e; border:1px solid #0f766e; border-radius:4px;',
    '  cursor:pointer; align-items:center;',
    '}',
    '.dashboard .navbuttons.' + TAB_MARK + ':hover { background:#0d9488; border-color:#0d9488; }',
    '.dashboard .navbuttons.' + TAB_MARK + ' .hcccicd-tab-inner {',
    '  display:flex; align-items:center; gap:7px;',
    '  padding:0 12px; color:#fff; font-size:13px; font-weight:500; white-space:nowrap;',
    '}',
    '.dashboard .navbuttons.' + TAB_MARK + ' .hcccicd-tab-inner svg { width:18px; height:18px; }',
    '.dashboard .navbuttons.' + TAB_MARK + '.is-active { background:#115e59; border-color:#115e59; }',

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
    '  width:8px; height:8px; border-radius:50%; background:#8b93a1; flex:0 0 auto;',
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
  return fetch(API + '/state', { credentials: 'include' })
    .then(function (r) {
      if (r.status === 401 || r.status === 403) { STATE.auth = false; return null; }
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (!j) return;
      STATE.known = true;
      STATE.auth = true;
      STATE.open = !!j.workspace;
      STATE.ref = j.workspace ? j.workspace.ref : '';
      STATE.items = (j.changes || []).length;
      STATE.orphans = (j.orphans || []).length;
      paint();
    })
    .catch(function () { });
}

function paint() {
  paintTab();
  paintBar();
}

/* ---------------- reminder bar ---------------- */

function buildBar() {
  if (document.getElementById(BAR_ID)) return;
  injectStyles();
  var bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.innerHTML =
    '<span class="msg"></span>' +
    '<button type="button" class="why">What is this?</button>' +
    '<button type="button" class="act primary">Start a change</button>';
  document.body.appendChild(bar);
  bar.querySelector('.why').addEventListener('click', function () { showGuide(true); });
  bar.querySelector('.act').addEventListener('click', function () { open('start'); });
}

function paintBar() {
  buildBar();
  var bar = document.getElementById(BAR_ID);
  if (!STATE.known) { bar.classList.remove('show'); return; }

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

function ensureTab() {
  var dash = document.querySelector('.dashboard');
  if (!dash) return;
  if (dash.querySelector('.' + TAB_MARK)) return;
  injectStyles();
  var tab = document.createElement('div');
  tab.className = 'navbuttons ' + TAB_MARK;
  tab.innerHTML =
    '<div class="hcccicd-tab-inner">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">' +
      '<path d="M6 3a2.5 2.5 0 0 0-.9 4.83v4.34a2.5 2.5 0 1 0 1.8 0V7.83A2.5 2.5 0 0 0 6 3zm8 0a2.5 2.5 0 0 0-.9 4.83A3.6 3.6 0 0 1 9.9 11H8.6v1.8h1.3a5.4 5.4 0 0 0 5-3.02A2.5 2.5 0 0 0 14 3z" fill="#fff"/>' +
      '</svg>' +
      '<span>Change Control</span>' +
      '<span class="hcccicd-dot"></span>' +
    '</div>';
  tab.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    open();
  });
  dash.appendChild(tab);
  paintTab();
}

/* Green when a change is open, amber when nothing is started. The tab is on
 * screen the whole time the user is building, so it is the cheapest possible
 * place to answer "am I covered right now?". */
function paintTab() {
  var dot = document.querySelector('.' + TAB_MARK + ' .hcccicd-dot');
  if (!dot) return;
  dot.className = 'hcccicd-dot' + (STATE.known ? (STATE.open ? ' on' : ' off') : '');
  var tab = document.querySelector('.' + TAB_MARK);
  if (tab) {
    tab.title = !STATE.known ? 'Change Control'
      : STATE.open ? 'Working on ' + STATE.ref + ' — ' + STATE.items + ' items captured'
      : 'No change started. Start one before you build anything.';
  }
}

/* The editor is an Angular single-page app that re-renders its chrome on
 * navigation, so the tab has to be re-asserted rather than added once. */
var pending = null;
function schedule() {
  if (pending) return;
  pending = setTimeout(function () { pending = null; ensureTab(); }, 150);
}

function start() {
  ensureTab();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  /* Read the current state, then guide. The guide only appears when there is
   * genuinely nothing started — somebody mid-change is not interrupted. */
  poll().then(function () {
    if (STATE.known && !STATE.open) showGuide(false);
  });

  /* The user may start or abandon a change in another tab. */
  setInterval(poll, 20000);
  window.addEventListener('focus', poll);

  /* The tool posts this the moment a change is started or abandoned, so the
   * bar and the dot update without waiting for the next poll. */
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d && d.type === 'hcccicd:state-changed') poll();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

})();
