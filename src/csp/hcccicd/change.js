/* Change Control — a promotion tool for the Integration Builder persona.
 *
 * WHAT THIS IS
 * ------------
 * A working user-experience prototype. Every screen, interaction and rule is
 * real; the data behind it comes from the MOCK block below rather than from
 * IRIS. The one live call is /api/agentic/whoami, so the header shows the
 * actual signed-in user and namespace.
 *
 * The persona is an Integration Builder working in Health Connect Cloud. They
 * are not a developer. They have no shell, no file-server access and no Git
 * client, and the words "branch", "commit", "rebase" and "merge request" mean
 * nothing to them. So the interface never uses those words in the main flow —
 * it says "start a change", "what I changed", "send forward". The Git and
 * pipeline vocabulary is one toggle away for anyone who wants it, and every
 * screen carries a "behind the scenes" note that names the real mechanism.
 *
 * The model underneath is the documented Health Connect Cloud Embedded Git
 * workflow: feature branch off live, work in a personal user namespace,
 * automatic export on save, merge request per environment, CI/CD deploys into
 * the protected namespace. See docs/CHANGE_CONTROL.md.
 *
 * TO MAKE IT REAL
 * ---------------
 * Replace the functions in the DATA block. Each one is marked with the IRIS or
 * Embedded Git call that would back it. Nothing above the DATA block knows
 * where the data came from.
 */
