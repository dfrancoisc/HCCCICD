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
var APP        = '/hcccicd/index.html';

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
    '#' + OVERLAY_ID + ' iframe { flex:1; width:100%; border:0; background:#0b0d11; }'
  ].join('\n');
  document.head.appendChild(s);
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

function open() {
  buildOverlay();
  var o = document.getElementById(OVERLAY_ID);
  var f = o.querySelector('iframe');
  /* Load once per session so a half-filled change request is not wiped by a
   * stray re-render of the host Angular page. */
  if (!f.src || f.src === 'about:blank') {
    var ns = currentNamespace();
    f.src = APP + '?t=' + Date.now() + (ns ? '&ns=' + encodeURIComponent(ns) : '');
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
    '</div>';
  tab.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    open();
  });
  dash.appendChild(tab);
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

})();