(function () {
'use strict';

/* =====================================================================
 * 1. MOCK DATA
 * ===================================================================== */

/* The promotion path. In a real deployment this is administrator
 * configuration, held in a persistent class and edited on the Environments
 * screen. Order defines the route; a change cannot skip a stop. */
var ENVIRONMENTS = [
  {
    id: 'dev',
    name: 'Development',
    short: 'Dev',
    namespace: 'HSCUSTOM',
    deployment: 'hcc-dev-eu-west-1',
    branch: 'development',
    next: 'test',
    approval: 'none',
    approvers: [],
    autoDeploy: true,
    note: 'Your own work lands here first so you can run it end to end.'
  },
  {
    id: 'test',
    name: 'Test',
    short: 'Test',
    namespace: 'HSCUSTOM',
    deployment: 'hcc-test-eu-west-1',
    branch: 'test',
    next: 'prod',
    approval: 'one',
    approvers: ['m.silva (Integration Lead)'],
    autoDeploy: true,
    note: 'Shared with the rest of the team and the people who sign changes off.'
  },
  {
    id: 'prod',
    name: 'Production',
    short: 'Prod',
    namespace: 'HSCUSTOM',
    deployment: 'hcc-prod-eu-west-1',
    branch: 'live',
    next: null,
    approval: 'two',
    approvers: ['m.silva (Integration Lead)', 'change-board@trust.nhs.uk'],
    autoDeploy: true,
    note: 'Live patient traffic. Two approvals and a change window.'
  }
];

/* Where the user is right now. */
var CURRENT_ENV = 'dev';

/* Artifact taxonomy. `promotes` says how the item is treated on the way over —
 * this is what drives the warnings in the safety check. */
var TYPES = {
  namespace:   { label: 'Namespace',                promotes: 'infra'   },
  production:  { label: 'Production',               promotes: 'normal'  },
  service:     { label: 'Business service',         promotes: 'normal'  },
  process:     { label: 'Business process',         promotes: 'normal'  },
  operation:   { label: 'Business operation',       promotes: 'normal'  },
  adapter:     { label: 'Adapter',                  promotes: 'normal'  },
  dtl:         { label: 'Data transformation',      promotes: 'normal'  },
  bpl:         { label: 'Business process (BPL)',   promotes: 'normal'  },
  rule:        { label: 'Routing rule',             promotes: 'normal'  },
  lookup:      { label: 'Lookup table',             promotes: 'normal'  },
  recordmap:   { label: 'Record map',               promotes: 'normal'  },
  schema:      { label: 'Message schema',           promotes: 'normal'  },
  sds:         { label: 'System default settings',  promotes: 'per-env' },
  credential:  { label: 'Credential',               promotes: 'secret'  },
  oauth:       { label: 'OAuth client',             promotes: 'secret'  },
  global:      { label: 'Global',                   promotes: 'data'    },
  webapp:      { label: 'Web application',          promotes: 'normal'  }
};

/* Order the change list is grouped in. */
var TYPE_ORDER = ['namespace', 'production', 'service', 'process', 'operation',
  'adapter', 'bpl', 'dtl', 'rule', 'lookup', 'recordmap', 'schema', 'webapp',
  'sds', 'credential', 'oauth', 'global'];

/* What already exists in each downstream environment, and at what version.
 * The safety check compares the selection against this. */
var BASELINE = {
  test: {
    'HSCUSTOM.FoundationProduction':      6,
    'Demo.ADT.Rule.ADTRouter':            3,
    'Demo.ADT.DTL.A08Normalize':          2,
    'Demo.ADT.Operation.EMRAdtOut':       4,
    'Demo.ADT.Service.HISAdtIn':          3,
    'HSCUSTOM System Default Settings':  11,
    'EMR_TCP_CREDS':                      1
  },
  prod: {
    'HSCUSTOM.FoundationProduction':      6,
    'Demo.ADT.Rule.ADTRouter':            3,
    'Demo.ADT.DTL.A08Normalize':          2,
    'Demo.ADT.Operation.EMRAdtOut':       4,
    'Demo.ADT.Service.HISAdtIn':          3,
    'HSCUSTOM System Default Settings':  10,
    'EMR_TCP_CREDS':                      1
  }
};

/* The user's current change set.
 *
 * `requires` is the dependency graph. Each entry names another artifact by key.
 * It is exactly what an IRIS-backed implementation would compute by reading the
 * production definition XData, the routing rule's transform and target
 * attributes, the DTL's source/target classes and Lookup() calls, and the
 * business host's adapter, message class and schema category settings.
 */
var CHANGES = [
  { key: 'LABTEST', type: 'namespace', name: 'LABTEST', action: 'new', version: 1,
    when: '2026-07-21 09:14', source: 'Management Portal',
    detail: 'New namespace for lab interface testing, interoperability enabled',
    requires: [] },

  { key: 'HSCUSTOM.FoundationProduction', type: 'production', name: 'HSCUSTOM.FoundationProduction',
    action: 'mod', version: 7, when: '2026-07-22 16:41', source: 'Interoperability editor',
    detail: 'Added 2 items, changed pool size on EMRAdtOut from 1 to 2',
    requires: ['Demo.Lab.Service.LabResultIn', 'Demo.Lab.Operation.LISResultOut',
               'Demo.Lab.Rule.LabRouter', 'Demo.ADT.Operation.EMRAdtOut'] },

  { key: 'Demo.Lab.Service.LabResultIn', type: 'service', name: 'Demo.Lab.Service.LabResultIn',
    action: 'new', version: 1, when: '2026-07-22 11:02', source: 'Agentic Integration Builder',
    detail: 'EnsLib.HL7.Service.TCPService, MLLP on port 5100',
    requires: ['Custom_2.5.1_LIS', 'HSCUSTOM System Default Settings'] },

  { key: 'Demo.Lab.Operation.LISResultOut', type: 'operation', name: 'Demo.Lab.Operation.LISResultOut',
    action: 'new', version: 1, when: '2026-07-22 11:06', source: 'Agentic Integration Builder',
    detail: 'EnsLib.HL7.Operation.TCPOperation to the LIS analyser',
    requires: ['Custom_2.5.1_LIS', 'LIS_TCP_CREDS', 'HSCUSTOM System Default Settings'] },

  { key: 'Demo.Lab.DTL.ORUR01ToLISResult', type: 'dtl', name: 'Demo.Lab.DTL.ORUR01ToLISResult',
    action: 'new', version: 1, when: '2026-07-22 14:20', source: 'Agentic Integration Builder',
    detail: 'ORU^R01 2.5.1 to the LIS result format, 34 field mappings',
    requires: ['LabTestCodes', 'Custom_2.5.1_LIS'] },

  { key: 'Demo.Lab.Rule.LabRouter', type: 'rule', name: 'Demo.Lab.Rule.LabRouter',
    action: 'new', version: 1, when: '2026-07-22 15:55', source: 'Interoperability editor',
    detail: '3 rules — route ORU^R01 to the LIS, everything else to the dead letter file',
    requires: ['Demo.Lab.DTL.ORUR01ToLISResult', 'Demo.Lab.Operation.LISResultOut', 'LabTestCodes'] },

  { key: 'LabTestCodes', type: 'lookup', name: 'LabTestCodes',
    action: 'new', version: 1, when: '2026-07-21 15:30', source: 'CSV record wizard',
    detail: '148 rows — local test code to LOINC',
    requires: [] },

  { key: 'Custom_2.5.1_LIS', type: 'schema', name: 'Custom_2.5.1_LIS',
    action: 'new', version: 1, when: '2026-07-21 16:12', source: 'Management Portal',
    detail: 'HL7 2.5.1 with the ZLB analyser segment',
    requires: [] },

  { key: 'Demo.Lab.RecordMap.LabFeed', type: 'recordmap', name: 'Demo.Lab.RecordMap.LabFeed',
    action: 'new', version: 1, when: '2026-07-21 15:22', source: 'CSV record wizard',
    detail: 'Delimited record map for the nightly lab backfill file',
    requires: [] },

  { key: 'LIS_TCP_CREDS', type: 'credential', name: 'LIS_TCP_CREDS',
    action: 'new', version: 1, when: '2026-07-22 11:05', source: 'Management Portal',
    detail: 'Username and password for the LIS analyser socket',
    requires: [] },

  { key: 'Demo.ADT.Rule.ADTRouter', type: 'rule', name: 'Demo.ADT.Rule.ADTRouter',
    action: 'mod', version: 4, when: '2026-07-23 08:47', source: 'Interoperability editor',
    detail: 'Added a rule to drop duplicate A08 within 60 seconds',
    requires: ['Demo.ADT.DTL.A08Normalize', 'Demo.ADT.Operation.EMRAdtOut'] },

  { key: 'Demo.ADT.DTL.A08Normalize', type: 'dtl', name: 'Demo.ADT.DTL.A08Normalize',
    action: 'mod', version: 3, when: '2026-07-23 08:31', source: 'Agentic Integration Builder',
    detail: 'Strip dashes from PID:19, force MSH:3 to EPIC',
    requires: [] },

  { key: 'Demo.ADT.Operation.EMRAdtOut', type: 'operation', name: 'Demo.ADT.Operation.EMRAdtOut',
    action: 'mod', version: 5, when: '2026-07-23 09:02', source: 'Interoperability editor',
    detail: 'Reply code action changed to :?R=RF, retry interval 15s',
    requires: ['EMR_TCP_CREDS'] },

  { key: 'HSCUSTOM System Default Settings', type: 'sds', name: 'HSCUSTOM System Default Settings',
    action: 'mod', version: 12, when: '2026-07-22 17:03', source: 'Management Portal',
    detail: 'Added LIS host and port, dead letter directory for the lab feed',
    requires: [] },

  { key: 'LIS_FHIR_CLIENT', type: 'oauth', name: 'LIS_FHIR_CLIENT',
    action: 'mod', version: 2, when: '2026-07-22 12:44', source: 'Management Portal',
    detail: 'Redirect URL and scope changed for the lab results FHIR callback',
    requires: [] },

  { key: '^Demo.LabConfig', type: 'global', name: '^Demo.LabConfig',
    action: 'mod', version: 2, when: '2026-07-21 17:50', source: 'Management Portal',
    detail: '12 nodes — analyser identifiers and polling windows',
    requires: [] }
];

/* Which items are pre-ticked when the wizard first opens. This is deliberately
 * an incomplete set: the user has picked the production and the router but
 * forgotten the two business hosts the production points at, the transform the
 * router calls, and the lookup table the transform reads. That is the exact
 * mistake the safety check exists to catch. */
var DEFAULT_PICK = [
  'HSCUSTOM.FoundationProduction',
  'Demo.Lab.Rule.LabRouter',
  'Demo.ADT.Rule.ADTRouter',
  'Demo.ADT.DTL.A08Normalize',
  'HSCUSTOM System Default Settings'
];

/* Edit claims. This is the collision-avoidance layer: one artifact, one editor
 * at a time. Backed in a real implementation by a lock table plus the fact
 * that each user works in their own namespace and branch. */
var CLAIMS = [
  { item: 'Demo.Lab.Service.LabResultIn',  type: 'service',   by: 'me',      since: '2026-07-22 11:02', state: 'held' },
  { item: 'Demo.Lab.Operation.LISResultOut', type: 'operation', by: 'me',    since: '2026-07-22 11:06', state: 'held' },
  { item: 'Demo.Lab.DTL.ORUR01ToLISResult', type: 'dtl',      by: 'me',      since: '2026-07-22 14:20', state: 'held' },
  { item: 'Demo.Lab.Rule.LabRouter',       type: 'rule',      by: 'me',      since: '2026-07-22 15:55', state: 'held' },
  { item: 'Demo.ADT.Rule.ADTRouter',       type: 'rule',      by: 'me',      since: '2026-07-23 08:47', state: 'held' },
  { item: 'Demo.ADT.DTL.A08Normalize',     type: 'dtl',       by: 'me',      since: '2026-07-23 08:31', state: 'held' },
  { item: 'Demo.Rad.Rule.RadRouter',       type: 'rule',      by: 'm.silva', since: '2026-07-23 07:15', state: 'other' },
  { item: 'Demo.Rad.DTL.ORMToRIS',         type: 'dtl',       by: 'm.silva', since: '2026-07-23 07:15', state: 'other' }
];

/* Previously submitted change requests. */
var REQUESTS = [
  {
    id: 'CHG-2041', title: 'Pharmacy stock feed — add NDC to dm+d mapping',
    ref: 'INT-4712', author: 'me', created: '2026-07-16 10:22',
    items: 6, risk: 'low',
    stages: [
      { env: 'dev',  state: 'done',    at: '2026-07-16 10:31', note: 'Deployed automatically' },
      { env: 'test', state: 'done',    at: '2026-07-17 09:04', note: 'Approved by m.silva, deployed' },
      { env: 'prod', state: 'done',    at: '2026-07-18 20:05', note: 'Approved by m.silva and the change board, deployed in the Thursday window' }
    ]
  },
  {
    id: 'CHG-2058', title: 'Radiology order router — accept ORM^O01 from the new PACS',
    ref: 'INT-4790', author: 'me', created: '2026-07-21 14:10',
    items: 4, risk: 'medium',
    stages: [
      { env: 'dev',  state: 'done',    at: '2026-07-21 14:18', note: 'Deployed automatically' },
      { env: 'test', state: 'waiting', at: null, note: 'Waiting for m.silva to approve — sent 2 days ago' },
      { env: 'prod', state: 'pending', at: null, note: '' }
    ]
  },
  {
    id: 'CHG-2033', title: 'ADT router — suppress A31 to the reporting feed',
    ref: 'INT-4688', author: 'me', created: '2026-07-14 11:40',
    items: 2, risk: 'medium',
    stages: [
      { env: 'dev',  state: 'done',     at: '2026-07-14 11:52', note: 'Deployed automatically' },
      { env: 'test', state: 'rejected', at: '2026-07-15 16:20',
        note: 'Rejected by m.silva: "The reporting team still needs A31. Raise it with them before we suppress anything."' },
      { env: 'prod', state: 'pending',  at: null, note: '' }
    ]
  }
];

/* Work that was saved before any change was started.
 *
 * This is the recovery case, and it matters more than it looks. Capture never
 * depended on the user remembering to start a change — Embedded Git exports
 * every artifact to the repository working tree on save, whatever branch
 * happens to be checked out. So the work is not lost; what is missing is the
 * label saying which piece of work it belongs to, and the edit claim that
 * would have stopped somebody else touching the same item.
 *
 * Adopting it creates the feature branch now and carries the uncommitted
 * working-tree changes onto it.
 */
var ORPHAN_KEYS = [
  'Demo.Lab.Service.LabResultIn',
  'Demo.Lab.Operation.LISResultOut',
  'Demo.Lab.DTL.ORUR01ToLISResult',
  'Demo.Lab.Rule.LabRouter',
  'LabTestCodes',
  'Custom_2.5.1_LIS',
  'HSCUSTOM System Default Settings'
];

/* The real cost of not starting a change first: nothing was holding these
 * items, so somebody else may have edited the same artifact meanwhile. This is
 * what the collision check surfaces before the user commits to anything. */
var COLLISIONS = {
  'HSCUSTOM System Default Settings': {
    by: 'm.silva',
    at: '2026-07-22 16:40',
    what: 'changed the retry interval on EMRAdtOut and added two radiology settings'
  }
};

/* Guide content. */
var FAQ = [
  { q: 'Do I have to remember to do anything while I am building?',
    a: 'No. Once a change is started, every save is captured and versioned on its ' +
       'own. There is no export step and no "add to source control" action. Even ' +
       'if you forget to start a change, the saves are still captured — see the ' +
       'last question.' },
  { q: 'Does it matter which tool I used to make the change?',
    a: 'No. The Interoperability editor, the Management Portal, the CSV record ' +
       'wizard, the rule editor and the Agentic Integration Builder are all ' +
       'captured the same way. Changes the agent made for you are tagged so you ' +
       'can see what it did in your name.' },
  { q: 'What if I only want to send half of what I built?',
    a: 'That is normal. Tick what belongs to this change and leave the rest; it ' +
       'stays in your workspace for the next one. The safety check will tell you ' +
       'if the half you picked cannot stand on its own.' },
  { q: 'What if somebody else needs to edit something I am holding?',
    a: 'They will see that you have it and can ask you to release it. Nothing is ' +
       'taken from you automatically. If you release an item, the edits you ' +
       'already made stay in your change — you just give up the right to make more.' },
  { q: 'Will my development host names and ports end up in Production?',
    a: 'No. System default settings are stored separately per environment, so each ' +
       'one keeps its own host names, ports and directories. The safety check shows ' +
       'you a side-by-side and flags any setting that has no value in the target.' },
  { q: 'What happens to passwords and client secrets?',
    a: 'They never leave the environment they were entered in. The credential or ' +
       'OAuth entry is created in the target empty, and somebody with access there ' +
       'fills it in once. The safety check reminds you every time.' },
  { q: 'Can I undo a change after it has gone in?',
    a: 'Yes. Every deployment records exactly which version of each item went in, ' +
       'so any previous point can be restored. You are asked how to undo your change ' +
       'when you submit it, and the default is to roll back to the previous version.' },
  { q: 'I built things before I started a change. Have I lost them?',
    a: 'No, and you can still package them up. Capture does not depend on you ' +
       'starting a change — every save was recorded. Open My change and the work ' +
       'appears under "Work not in a change yet". Tick what belongs together, give ' +
       'it a reference, and put it into a change. The only thing you missed is the ' +
       'hold on those items, so the tool checks whether anyone else edited the same ' +
       'thing while yours was unassigned and tells you before you go any further.' }
];

var GLOSSARY = [
  ['Your change / your workspace',        'A feature branch cut from the live branch, checked out in your own user namespace'],
  ['Started a change',                    'git checkout -b interface/<user>/<reference> live'],
  ['Captured and versioned automatically','Embedded Git exports the artifact to a file on save; the version is the commit count for that file'],
  ['Refresh from Production',             'Sync — commit, rebase onto live, update the namespace, push'],
  ['Work not in a change yet',            'Uncommitted working-tree changes with no feature branch of their own'],
  ['Put this into a change',              'Create the branch now; the uncommitted changes carry across'],
  ['Items held for you',                  'Edit claims in the lock table, one artifact one editor'],
  ['Change request',                      'A GitLab merge request from your branch to the target environment branch'],
  ['Send forward / send on',              'A further merge request from the same branch to the next protected branch'],
  ['Deploys itself',                      'The CI/CD pipeline loads the protected branch into the protected namespace'],
  ['Environment',                         'A Health Connect Cloud deployment plus its protected namespace and branch'],
  ['Safety check',                        'Dependency closure over the selection, compared with the target branch and its deployment record']
];

/* Per-environment handling rules shown on the Environments screen. */
var TREATMENT = [
  { kind: 'System default settings',
    how: 'Values are taken from the target environment, not copied from yours',
    why: 'Host names, ports and directories differ in every environment. The file is stored per environment and the deployment picks the right one.' },
  { kind: 'Credentials',
    how: 'The entry is created empty; the password is never copied',
    why: 'Secrets never leave the environment they were entered in. Someone with access to the target has to fill it in once.' },
  { kind: 'OAuth clients',
    how: 'Configuration travels, the client secret does not',
    why: 'Same reason as credentials, plus the redirect URL is different per environment.' },
  { kind: 'Globals',
    how: 'Not copied unless you explicitly mark them as configuration data',
    why: 'Globals usually hold live data. Copying them over the target would overwrite real records.' },
  { kind: 'Namespaces and web applications',
    how: 'Raised as a platform request, not deployed by the pipeline',
    why: 'Creating a namespace changes the shape of the deployment. In Health Connect Cloud that is done by InterSystems on request.' },
  { kind: 'Everything else',
    how: 'Copied as-is and compiled in the target',
    why: 'Productions, hosts, transformations, rules, lookup tables, schemas and record maps are environment-neutral.' }
];

/* =====================================================================
 * 2. STATE
 * ===================================================================== */

var S = {
  /* Overwritten by the live whoami call. The fallback keeps the prototype
   * presentable when it is opened outside an authenticated editor session. */
  user: 'd.franco',
  namespace: 'HSCUSTOM',
  tech: false,
  screen: 'workspace',
  ws: null,              // { ref, title, base, started, branch, usrns }
  wsKeys: [],            // change keys that belong to the open change
  orphans: [],           // change keys captured but not in any change yet
  orphanPick: {},        // key -> true, selection in the adopt card
  collisionsChecked: false,
  step: 1,
  picked: {},            // key -> true
  form: { target: '', title: '', what: '', why: '', risk: 'medium', window: 'next', rollback: '' },
  findings: [],
  waived: {},            // finding id -> true
  claims: CLAIMS.slice()
};

/* =====================================================================
 * 3. DATA ACCESS
 *
 * The seam. Everything below section 3 goes through these functions and does
 * not know the data is mocked. Each one names the real backing call.
 * ===================================================================== */

/* Live mode.
 *
 * With ?live=1 the workspace, the change list and the unassigned work all come
 * from /api/hcccicd, which reads the namespace for real. Create a production in
 * the Interoperability editor and it appears here. The target-environment
 * baseline, the promotion path and the request history stay mocked, because
 * there is only one environment on a single instance to read from.
 *
 * Without the flag everything is the fixture, which is the better demo.
 */
var LIVE = false;
var API = '/api/hcccicd';

function api(path, opts) {
  opts = opts || {};
  opts.credentials = 'include';
  opts.headers = opts.headers || {};
  if (opts.body) opts.headers['Content-Type'] = 'application/json';
  return fetch(API + path, opts).then(function (r) {
    return r.text().then(function (txt) {
      if (r.status === 401 || r.status === 403) {
        var e = new Error('Not signed in to IRIS');
        e.auth = true;
        throw e;
      }
      var j = null;
      try { j = txt ? JSON.parse(txt) : null; } catch (x) { j = null; }
      if (!r.ok) {
        throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status + ' ' + r.statusText));
      }
      if (!j) throw new Error('The service returned an empty response');
      return j;
    });
  });
}

/* A 401 here means one thing and has one fix, so say so rather than showing a
 * parse error. Inside the Interoperability editor the user is already signed in
 * and this never fires; standalone in a fresh tab it always does. */
function authWall(retry) {
  modal('Sign in to IRIS first',
    '<p>Change Control reads your namespace directly, so it needs you signed in.</p>' +
    '<p>Open the Management Portal, sign in, then come back and press ' +
    '<strong>Retry</strong>.</p>' +
    '<p class="muted">This does not happen when you open Change Control from the ' +
    'Interoperability page — you are already signed in there.</p>',
    [{ label: 'Open the portal', onClick: function () {
         window.open('/csp/sys/UtilHome.csp', '_blank');
         setTimeout(function () { authWall(retry); }, 400);
       } },
     { label: 'Retry', kind: 'primary', onClick: retry }]);
}

/* Fold a live /state response into the shape the screens already render. */
function applyState(st) {
  if (!st) return;
  CHANGES.length = 0;
  S.wsKeys = [];
  S.orphans = [];

  (st.changes || []).forEach(function (c) { CHANGES.push(normalise(c)); S.wsKeys.push(c.key); });
  (st.orphans || []).forEach(function (c) { CHANGES.push(normalise(c)); S.orphans.push(c.key); });

  if (st.workspace) {
    S.ws = {
      ref: st.workspace.ref, title: st.workspace.title, base: st.workspace.base || 'prod',
      started: st.workspace.started, branch: st.workspace.branch, usrns: st.workspace.usrns
    };
  } else {
    S.ws = null;
  }

  /* Claims are derived: in live mode you hold what you have changed. */
  S.claims = CLAIMS.filter(function (c) { return c.state === 'other'; });
  S.wsKeys.forEach(function (k) {
    var c = byKey(k);
    if (c) S.claims.push({ item: k, type: c.type, by: 'me', since: c.when || stamp(), state: 'held' });
  });

  /* Drop selections for items that no longer exist. */
  Object.keys(S.picked).forEach(function (k) { if (!byKey(k)) delete S.picked[k]; });
  Object.keys(S.orphanPick).forEach(function (k) {
    if (S.orphans.indexOf(k) < 0) delete S.orphanPick[k];
  });
  S.orphans.forEach(function (k) {
    if (!(k in S.orphanPick)) S.orphanPick[k] = true;
  });
}

function normalise(c) {
  return {
    key: c.key, type: TYPES[c.type] ? c.type : 'production', name: c.name,
    action: c.action, version: c.version,
    when: c.when || '', source: sourceLabel(c),
    detail: c.detail || '', requires: c.requires || []
  };
}

/* The live capture layer cannot tell which editor made the change — it is
 * reading metadata, not intercepting saves. Embedded Git can, which is why the
 * fixture shows real tool names. */
function sourceLabel(c) { return c.source === 'IRIS' ? 'Captured from IRIS' : (c.source || 'IRIS'); }

var DATA = {
  /* LIVE in both modes. */
  whoami: function () {
    var url = LIVE ? (API + '/whoami') : '/api/agentic/whoami';
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  },

  /* LIVE only. Re-read the namespace and refresh every screen. */
  refresh: function () {
    if (!LIVE) return Promise.resolve();
    return api('/state').then(function (st) { applyState(st); return st; });
  },

  /* LIVE only. Declare the namespace as it stands to be the starting point. */
  reset: function () {
    return api('/reset', { method: 'POST' }).then(function (st) { applyState(st); return st; });
  },

  /* MOCK. Real: a persistent configuration class holding the promotion path,
   * seeded from the Health Connect Cloud deployment list. */
  environments: function () { return Promise.resolve(ENVIRONMENTS); },

  /* MOCK. Real: SourceControl.Git.API status for the current user namespace —
   * current branch, its base, and whether it is a feature branch. */
  workspace: function () { return Promise.resolve(S.ws); },

  /* MOCK. Real: create the feature branch off live and check it out into the
   * user namespace — SourceControl.Git.Util.Branch plus Import All (Force). */
  startWorkspace: function (ref, title, base) {
    if (LIVE) {
      return api('/workspace', {
        method: 'POST',
        body: JSON.stringify({ ref: ref, title: title, base: base })
      }).then(function (st) { applyState(st); return S.ws; });
    }
    S.ws = {
      ref: ref, title: title, base: base,
      started: stamp(),
      branch: 'interface/' + S.user.toLowerCase().replace(/[^a-z0-9]+/g, '') + '/' + ref,
      usrns: 'USR' + S.user.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
    };
    return Promise.resolve(S.ws);
  },

  /* MOCK. Real: the working-tree diff for the feature branch, decorated with
   * artifact type and the editor that produced each change. Embedded Git
   * exports on save, so this list needs no user action to populate. */
  changes: function () { return Promise.resolve(CHANGES); },

  /* MOCK. Real: uncommitted working-tree changes in the user namespace that do
   * not belong to a feature branch — the user built before starting a change. */
  orphans: function () { return Promise.resolve(S.orphans); },

  /* MOCK. Real: for each orphaned artifact, ask whether the base branch has a
   * commit touching the same file that is newer than the local modification.
   * That is the overwrite the missing edit claim failed to prevent. */
  checkCollisions: function (keys) {
    var hits = [];
    keys.forEach(function (k) {
      if (COLLISIONS[k]) hits.push({ key: k, info: COLLISIONS[k] });
    });
    return Promise.resolve(hits);
  },

  /* MOCK. Real: create the feature branch now — the uncommitted working-tree
   * changes carry across — then register the edit claims retroactively. */
  adopt: function (keys, ref, title) {
    if (LIVE) {
      return api('/adopt', {
        method: 'POST',
        body: JSON.stringify({ ref: ref, title: title, items: keys })
      }).then(function (st) { applyState(st); return S.ws; });
    }
    return DATA.startWorkspace(ref, title, 'prod').then(function (ws) {
      keys.forEach(function (k) {
        if (S.wsKeys.indexOf(k) < 0) S.wsKeys.push(k);
        S.orphans = S.orphans.filter(function (o) { return o !== k; });
        var c = byKey(k);
        if (c && !S.claims.some(function (x) { return x.item === k; })) {
          S.claims.push({ item: k, type: c.type, by: 'me', since: stamp(), state: 'held' });
        }
      });
      return ws;
    });
  },

  /* MOCK. Real: a lock table keyed by artifact, written when an editor opens
   * an item and released on promotion or abandon. */
  claims: function () { return Promise.resolve(S.claims); },

  /* MOCK. Real: read the target branch's file list and each artifact's last
   * deployed version from the pipeline's deployment record. */
  baseline: function (envId) { return Promise.resolve(BASELINE[envId] || {}); },

  /* MOCK. Real: the merge requests raised from this branch plus their pipeline
   * status in each environment. */
  requests: function () { return Promise.resolve(REQUESTS); },

  /* MOCK. Real: raise the merge request against the target branch with the
   * change log in the description and the selected files in the commit. */
  submit: function (payload) {
    var id = 'CHG-' + (2060 + Math.floor(Math.random() * 39));
    REQUESTS.unshift({
      id: id, title: payload.title, ref: S.ws ? S.ws.ref : '—', author: 'me',
      created: stamp(), items: payload.items.length, risk: payload.risk,
      stages: ENVIRONMENTS.map(function (e, i) {
        if (e.id === CURRENT_ENV) return { env: e.id, state: 'done', at: stamp(), note: 'Deployed automatically' };
        if (e.id === payload.target) {
          return { env: e.id, state: 'waiting', at: null,
                   note: e.approval === 'none' ? 'Deploying' : 'Waiting for ' + e.approvers[0] + ' to approve' };
        }
        return { env: e.id, state: 'pending', at: null, note: '' };
      })
    });
    return Promise.resolve({ id: id });
  }
};

/* =====================================================================
 * 4. DEPENDENCY ENGINE
 *
 * The reason the tool exists. Given a selection and a target environment, walk
 * every reference out of every selected item and decide whether the thing it
 * points at will actually be there when the deployment runs.
 *
 * Four outcomes per reference:
 *   satisfied  — selected, or already deployed in the target
 *   missing    — sitting in the user's workspace but not ticked  -> BLOCK, fixable in one click
 *   absent     — not in the workspace and not in the target      -> BLOCK, needs someone else
 *   downgrade  — in the target at an older version than the one the
 *                selected item was built against                 -> WARN
 *
 * Then a second pass over the selection itself for items that cannot be
 * copied verbatim between environments: secrets, per-environment settings,
 * data, and platform-level objects.
 * ===================================================================== */

function byKey(k) {
  for (var i = 0; i < CHANGES.length; i++) if (CHANGES[i].key === k) return CHANGES[i];
  return null;
}

/* Is this artifact part of the change the user currently has open? Only these
 * can be ticked, so only these can produce a one-click "add it" fix. */
function inWorkspace(k) { return S.wsKeys.indexOf(k) >= 0; }

/* The change set the user is working on, in declaration order. */
function wsChanges() {
  return CHANGES.filter(function (c) { return inWorkspace(c.key); });
}

function analyse(pickedKeys, targetId, baseline) {
  var findings = [];
  var sel = {};
  pickedKeys.forEach(function (k) { sel[k] = true; });
  var target = envById(targetId);
  var seen = {};

  /* --- pass 1: follow every reference, transitively ------------------ */
  var queue = pickedKeys.slice();
  var visited = {};

  while (queue.length) {
    var key = queue.shift();
    if (visited[key]) continue;
    visited[key] = true;

    var item = byKey(key);
    if (!item) continue;

    item.requires.forEach(function (req) {
      var dedupe = key + '>' + req;
      if (seen[dedupe]) return;
      seen[dedupe] = true;

      var inSel = !!sel[req];
      var inTgt = Object.prototype.hasOwnProperty.call(baseline, req);
      /* Only something in the open change is tickable, and therefore only
       * something in the open change can be offered as a one-click fix. */
      var wsItem = inWorkspace(req) ? byKey(req) : null;

      if (inSel) {
        /* satisfied by the selection — keep walking through it */
        if (!visited[req]) queue.push(req);
        return;
      }

      if (wsItem && !inTgt) {
        /* THE headline case: you changed it, you did not tick it, and the
         * target has never seen it. The deployment would compile against
         * something that is not there. */
        findings.push({
          id: 'miss:' + req,
          sev: 'block',
          kind: 'missing',
          fixKey: req,
          title: needsLabel(item, req, wsItem) ,
          body: '<strong>' + esc(item.name) + '</strong> refers to <strong>' + esc(wsItem.name) +
                '</strong>, which you created in this change but did not tick. ' +
                target.name + ' has never had it, so ' + esc(shortName(item.name)) +
                ' would fail to start.',
          chain: shortName(item.name) + '  needs →  ' + shortName(wsItem.name) + '  (' + TYPES[wsItem.type].label.toLowerCase() + ', not selected)',
          fixLabel: 'Add ' + shortName(wsItem.name)
        });
        return;
      }

      if (wsItem && inTgt) {
        /* target has an older copy — deployable, but the user is shipping a
         * caller built against a newer callee. */
        if (baseline[req] < wsItem.version) {
          findings.push({
            id: 'stale:' + req,
            sev: 'warn',
            kind: 'downgrade',
            fixKey: req,
            title: shortName(wsItem.name) + ' will stay at the older version',
            body: '<strong>' + esc(item.name) + '</strong> was built against version ' +
                  wsItem.version + ' of <strong>' + esc(wsItem.name) + '</strong>, but ' +
                  target.name + ' is running version ' + baseline[req] +
                  ' and you have not ticked the newer one. It will still deploy — it may just not behave the way you saw it behave here.',
            chain: shortName(item.name) + '  built against →  ' + shortName(wsItem.name) +
                   ' v' + wsItem.version + '   |   ' + target.name + ' has v' + baseline[req],
            fixLabel: 'Add version ' + wsItem.version + ' too'
          });
        }
        return;
      }

      if (!wsItem && !inTgt) {
        /* nothing anyone can tick — it does not exist in this environment's
         * source control at all. Usually a class outside the mapped packages,
         * or a credential someone created by hand and never versioned. */
        findings.push({
          id: 'absent:' + req,
          sev: 'block',
          kind: 'absent',
          fixKey: null,
          title: esc(shortName(req)) + ' does not exist in ' + target.name,
          body: '<strong>' + esc(item.name) + '</strong> needs <strong>' + esc(req) +
                '</strong>. It is not part of this change and it is not in ' + target.name +
                '. Somebody has to create it there before this can go in.',
          chain: shortName(item.name) + '  needs →  ' + esc(req) + '  (nowhere to be found)',
          fixLabel: null
        });
      }
    });
  }

  /* --- pass 2: items that do not travel cleanly ---------------------- */
  pickedKeys.forEach(function (k) {
    var item = byKey(k);
    if (!item) return;
    var t = TYPES[item.type];

    if (t.promotes === 'secret') {
      findings.push({
        id: 'secret:' + k, sev: 'warn', kind: 'secret', fixKey: null,
        title: 'The secret in ' + shortName(item.name) + ' will not travel',
        body: 'The entry is created in ' + target.name + ' but the ' +
              (item.type === 'oauth' ? 'client secret' : 'password') +
              ' is deliberately not copied. Somebody with access to ' + target.name +
              ' has to enter it once, or the connection will fail at run time with an authentication error.',
        chain: null, fixLabel: null,
        ack: 'I will get the secret set in ' + target.name
      });
    }

    if (t.promotes === 'per-env') {
      findings.push({
        id: 'env:' + k, sev: 'warn', kind: 'per-env', fixKey: null,
        title: shortName(item.name) + ' holds values that are different in ' + target.name,
        body: 'Host names, ports and directory paths are stored per environment. Your ' +
              'development values stay here; ' + target.name + ' keeps its own. Check that ' +
              'every setting you added has a ' + target.name + ' value, otherwise the host ' +
              'will start with a blank one.',
        chain: null, fixLabel: null,
        ack: 'I have checked the ' + target.name + ' values',
        review: true
      });
    }

    if (t.promotes === 'data') {
      findings.push({
        id: 'data:' + k, sev: 'warn', kind: 'data', fixKey: null,
        title: shortName(item.name) + ' is data, not configuration',
        body: 'Sending a global forward overwrites whatever is in ' + target.name +
              ' with what is in your workspace. If that global holds anything live, ' +
              'this will destroy it. Only send it if you are certain it is configuration.',
        chain: null, fixLabel: null,
        ack: 'This global is configuration and is safe to overwrite'
      });
    }

    if (t.promotes === 'infra') {
      findings.push({
        id: 'infra:' + k, sev: 'warn', kind: 'infra', fixKey: null,
        title: shortName(item.name) + ' has to be created by the platform team',
        body: 'The deployment pipeline cannot create a namespace. This will be raised ' +
              'as a platform request alongside the change, and the rest of the change ' +
              'will wait until it exists in ' + target.name + '.',
        chain: null, fixLabel: null,
        ack: 'Raise the platform request with this change'
      });
    }
  });

  /* --- pass 3: advisory ---------------------------------------------- */
  var touchesLive = pickedKeys.some(function (k) {
    var it = byKey(k);
    return it && it.action === 'mod' && Object.prototype.hasOwnProperty.call(baseline, k);
  });
  if (touchesLive && targetId === 'prod') {
    findings.push({
      id: 'live', sev: 'info', kind: 'live', fixKey: null,
      title: 'This change edits interfaces that are carrying traffic now',
      body: 'At least one item in this set is already running in Production. ' +
            'The affected hosts restart when the change is applied, so anything ' +
            'in flight is queued rather than lost, but the interface is briefly down. ' +
            'That is why this needs a change window.',
      chain: null, fixLabel: null
    });
  }

  var noPick = pickedKeys.length === 0;
  if (noPick) {
    findings.push({
      id: 'empty', sev: 'block', kind: 'empty', fixKey: null,
      title: 'Nothing is selected',
      body: 'Go back and tick at least one item.',
      chain: null, fixLabel: null
    });
  }

  return findings;
}

/* Phrase the headline so it reads like the example the tool exists for:
 * "You are sending the production but not the business host it points at." */
function needsLabel(from, reqKey, reqItem) {
  var ft = TYPES[from.type].label.toLowerCase();
  var rt = TYPES[reqItem.type].label.toLowerCase();
  return 'The ' + ft + ' points at a ' + rt + ' you have not selected';
}

function shortName(n) {
  if (!n) return '';
  var p = String(n).split('.');
  return p.length > 2 ? p[p.length - 1] : n;
}

/* =====================================================================
 * 5. HELPERS
 * ===================================================================== */

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function stamp() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function envById(id) {
  for (var i = 0; i < ENVIRONMENTS.length; i++) if (ENVIRONMENTS[i].id === id) return ENVIRONMENTS[i];
  return ENVIRONMENTS[0];
}
function nextEnv() {
  var cur = envById(CURRENT_ENV);
  return cur.next ? envById(cur.next) : null;
}
function pickedKeys() {
  return Object.keys(S.picked).filter(function (k) { return S.picked[k]; });
}
function toast(msg) {
  var t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.hidden = true; }, 2600);
}
function actionTag(a) {
  if (a === 'new') return '<span class="tag new">New</span>';
  if (a === 'del') return '<span class="tag del">Deleted</span>';
  return '<span class="tag mod">Changed</span>';
}
function sourceTag(s) {
  var cls = s === 'Agentic Integration Builder' ? 'tag ai' : 'tag';
  return '<span class="' + cls + '">' + esc(s) + '</span>';
}

function modal(title, bodyHtml, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  var foot = $('#modal-foot');
  foot.innerHTML = '';
  (buttons || [{ label: 'Close', kind: '' }]).forEach(function (b) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'btn ' + (b.kind || '');
    el.textContent = b.label;
    el.addEventListener('click', function () {
      $('#modal').hidden = true;
      if (b.onClick) b.onClick();
    });
    foot.appendChild(el);
  });
  $('#modal').hidden = false;
}

/* =====================================================================
 * 6. RENDER — header, workspace
 * ===================================================================== */

function renderHeader() {
  var env = envById(CURRENT_ENV);
  var p = $('#pill-env');
  p.textContent = env.name;
  p.className = 'pill env-' + env.id;
  $('#pill-ns').textContent = S.ws ? S.ws.usrns + ' (yours)' : S.namespace;
  $('#pill-user').textContent = S.user;

  var dot = $('#ws-dot'), lab = $('#ws-label');
  if (S.ws) {
    dot.className = 'dot dot-ok';
    lab.textContent = S.ws.ref + ' — ' + wsChanges().length + ' items changed';
  } else {
    dot.className = 'dot dot-idle';
    lab.textContent = 'No change in progress';
  }
  $('#count-changes').textContent = S.ws ? wsChanges().length : '';
  $('#count-requests').textContent = REQUESTS.length;
}

/* ---- guide ---- */

function renderGuide() {
  if ($('#faq').children.length) return;   /* static, render once */
  $('#faq').innerHTML = FAQ.map(function (f) {
    return '<dt>' + esc(f.q) + '</dt><dd>' + esc(f.a) + '</dd>';
  }).join('');
  $('#tbl-glossary tbody').innerHTML = GLOSSARY.map(function (g) {
    return '<tr><td>' + esc(g[0]) + '</td><td class="muted">' + esc(g[1]) + '</td></tr>';
  }).join('');
}

/* ---- work captured before a change was started ---- */

function renderOrphans() {
  var card = $('#ws-orphan');
  if (!S.orphans.length) { card.hidden = true; return; }
  card.hidden = false;

  $('#orphan-count').textContent = S.orphans.length + ' items';
  $('#orphan-lede').textContent =
    'You built these before starting a change. Nothing is lost — every save was ' +
    'captured. They just have no change to belong to yet, so they cannot be sent ' +
    'forward. Tick what belongs together and give it a reference.';

  $('#orphan-list').innerHTML = groupChanges(
    CHANGES.filter(function (c) { return S.orphans.indexOf(c.key) >= 0; })
  ).map(function (g) {
    return '<div class="grp"><div class="grp-head">' + esc(g.label) +
      '<span class="grp-n">' + g.items.length + '</span></div>' +
      g.items.map(function (c) {
        var col = COLLISIONS[c.key];
        return '<label class="row' + (S.orphanPick[c.key] ? ' picked' : '') +
            (S.collisionsChecked && col ? ' flagged' : '') + '">' +
          '<input type="checkbox" ' + (S.orphanPick[c.key] ? 'checked' : '') +
            ' data-ocb="' + esc(c.key) + '">' +
          '<div class="row-main">' +
            '<div class="row-name">' + esc(c.name) + '</div>' +
            '<div class="row-meta">' + esc(c.detail) +
              (S.collisionsChecked && col
                ? ' &middot; <span class="warn">' + esc(col.by) + ' also changed this on ' +
                  esc(col.at) + '</span>'
                : '') +
            '</div>' +
          '</div><div class="row-side">' +
            actionTag(c.action) +
            '<span class="tag ver">Version ' + c.version + '</span>' +
            sourceTag(c.source) +
          '</div></label>';
      }).join('') + '</div>';
  }).join('');

  $$('[data-ocb]', card).forEach(function (cb) {
    cb.addEventListener('change', function () {
      S.orphanPick[cb.getAttribute('data-ocb')] = cb.checked;
      cb.closest('.row').classList.toggle('picked', cb.checked);
    });
  });
}

function orphanPicked() {
  return S.orphans.filter(function (k) { return S.orphanPick[k]; });
}

function runCollisionCheck(silent) {
  var keys = orphanPicked();
  if (!keys.length) {
    if (!silent) $('#orphan-warn').textContent = 'Tick the items you want to check.';
    return Promise.resolve([]);
  }
  $('#orphan-warn').textContent = '';
  return DATA.checkCollisions(keys).then(function (hits) {
    S.collisionsChecked = true;
    var b = $('#orphan-collision');
    if (!hits.length) {
      b.className = 'banner banner-ok';
      b.hidden = false;
      b.innerHTML = 'Checked. Nobody else has touched any of these ' + keys.length +
        ' items since you changed them, so nothing of yours has been overwritten ' +
        'and nothing of theirs will be.';
    } else {
      b.className = 'banner banner-warn';
      b.hidden = false;
      b.innerHTML = '<strong>' + hits.length + ' of these were also changed by ' +
        'somebody else.</strong> Nothing was holding them for you, so one of you has ' +
        'the other\'s work. Sort this out before you go any further.<br><br>' +
        hits.map(function (h) {
          return '<code>' + esc(h.key) + '</code> — ' + esc(h.info.by) + ' ' +
                 esc(h.info.what) + ' on ' + esc(h.info.at) + '.';
        }).join('<br>') +
        '<br><br>Starting a change before you build is what avoids this: while you ' +
        'hold an item, nobody else can change it.';
    }
    renderOrphans();
    return hits;
  });
}

function adoptOrphans() {
  var keys = orphanPicked();
  var ref = $('#orphan-ref').value.trim();
  var title = $('#orphan-title').value.trim();

  if (!keys.length) { $('#orphan-warn').textContent = 'Tick at least one item.'; return; }
  if (!ref || !title) {
    $('#orphan-warn').textContent = 'A reference and a description are both needed.';
    $('#orphan-ref').classList.toggle('bad', !ref);
    $('#orphan-title').classList.toggle('bad', !title);
    return;
  }
  $('#orphan-warn').textContent = '';

  /* Never let someone adopt over the top of a collision without seeing it. */
  DATA.checkCollisions(keys).then(function (hits) {
    if (hits.length && !S.collisionsChecked) {
      runCollisionCheck(true);
      modal('Somebody else changed ' + hits.length + ' of these',
        '<p>Because this work was not in a change, nothing was holding these items ' +
        'for you and somebody else edited the same thing.</p>' +
        hits.map(function (h) {
          return '<p><code>' + esc(h.key) + '</code><br>' + esc(h.info.by) + ' ' +
                 esc(h.info.what) + ' on ' + esc(h.info.at) + '.</p>';
        }).join('') +
        '<p class="muted">You can still put this into a change — the work is not ' +
        'lost either way — but talk to them before you send it forward, or one of ' +
        'you will lose an edit.</p>',
        [{ label: 'Let me look first' },
         { label: 'Put it into a change anyway', kind: 'primary', onClick: doAdopt }]);
      return;
    }
    doAdopt();
  });

  function doAdopt() {
    DATA.adopt(keys, ref, title).then(function () {
      S.orphanPick = {};
      S.collisionsChecked = false;
      S.form.title = title;
      $('#pr-title').value = title;
      renderHeader();
      renderWorkspace();
      toast(keys.length + ' items are now part of ' + ref);
    });
  }
}

function renderWorkspace() {
  renderOrphans();
  var baseSel = $('#ws-base');
  if (!baseSel.options.length) {
    ENVIRONMENTS.slice().reverse().forEach(function (e) {
      var o = document.createElement('option');
      o.value = e.id;
      o.textContent = 'What is running in ' + e.name + ' today';
      baseSel.appendChild(o);
    });
    baseSel.value = 'prod';
  }

  $('#ws-start').hidden = !!S.ws;
  $('#ws-active').hidden = !S.ws;
  if (!S.ws) return;

  $('#ws-name').textContent = S.ws.title;
  $('#ws-meta').textContent = 'Private to you. Nobody else sees these changes until you send them forward.';
  $('#ws-k-ref').textContent = S.ws.ref;
  $('#ws-k-started').textContent = S.ws.started;
  $('#ws-k-base').textContent = envById(S.ws.base).name + ' as it was when you started';
  $('#ws-k-count').textContent = wsChanges().length + ' items';
  $('#ws-k-branch').innerHTML = '<code>' + esc(S.ws.branch) + '</code>';
  $('#ws-k-usrns').innerHTML = '<code>' + esc(S.ws.usrns) + '</code>';

  var tb = $('#tbl-claims tbody');
  tb.innerHTML = S.claims.map(function (c) {
    var mine = c.by === 'me';
    return '<tr>' +
      '<td class="mono">' + esc(c.item) + '</td>' +
      '<td class="nowrap">' + esc(TYPES[c.type].label) + '</td>' +
      '<td class="nowrap">' + (mine ? 'You' : esc(c.by)) + '</td>' +
      '<td class="nowrap">' + esc(c.since) + '</td>' +
      '<td class="nowrap"><span class="status"><span class="dot ' +
        (mine ? 'dot-ok' : 'dot-warn') + '"></span>' +
        (mine ? 'Yours to edit' : 'Read-only for you') + '</span></td>' +
      '<td class="right nowrap">' + (mine
        ? '<button type="button" class="btn sm ghost" data-release="' + esc(c.item) + '">Release</button>'
        : '<button type="button" class="btn sm ghost" data-ask="' + esc(c.by) + '">Ask ' + esc(c.by) + '</button>') +
      '</td></tr>';
  }).join('');

  $$('[data-release]', tb).forEach(function (b) {
    b.addEventListener('click', function () {
      var item = b.getAttribute('data-release');
      modal('Release ' + shortName(item) + '?',
        '<p>You will not be able to change it again until you claim it back, and ' +
        'somebody else may pick it up in the meantime.</p>' +
        '<p class="muted">Any edits you already made stay in your change &mdash; releasing ' +
        'only gives up the right to make more.</p>',
        [{ label: 'Keep it' },
         { label: 'Release it', kind: 'danger', onClick: function () {
             S.claims = S.claims.filter(function (c) { return c.item !== item; });
             renderWorkspace();
             toast(shortName(item) + ' released');
           } }]);
    });
  });
  $$('[data-ask]', tb).forEach(function (b) {
    b.addEventListener('click', function () { askHandover(b.getAttribute('data-ask')); });
  });

  var other = S.claims.filter(function (c) { return c.state === 'other'; });
  var cc = $('#conflict-card');
  if (other.length) {
    cc.hidden = false;
    $('#conflict-banner').innerHTML =
      '<strong>' + esc(other[0].by) + '</strong> has been editing <code>' + esc(other[0].item) +
      '</code> since ' + esc(other[0].since) + '. You can open it and look at it, but you cannot ' +
      'change it until they finish their change or hand it over. This is what stops two people ' +
      'quietly overwriting each other.';
  } else {
    cc.hidden = true;
  }
}

function askHandover(who) {
  modal('Ask ' + who + ' to release it',
    '<p>We will send ' + esc(who) + ' a message saying you need the items they are holding, ' +
    'with a link to your change.</p>' +
    '<p class="muted">They keep whatever they have already done. Nothing is taken from them ' +
    'automatically &mdash; they have to agree.</p>',
    [{ label: 'Cancel' },
     { label: 'Send the request', kind: 'primary', onClick: function () {
         toast('Request sent to ' + who);
       } }]);
}

/* =====================================================================
 * 7. RENDER — what I changed
 * ===================================================================== */

function groupChanges(list) {
  var g = {};
  list.forEach(function (c) { (g[c.type] = g[c.type] || []).push(c); });
  return TYPE_ORDER.filter(function (t) { return g[t]; }).map(function (t) {
    return { type: t, label: TYPES[t].label, items: g[t] };
  });
}

function renderChanges() {
  /* Rebuild the filters from what is actually in the change. In live mode the
   * list changes under us every refresh, so this cannot be done once. */
  var ts = $('#chg-type'), ss = $('#chg-source');
  var keepT = ts.value, keepS = ss.value;
  var items = wsChanges();

  ts.length = 1; ss.length = 1;
  TYPE_ORDER.forEach(function (t) {
    if (!items.some(function (c) { return c.type === t; })) return;
    var o = document.createElement('option');
    o.value = t; o.textContent = TYPES[t].label;
    ts.appendChild(o);
  });
  var srcs = [];
  items.forEach(function (c) { if (srcs.indexOf(c.source) < 0) srcs.push(c.source); });
  srcs.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s; o.textContent = s;
    ss.appendChild(o);
  });
  ts.value = keepT; ss.value = keepS;
  if (ts.selectedIndex < 0) ts.selectedIndex = 0;
  if (ss.selectedIndex < 0) ss.selectedIndex = 0;

  var q = ($('#chg-search').value || '').toLowerCase();
  var ft = ts.value, fs = ss.value;
  var list = wsChanges().filter(function (c) {
    if (q && c.name.toLowerCase().indexOf(q) < 0 && c.detail.toLowerCase().indexOf(q) < 0) return false;
    if (ft && c.type !== ft) return false;
    if (fs && c.source !== fs) return false;
    return true;
  });

  var nNew = list.filter(function (c) { return c.action === 'new'; }).length;
  var nAI = list.filter(function (c) { return c.source === 'Agentic Integration Builder'; }).length;
  $('#chg-summary').textContent = list.length + ' items · ' + nNew + ' new · ' +
    nAI + ' made by the Agentic Integration Builder';

  $('#chg-groups').innerHTML = groupChanges(list).map(function (g) {
    return '<div class="grp"><div class="grp-head">' + esc(g.label) +
      '<span class="grp-n">' + g.items.length + '</span></div>' +
      g.items.map(function (c) {
        return '<div class="row"><div class="row-main">' +
          '<div class="row-name">' + esc(c.name) + '</div>' +
          '<div class="row-meta">' + esc(c.detail) + '</div>' +
          '</div><div class="row-side">' +
          actionTag(c.action) +
          '<span class="tag ver">Version ' + c.version + '</span>' +
          sourceTag(c.source) +
          '<span class="muted nowrap">' + esc(c.when) + '</span>' +
          '</div></div>';
      }).join('') + '</div>';
  }).join('') || emptyChanges();
}

function emptyChanges() {
  if (!S.ws && S.orphans.length) {
    return '<div class="banner banner-warn">You have <strong>' + S.orphans.length +
      ' items</strong> that were captured but are not part of a change yet, so they ' +
      'are not listed here. Go to <strong>My change</strong> and put them into a ' +
      'change — nothing is lost.</div>';
  }
  if (!S.ws) {
    return '<div class="banner banner-ok">Nothing captured yet. Start a change in ' +
      '<strong>My change</strong>, then build as you normally would — everything you ' +
      'save from then on appears here on its own.</div>';
  }
  return '<p class="muted">Nothing matches that filter.</p>';
}

/* =====================================================================
 * 8. RENDER — the wizard
 * ===================================================================== */

function renderPromoteIntro() {
  var tgt = $('#pr-target');
  if (!tgt.options.length) {
    ENVIRONMENTS.forEach(function (e) {
      if (e.id === CURRENT_ENV) return;
      var o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.name;
      tgt.appendChild(o);
    });
    var n = nextEnv();
    tgt.value = S.form.target || (n ? n.id : ENVIRONMENTS[1].id);
    S.form.target = tgt.value;
  }
  updateTargetHint();

  var n2 = nextEnv();
  $('#promote-lede').textContent = S.ws
    ? 'You are in ' + envById(CURRENT_ENV).name + '. The next stop is ' +
      (n2 ? n2.name : '—') + '. Four steps: say what you did, tick what goes, ' +
      'let us check it, submit.'
    : 'Start a change first — there is nothing to send yet.';
}

function updateTargetHint() {
  var e = envById($('#pr-target').value);
  var appr = e.approval === 'none' ? 'No approval needed'
    : e.approval === 'one' ? 'One approval needed — ' + e.approvers[0]
    : 'Two approvals needed — ' + e.approvers.join(' and ');
  $('#pr-target-hint').textContent = appr + '. ' + e.note;
}

function renderPick() {
  var host = $('#pick-groups');
  host.innerHTML = groupChanges(wsChanges()).map(function (g) {
    return '<div class="grp"><div class="grp-head">' + esc(g.label) +
      '<span class="grp-n">' + g.items.length + '</span></div>' +
      g.items.map(function (c) {
        return '<label class="row' + (S.picked[c.key] ? ' picked' : '') + '" data-key="' + esc(c.key) + '">' +
          '<input type="checkbox" ' + (S.picked[c.key] ? 'checked' : '') + ' data-cb="' + esc(c.key) + '">' +
          '<div class="row-main">' +
            '<div class="row-name">' + esc(c.name) + '</div>' +
            '<div class="row-meta">' + esc(c.detail) + '</div>' +
          '</div><div class="row-side">' +
            actionTag(c.action) +
            '<span class="tag ver">Version ' + c.version + '</span>' +
            sourceTag(c.source) +
          '</div></label>';
      }).join('') + '</div>';
  }).join('');

  $$('[data-cb]', host).forEach(function (cb) {
    cb.addEventListener('change', function () {
      var k = cb.getAttribute('data-cb');
      S.picked[k] = cb.checked;
      cb.closest('.row').classList.toggle('picked', cb.checked);
      updatePickCount();
    });
  });
  updatePickCount();
}

function updatePickCount() {
  var n = pickedKeys().length;
  $('#pick-count').textContent = n + ' of ' + wsChanges().length + ' selected';
}

function runCheck() {
  var target = S.form.target;
  return DATA.baseline(target).then(function (base) {
    S.findings = analyse(pickedKeys(), target, base);
    renderFindings();
  });
}

function blockingLeft() {
  return S.findings.filter(function (f) {
    return f.sev === 'block' && !S.waived[f.id];
  }).length;
}
function warnLeft() {
  return S.findings.filter(function (f) {
    return f.sev === 'warn' && !S.waived[f.id];
  }).length;
}

function renderFindings() {
  var env = envById(S.form.target);
  var nBlock = S.findings.filter(function (f) { return f.sev === 'block'; }).length;
  var nWarn = S.findings.filter(function (f) { return f.sev === 'warn'; }).length;
  var nInfo = S.findings.filter(function (f) { return f.sev === 'info'; }).length;

  $('#check-tiles').innerHTML =
    tile(pickedKeys().length, 'items selected', '') +
    tile(nBlock, nBlock === 1 ? 'thing to fix' : 'things to fix', nBlock ? 'bad' : 'good') +
    tile(nWarn, nWarn === 1 ? 'thing to check' : 'things to check', nWarn ? 'warn' : 'good') +
    tile(nInfo, 'for your information', '');

  $('#check-lede').textContent = 'We followed every reference out of the ' +
    pickedKeys().length + ' items you picked and compared them with what is ' +
    'running in ' + env.name + ' right now.';

  var host = $('#findings');
  if (!S.findings.length) {
    host.innerHTML = '<div class="banner banner-ok">Nothing to flag. Everything ' +
      'these items depend on is either in your selection or already in ' + esc(env.name) + '.</div>';
    syncStep4Button();
    return;
  }

  var order = { block: 0, warn: 1, info: 2 };
  var sorted = S.findings.slice().sort(function (a, b) { return order[a.sev] - order[b.sev]; });

  var head = '';
  if (nBlock) {
    head = '<div class="banner banner-err"><strong>' + nBlock + ' ' +
      (nBlock === 1 ? 'problem would stop this deployment' : 'problems would stop this deployment') +
      '.</strong> Fix them here and you will not find out the hard way in ' + esc(env.name) + '.</div>';
  } else if (nWarn) {
    head = '<div class="banner banner-warn"><strong>Nothing is broken.</strong> ' +
      'There are ' + nWarn + ' things that need a human decision before this goes to ' +
      esc(env.name) + '. Confirm each one.</div>';
  }

  host.innerHTML = head + sorted.map(function (f) {
    var waived = !!S.waived[f.id];
    var sevWord = f.sev === 'block' ? 'Must fix' : f.sev === 'warn' ? 'Check this' : 'Note';
    var actions = '';
    if (f.fixKey) {
      actions += '<button type="button" class="btn sm primary" data-fix="' + esc(f.id) +
                 '">' + esc(f.fixLabel) + '</button>';
    }
    if (f.sev === 'warn') {
      actions += '<button type="button" class="btn sm" data-ack="' + esc(f.id) + '">' +
                 esc(f.ack || 'Understood, carry on') + '</button>';
    }
    if (f.kind === 'absent') {
      actions += '<button type="button" class="btn sm" data-help="' + esc(f.id) + '">What do I do?</button>';
    }
    if (f.review) {
      actions += '<button type="button" class="btn sm ghost" data-review="' + esc(f.id) + '">Show me the values</button>';
    }

    return '<div class="finding sev-' + f.sev + (waived ? ' resolved' : '') + '" data-id="' + esc(f.id) + '">' +
      '<div class="finding-head"><h4>' + esc(f.title) + '</h4>' +
      '<span class="finding-sev">' + (waived ? 'Confirmed' : sevWord) + '</span></div>' +
      '<p class="finding-body">' + f.body + '</p>' +
      (f.chain ? '<div class="finding-chain">' + esc(f.chain) + '</div>' : '') +
      (actions ? '<div class="finding-actions">' + actions + '</div>' : '') +
      '</div>';
  }).join('');

  $$('[data-fix]', host).forEach(function (b) {
    b.addEventListener('click', function () {
      var f = findingById(b.getAttribute('data-fix'));
      if (!f || !f.fixKey) return;
      S.picked[f.fixKey] = true;
      toast(shortName(byKey(f.fixKey).name) + ' added to the change');
      runCheck();
    });
  });
  $$('[data-ack]', host).forEach(function (b) {
    b.addEventListener('click', function () {
      S.waived[b.getAttribute('data-ack')] = true;
      renderFindings();
    });
  });
  $$('[data-help]', host).forEach(function (b) {
    b.addEventListener('click', function () {
      var f = findingById(b.getAttribute('data-help'));
      modal('Getting ' + shortName(f.fixKeyName || '') + ' into ' + env.name,
        '<p>Three ways, in order of preference:</p>' +
        '<p><strong>1.</strong> If it is something you can build, go back to the ' +
        'Interoperability editor, create it here, and it will appear in your change ' +
        'list ready to tick.</p>' +
        '<p><strong>2.</strong> If a colleague owns it, ask them to send their change ' +
        'forward first &mdash; yours can go the moment theirs lands.</p>' +
        '<p><strong>3.</strong> If it is something outside interoperability &mdash; a ' +
        'credential, a certificate, a platform setting &mdash; raise it with whoever ' +
        'administers ' + esc(env.name) + '.</p>' +
        '<p class="muted">You can submit this change now and it will sit and wait, ' +
        'but it will not deploy until the missing piece is there.</p>',
        [{ label: 'Got it', kind: 'primary' }]);
    });
  });
  $$('[data-review]', host).forEach(function (b) {
    b.addEventListener('click', function () { showSettingsDiff(env); });
  });

  syncStep4Button();
}

function showSettingsDiff(env) {
  modal('System default settings — here vs ' + env.name,
    '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    '<th>Setting</th><th>' + esc(envById(CURRENT_ENV).name) + '</th><th>' + esc(env.name) + '</th>' +
    '</tr></thead><tbody>' +
    row('LISResultOut / IPAddress', '10.20.4.11', '<span class="warn">not set</span>') +
    row('LISResultOut / Port', '6100', '<span class="warn">not set</span>') +
    row('LabResultIn / Port', '5100', '<span class="warn">not set</span>') +
    row('LabDeadLetter / FilePath', '/data/lab/dev/deadletter', '<span class="warn">not set</span>') +
    row('EMRAdtOut / IPAddress', '10.20.4.2', '10.30.4.2') +
    row('EMRAdtOut / Port', '5000', '5000') +
    '</tbody></table></div>' +
    '<p class="muted" style="margin-top:12px">Four settings you added have no value in ' +
    esc(env.name) + '. The hosts will start, but they will have nowhere to connect to. ' +
    'Ask whoever administers ' + esc(env.name) + ' for the real host names and ports and ' +
    'add them there before this change is applied.</p>',
    [{ label: 'Close' }]);

  function row(k, a, b) {
    return '<tr><td class="mono">' + esc(k) + '</td><td class="mono">' + esc(a) +
           '</td><td class="mono">' + b + '</td></tr>';
  }
}

function findingById(id) {
  for (var i = 0; i < S.findings.length; i++) if (S.findings[i].id === id) return S.findings[i];
  return null;
}

function tile(n, label, cls) {
  return '<div class="tile ' + cls + '"><div class="tile-n">' + n + '</div>' +
         '<div class="tile-l">' + esc(label) + '</div></div>';
}

function syncStep4Button() {
  var b = $('#btn-to-4');
  var nb = blockingLeft();
  b.disabled = nb > 0;
  b.textContent = nb > 0
    ? 'Fix ' + nb + ' ' + (nb === 1 ? 'problem' : 'problems') + ' first'
    : 'Next: review and submit';
  $('#pr-warn-3').textContent = nb > 0
    ? 'You cannot submit while something would break on arrival.'
    : '';
}

function renderReview() {
  var env = envById(S.form.target);
  var keys = pickedKeys();
  var unack = warnLeft();

  $('#review').innerHTML =
    block('Going to', env.name + '  ·  ' + env.namespace + '  ·  ' + env.deployment) +
    block('Reference', (S.ws ? S.ws.ref : '—')) +
    block('Title', S.form.title) +
    block('What changed', S.form.what) +
    block('Why', S.form.why) +
    block('Risk', $('#pr-risk').selectedOptions[0].textContent) +
    block('When', $('#pr-window').selectedOptions[0].textContent) +
    block('How to undo it', S.form.rollback || 'Roll back to the previously deployed version.') +
    '<div class="rev-block"><h4>' + keys.length + ' items</h4><div class="rev-items">' +
      keys.map(function (k) {
        var c = byKey(k);
        return '<span class="tag">' + esc(c.name) + ' <span class="muted">v' + c.version + '</span></span>';
      }).join('') +
    '</div></div>' +
    (unack ? '<div class="banner banner-warn" style="margin-top:14px">' + unack +
      ' warning' + (unack === 1 ? '' : 's') + ' not confirmed yet. You can still submit, ' +
      'but they go on the request for the approver to see.</div>' : '');

  var stages = [];
  stages.push('<li><strong>' + esc(env.name) + '</strong> — ' +
    (env.approval === 'none' ? 'deploys straight away, usually within a minute'
      : env.approval === 'one' ? esc(env.approvers[0]) + ' reviews it, then it deploys automatically'
      : esc(env.approvers.join(' and ')) + ' both have to approve, then it deploys in the next change window'));
  stages.push('<li>You get a message when it lands, and this request moves to <strong>' +
    esc(env.name) + ' — deployed</strong>.</li>');
  stages.push('<li>Test it in ' + esc(env.name) + '. If it is wrong, fix it in your workspace and ' +
    'send a new version forward — the request keeps its history.</li>');
  if (env.next) {
    stages.push('<li>When you are happy, come back to <strong>My requests</strong> and send the ' +
      'same change on to <strong>' + esc(envById(env.next).name) + '</strong>. You will not have to ' +
      'pick the items again.</li>');
  } else {
    stages.push('<li>This is the last stop. Once it is in ' + esc(env.name) +
      ', your workspace closes and the items you were holding are released.</li>');
  }
  $('#after-flow').innerHTML = stages.join('');

  function block(h, v) {
    return '<div class="rev-block"><h4>' + esc(h) + '</h4><p>' + esc(v || '—') + '</p></div>';
  }
}

/* =====================================================================
 * 9. RENDER — requests, environments
 * ===================================================================== */

function renderRequests() {
  $('#req-list').innerHTML = REQUESTS.map(function (r) {
    var cur = r.stages.filter(function (s) { return s.state === 'done'; }).slice(-1)[0];
    var blocked = r.stages.some(function (s) { return s.state === 'rejected'; });
    var waiting = r.stages.filter(function (s) { return s.state === 'waiting'; })[0];
    var lastDone = cur ? envById(cur.env) : null;
    var canAdvance = !blocked && !waiting && lastDone && lastDone.next;

    var statusDot = blocked ? 'dot-err' : waiting ? 'dot-busy' : 'dot-ok';
    var statusTxt = blocked ? 'Sent back to you'
      : waiting ? 'Waiting for approval'
      : lastDone && !lastDone.next ? 'Live in Production'
      : 'Deployed to ' + (lastDone ? lastDone.name : '—');

    return '<div class="req">' +
      '<div class="req-head"><h3>' + esc(r.title) + '</h3>' +
      '<span class="status"><span class="dot ' + statusDot + '"></span>' + esc(statusTxt) + '</span>' +
      '<span class="req-id">' + esc(r.id) + '</span></div>' +
      '<div class="req-meta">' + esc(r.ref) + ' · ' + r.items + ' items · raised ' + esc(r.created) + '</div>' +
      '<div class="pipeline">' + r.stages.map(function (s) {
        var e = envById(s.env);
        var cls = s.state === 'done' ? 'is-done'
          : s.state === 'waiting' ? 'is-current'
          : s.state === 'rejected' ? 'is-blocked' : '';
        var dot = s.state === 'done' ? 'dot-ok'
          : s.state === 'waiting' ? 'dot-busy'
          : s.state === 'rejected' ? 'dot-err' : 'dot-idle';
        var word = s.state === 'done' ? 'Deployed'
          : s.state === 'waiting' ? 'Waiting'
          : s.state === 'rejected' ? 'Sent back' : 'Not yet';
        return '<div class="stage ' + cls + '">' +
          '<div class="stage-n"><span class="dot ' + dot + '"></span>' + esc(e.name) + '</div>' +
          '<div class="stage-s">' + esc(word) + (s.at ? ' · ' + esc(s.at) : '') + '</div>' +
          (s.note ? '<div class="stage-s">' + esc(s.note) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>' +
      '<div class="req-actions">' +
        (canAdvance ? '<button type="button" class="btn primary sm" data-adv="' + esc(r.id) +
          '">Send on to ' + esc(envById(lastDone.next).name) + '</button>' : '') +
        (blocked ? '<button type="button" class="btn sm" data-fix-req="' + esc(r.id) +
          '">Reopen it in my workspace</button>' : '') +
        (waiting ? '<button type="button" class="btn sm" data-nudge="' + esc(r.id) + '">Send a reminder</button>' : '') +
        '<button type="button" class="btn sm ghost" data-hist="' + esc(r.id) + '">Full history</button>' +
      '</div></div>';
  }).join('');

  $$('[data-adv]').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = reqById(b.getAttribute('data-adv'));
      var cur = r.stages.filter(function (s) { return s.state === 'done'; }).slice(-1)[0];
      var nx = envById(envById(cur.env).next);
      modal('Send ' + r.id + ' on to ' + nx.name + '?',
        '<p>The same ' + r.items + ' items go forward &mdash; you do not pick them again, ' +
        'and the safety check runs again against ' + esc(nx.name) + '.</p>' +
        '<p class="muted">' + (nx.approval === 'two'
          ? esc(nx.approvers.join(' and ')) + ' both have to approve, and it will go in during the next change window.'
          : esc(nx.approvers[0] || 'Nobody') + ' has to approve it.') + '</p>',
        [{ label: 'Not yet' },
         { label: 'Send it on', kind: 'primary', onClick: function () {
             r.stages.forEach(function (s) {
               if (s.env === nx.id) {
                 s.state = 'waiting';
                 s.note = 'Waiting for ' + (nx.approvers[0] || 'approval');
               }
             });
             renderRequests();
             toast(r.id + ' sent on to ' + nx.name);
           } }]);
    });
  });
  $$('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () { toast('Reminder sent'); });
  });
  $$('[data-fix-req]').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = reqById(b.getAttribute('data-fix-req'));
      modal('Reopen ' + r.id,
        '<p>This puts the items back into your workspace so you can change them, ' +
        'and keeps the request open with its history and the reason it came back.</p>' +
        '<p class="muted">The approver sees your new version when you send it forward again.</p>',
        [{ label: 'Cancel' },
         { label: 'Reopen it', kind: 'primary', onClick: function () {
             toast(r.id + ' reopened in your workspace');
             go('workspace');
           } }]);
    });
  });
  $$('[data-hist]').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = reqById(b.getAttribute('data-hist'));
      modal(r.id + ' — history',
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Who</th></tr></thead><tbody>' +
        '<tr><td class="nowrap">' + esc(r.created) + '</td><td>Change request raised, ' + r.items + ' items</td><td>You</td></tr>' +
        r.stages.filter(function (s) { return s.at; }).map(function (s) {
          return '<tr><td class="nowrap">' + esc(s.at) + '</td><td>' + esc(s.note || '') +
                 '</td><td>' + (s.state === 'rejected' ? 'm.silva' : 'Pipeline') + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<p class="muted" style="margin-top:12px">Every deployment records which exact ' +
        'version of each item went in, so any of these points can be restored.</p>',
        [{ label: 'Close' }]);
    });
  });
}

function reqById(id) {
  for (var i = 0; i < REQUESTS.length; i++) if (REQUESTS[i].id === id) return REQUESTS[i];
  return null;
}

function renderEnvironments() {
  $('#env-path').innerHTML = ENVIRONMENTS.map(function (e, i) {
    var node = '<div class="path-node' + (e.id === CURRENT_ENV ? ' is-here' : '') + '">' +
      '<div class="pn-name">' + esc(e.name) + (e.id === CURRENT_ENV ? ' — you are here' : '') + '</div>' +
      '<div class="pn-ns">' + esc(e.namespace) + '</div>' +
      '<div class="pn-app">' + (e.approval === 'none' ? 'No approval'
        : e.approval === 'one' ? '1 approval' : '2 approvals') +
        (e.autoDeploy ? ' · deploys itself' : ' · manual') + '</div></div>';
    return node + (i < ENVIRONMENTS.length - 1 ? '<span class="path-arrow">&rarr;</span>' : '');
  }).join('');

  $('#tbl-envs tbody').innerHTML = ENVIRONMENTS.map(function (e) {
    return '<tr>' +
      '<td class="nowrap"><span class="status"><span class="dot ' +
        (e.id === CURRENT_ENV ? 'dot-info' : 'dot-idle') + '"></span>' + esc(e.name) + '</span></td>' +
      '<td class="mono">' + esc(e.namespace) + '</td>' +
      '<td class="nowrap">' + (e.next ? esc(envById(e.next).name) : '<span class="muted">Last stop</span>') + '</td>' +
      '<td class="nowrap">' + (e.approval === 'none' ? 'None' : e.approval === 'one' ? '1 person' : '2 people') + '</td>' +
      '<td>' + (e.approvers.length ? esc(e.approvers.join(', ')) : '<span class="muted">—</span>') + '</td>' +
      '<td class="mono">' + esc(e.deployment) + '</td>' +
      '<td class="mono tech-only">' + esc(e.branch) + '</td>' +
      '<td class="right"><button type="button" class="btn sm ghost" data-env="' + esc(e.id) + '">Edit</button></td>' +
      '</tr>';
  }).join('');

  $$('[data-env]').forEach(function (b) {
    b.addEventListener('click', function () {
      var e = envById(b.getAttribute('data-env'));
      modal('Edit ' + e.name,
        '<div class="form-grid">' +
        fld('Environment name', e.name) +
        fld('Protected namespace', e.namespace) +
        fld('Sends changes to', e.next ? envById(e.next).name : 'Nothing — last stop') +
        fld('Approvals required', e.approval === 'none' ? '0' : e.approval === 'one' ? '1' : '2') +
        fld('Who approves', e.approvers.join(', ') || '—') +
        fld('Deployment', e.deployment) +
        '</div>' +
        '<p class="muted" style="margin-top:12px">Changing the promotion path affects ' +
        'everyone. Only an administrator can save here.</p>',
        [{ label: 'Close' }]);
      function fld(l, v) {
        return '<label class="fld"><span class="lbl">' + esc(l) + '</span>' +
               '<input type="text" value="' + esc(v) + '" disabled></label>';
      }
    });
  });

  $('#env-admin-note').textContent =
    'You are seeing this read-only. Your administrator sets the route, who signs ' +
    'changes off, and which namespace each environment runs in.';

  $('#tbl-rules tbody').innerHTML = TREATMENT.map(function (t) {
    return '<tr><td class="nowrap">' + esc(t.kind) + '</td><td>' + esc(t.how) +
           '</td><td class="muted">' + esc(t.why) + '</td></tr>';
  }).join('');
}

/* =====================================================================
 * 10. NAVIGATION
 * ===================================================================== */

function go(screen) {
  S.screen = screen;
  $$('.rail-item').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-screen') === screen);
  });
  $$('.screen').forEach(function (s) {
    s.classList.toggle('on', s.id === 'screen-' + screen);
  });
  if (screen === 'guide')        renderGuide();
  if (screen === 'workspace')    renderWorkspace();
  if (screen === 'changes')      renderChanges();
  if (screen === 'promote')      { renderPromoteIntro(); gotoStep(S.step); }
  if (screen === 'requests')     renderRequests();
  if (screen === 'environments') renderEnvironments();
  $('#pane').scrollTop = 0;
}

function gotoStep(n) {
  if (!S.ws && n > 1) {
    toast('Start a change first');
    go('workspace');
    return;
  }
  /* validate on the way forward only */
  if (n > 1 && S.step === 1 && !validateStep1()) return;
  if (n > 2 && S.step === 2 && pickedKeys().length === 0) {
    $('#pr-warn-2').textContent = 'Tick at least one item.';
    return;
  }
  $('#pr-warn-2').textContent = '';

  S.step = n;
  $$('.step').forEach(function (s) {
    var i = +s.getAttribute('data-step');
    s.classList.toggle('on', i === n);
    s.classList.toggle('done', i < n);
  });
  $$('.wizard-pane').forEach(function (p) {
    p.classList.toggle('on', +p.getAttribute('data-pane') === n);
  });
  if (n === 2) renderPick();
  if (n === 3) runCheck();
  if (n === 4) renderReview();
  $('#pane').scrollTop = 0;
}

function validateStep1() {
  var ok = true;
  S.form.target   = $('#pr-target').value;
  S.form.title    = $('#pr-title').value.trim();
  S.form.what     = $('#pr-what').value.trim();
  S.form.why      = $('#pr-why').value.trim();
  S.form.risk     = $('#pr-risk').value;
  S.form.window   = $('#pr-window').value;
  S.form.rollback = $('#pr-rollback').value.trim();

  [['#pr-title', S.form.title], ['#pr-what', S.form.what], ['#pr-why', S.form.why]]
    .forEach(function (p) {
      var el = $(p[0]);
      var bad = !p[1];
      el.classList.toggle('bad', bad);
      if (bad) ok = false;
    });
  $('#pr-warn-1').textContent = ok ? '' : 'Title, what changed and why are all required — the approver reads them.';
  return ok;
}

/* =====================================================================
 * 11. WIRING
 * ===================================================================== */

function wire() {
  $$('.rail-item').forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-screen')); });
  });

  $('#btn-jargon').addEventListener('click', function () {
    S.tech = !S.tech;
    document.body.classList.toggle('tech', S.tech);
    this.textContent = S.tech ? 'Hide the technical names' : 'Show the technical names';
    $('#rail-note').textContent = S.tech
      ? 'Showing branches, namespaces and pipeline names alongside the plain-language labels.'
      : 'Plain language is on. Turn this on to see the Git and pipeline terms behind each step.';
  });

  $('#btn-ws-start').addEventListener('click', function () {
    var ref = $('#ws-ref').value.trim();
    var title = $('#ws-title').value.trim();
    if (!ref || !title) {
      $('#ws-start-warn').textContent = 'Both a reference and a description are needed.';
      $('#ws-ref').classList.toggle('bad', !ref);
      $('#ws-title').classList.toggle('bad', !title);
      return;
    }
    $('#ws-start-warn').textContent = '';
    DATA.startWorkspace(ref, title, $('#ws-base').value).then(function () {
      S.form.title = title;
      $('#pr-title').value = title;
      renderHeader();
      renderWorkspace();
      toast('Change ' + ref + ' started — it is yours alone until you send it forward');
    });
  });

  $('#btn-goto-promote').addEventListener('click', function () { go('promote'); });

  $('#btn-adopt').addEventListener('click', adoptOrphans);
  $('#btn-orphan-check').addEventListener('click', function () { runCollisionCheck(false); });

  /* welcome */
  $('#welcome-x').addEventListener('click', closeWelcome);
  $('#w-go').addEventListener('click', closeWelcome);
  $('#w-guide').addEventListener('click', function () { closeWelcome(); go('guide'); });

  $('#btn-ws-sync').addEventListener('click', function () {
    var n = $('#ws-sync-note');
    n.hidden = false;
    n.textContent = 'Checking what has changed in Production since you started…';
    setTimeout(function () {
      n.innerHTML = 'Up to date. Two changes landed in Production since you started ' +
        '(<code>Demo.ADT.Service.HISAdtIn</code> and a lookup table) and neither touches ' +
        'anything you are working on, so nothing of yours was affected.';
    }, 700);
  });

  $('#btn-refresh').addEventListener('click', function () {
    var b = this;
    b.disabled = true; b.textContent = 'Reading…';
    DATA.refresh().then(function () {
      renderHeader();
      go(S.screen);
      toast(wsChanges().length + ' in this change, ' + S.orphans.length + ' unassigned');
    }).catch(function (e) {
      if (e.auth) { authWall(function () { $('#btn-refresh').click(); }); }
      else { toast('Could not read the namespace: ' + e.message); }
    }).then(function () {
      b.disabled = false; b.textContent = 'Refresh';
    });
  });

  $('#btn-reset-baseline').addEventListener('click', function () {
    modal('Start from zero?',
      '<p>Everything that exists in <strong>' + esc(S.namespace) + '</strong> right now ' +
      'becomes the starting point, and the change list goes empty.</p>' +
      '<p class="muted">Nothing is deleted — no production, transformation or rule is ' +
      'touched. This only moves the line that says what counts as new.</p>',
      [{ label: 'Cancel' },
       { label: 'Start from zero', kind: 'primary', onClick: function () {
           DATA.reset().then(function () {
             S.picked = {}; S.orphanPick = {}; S.waived = {}; S.step = 1;
             renderHeader();
             go('workspace');
             toast('Baseline set. Zero changes.');
           }).catch(function (e) { toast('Failed: ' + e.message); });
         } }]);
  });

  $('#btn-ws-abandon').addEventListener('click', function () {
    modal('Abandon this change?',
      '<p>All ' + wsChanges().length + ' items go back to how they were, and everything ' +
      'you are holding is released for other people.</p>' +
      '<p class="muted">There is no undo.</p>',
      [{ label: 'Keep working' },
       { label: 'Abandon it', kind: 'danger', onClick: function () {
           var done = function () {
             S.picked = {}; S.step = 1; S.waived = {};
             renderHeader(); renderWorkspace();
             toast('Change abandoned');
           };
           if (LIVE) {
             api('/workspace', { method: 'DELETE' })
               .then(function (st) { applyState(st); done(); })
               .catch(function (e) { toast('Failed: ' + e.message); });
           } else {
             S.ws = null;
             done();
           }
         } }]);
  });

  $('#btn-request-handover').addEventListener('click', function () {
    var other = S.claims.filter(function (c) { return c.state === 'other'; })[0];
    if (other) askHandover(other.by);
  });
  $('#btn-conflict-dismiss').addEventListener('click', function () {
    $('#conflict-card').hidden = true;
  });

  ['#chg-search', '#chg-type', '#chg-source'].forEach(function (s) {
    $(s).addEventListener('input', renderChanges);
    $(s).addEventListener('change', renderChanges);
  });

  $('#pr-target').addEventListener('change', function () {
    S.form.target = this.value;
    S.waived = {};
    updateTargetHint();
  });

  $$('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () { gotoStep(+b.getAttribute('data-goto')); });
  });
  $$('.step').forEach(function (s) {
    s.addEventListener('click', function () {
      var n = +s.getAttribute('data-step');
      if (n < S.step) gotoStep(n);   /* backwards only */
    });
  });

  $('#pick-all').addEventListener('click', function () {
    wsChanges().forEach(function (c) { S.picked[c.key] = true; });
    renderPick();
  });
  $('#pick-none').addEventListener('click', function () {
    S.picked = {};
    renderPick();
  });

  $('#btn-recheck').addEventListener('click', function () {
    S.waived = {};
    runCheck();
    toast('Checked again');
  });

  $('#btn-submit').addEventListener('click', submit);

  $('#modal-close').addEventListener('click', function () { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', function (e) {
    if (e.target === this) this.hidden = true;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#modal').hidden) $('#modal').hidden = true;
  });
}

function submit() {
  if (!validateStep1()) { gotoStep(1); return; }
  var keys = pickedKeys();
  if (!keys.length) { gotoStep(2); return; }
  if (blockingLeft()) { gotoStep(3); return; }

  var env = envById(S.form.target);
  DATA.submit({
    target: S.form.target,
    title: S.form.title,
    what: S.form.what,
    why: S.form.why,
    risk: S.form.risk,
    window: S.form.window,
    rollback: S.form.rollback,
    items: keys
  }).then(function (res) {
    modal('Change request ' + res.id + ' raised',
      '<p><strong>' + keys.length + ' items</strong> are on their way to <strong>' +
      esc(env.name) + '</strong>.</p>' +
      '<p>' + (env.approval === 'none'
        ? 'No approval is needed here. It should be deployed within a minute or two.'
        : esc(env.approvers.join(' and ')) + ' ' + (env.approval === 'two' ? 'have' : 'has') +
          ' been notified. You will get a message when it is approved and again when it lands.') + '</p>' +
      '<p class="muted">Your workspace stays open. You can keep working &mdash; anything you ' +
      'change from now on belongs to the next change request, not this one.</p>',
      [{ label: 'See my requests', kind: 'primary', onClick: function () {
           S.step = 1; S.picked = {}; S.waived = {};
           renderHeader();
           go('requests');
         } }]);
  });
}

/* =====================================================================
 * 12. WELCOME
 *
 * Shown the first time the tool is opened in a browser. The persona meets this
 * once and then never wants to see it again, so it is dismissible for good and
 * the same content lives permanently under "How this works".
 * ===================================================================== */

var WELCOME_KEY = 'hcccicd.welcome.hidden';

function maybeShowWelcome() {
  var hidden = false;
  try { hidden = localStorage.getItem(WELCOME_KEY) === '1'; } catch (e) {}
  if (hidden) return;
  $('#w-orphan').hidden = !S.orphans.length;
  $('#welcome').hidden = false;
}

function closeWelcome() {
  if ($('#w-hide').checked) {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
  }
  $('#welcome').hidden = true;
}

/* =====================================================================
 * 13. BOOT
 * ===================================================================== */

function boot() {
  wire();

  var p = new URLSearchParams(location.search);
  if (p.get('ns')) S.namespace = p.get('ns');
  LIVE = p.get('live') === '1';
  $('#live-tools').hidden = !LIVE;

  DATA.whoami().then(function (me) {
    if (me && me.username) {
      S.user = me.username;
      if (!p.get('ns')) S.namespace = me.namespace || S.namespace;
    }

    /* Two starting states.
     *
     * Default — a change is already open with everything captured. This is the
     * happy path and the better demo of the safety check.
     *
     * ?fresh=1 — no change open, and seven items already captured without one.
     * This is the recovery scenario: the builder started work before opening
     * this tool, which is what most of them will actually do the first time. */
    if (LIVE) {
      /* Nothing is seeded. The namespace is the source of truth. */
      return DATA.refresh().then(function () {
        renderHeader();
        go('workspace');
        maybeShowWelcome();
      }).catch(function (e) {
        renderHeader();
        go('workspace');
        if (e.auth) { authWall(boot); return; }
        modal('Cannot reach the live capture service',
          '<p>' + esc(e.message) + '</p>' +
          '<p class="muted">The tool is running against <code>/api/hcccicd</code>. ' +
          'Check that the installer created the web application: ' +
          '<code>do ##class(HCCCICD.Install.Setup).Status()</code></p>',
          [{ label: 'Close' }]);
      });
    }

    if (p.get('fresh')) {
      S.orphans = ORPHAN_KEYS.slice();
      S.orphans.forEach(function (k) { S.orphanPick[k] = true; });
      S.claims = CLAIMS.filter(function (c) { return c.state === 'other'; });
      $('#orphan-title').value = 'Lab results feed to the LIS';
    } else {
      S.wsKeys = CHANGES.map(function (c) { return c.key; });
      DEFAULT_PICK.forEach(function (k) { S.picked[k] = true; });
      S.ws = {
        ref: 'INT-4821',
        title: 'Outbound lab results to the LIS',
        base: 'prod',
        started: '2026-07-21 09:10',
        branch: 'interface/' + S.user.toLowerCase().replace(/[^a-z0-9]+/g, '') + '/INT-4821',
        usrns: 'USR' + S.user.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
      };
      S.form.title = S.ws.title;
      $('#pr-title').value = S.ws.title;
      $('#pr-what').value = 'New inbound HL7 service for lab results over MLLP on port 5100, ' +
        'a transformation to the LIS result format, and a routing rule that sends ORU^R01 to ' +
        'the analyser and everything else to the dead letter file. The existing ADT router now ' +
        'also drops duplicate A08 messages arriving within 60 seconds.';
      $('#pr-why').value = 'The lab has replaced their analyser and the old feed is switched off ' +
        'on 30 September. Ticket INT-4821.';
      $('#pr-rollback').value = 'Disable the new lab service and redeploy the previous version ' +
        'of the ADT router. No data migration is involved.';
    }

    renderHeader();
    go('workspace');
    maybeShowWelcome();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})();
