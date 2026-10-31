// Station ↔ Google Sheet bridge. SPEC Appendix A (verbatim). Setup steps are in SPEC Appendix A.
// Script properties: ENDPOINT, EVENT_SLUG, INGEST_SECRET. Triggers: onFormSubmitInstalled, onEditInstalled.

const SHEET_NAME = 'Form Responses 1';
const HEADERS = {
  id: 'Applicant ID', email: 'Email Address', first: 'First Name', last: 'Last Name',
  dietary: 'Dietary Restrictions', linkedin: 'LinkedIn URL', status: 'Status', sync: 'Sync Status',
};
// v0.4: Status is optional and ignored by Station (acceptance comes from the RSVP, SPEC F13).
const REQUIRED = ['id', 'email', 'first', 'sync'];

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing script property ' + k);
  return v;
}

function headerMap_(sheet) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const byName = {};
  row.forEach((h, i) => { byName[String(h).trim()] = i + 1; });
  const cols = {};
  Object.keys(HEADERS).forEach(k => { cols[k] = byName[HEADERS[k]] || 0; });
  REQUIRED.forEach(k => { if (!cols[k]) throw new Error('Missing header: ' + HEADERS[k]); });
  return cols;
}

function onFormSubmitInstalled(e) {
  const sheet = e.range.getSheet();
  const cols = headerMap_(sheet);
  const cell = sheet.getRange(e.range.getRow(), cols.id);
  if (!cell.getValue()) cell.setValue(Utilities.getUuid());
  syncRows_(sheet, cols, e.range.getRow(), e.range.getRow()); // v0.4: import new applicants right away
}

function onEditInstalled(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  const cols = headerMap_(sheet);
  const r = e.range;
  if (r.getColumn() === cols.sync && r.getLastColumn() === cols.sync) return; // only Sync Status edited
  const first = Math.max(r.getRow(), 2);          // skip header row
  const last = r.getLastRow();
  if (last < first) return;
  syncRows_(sheet, cols, first, last);
}

function syncRows_(sheet, cols, first, last) {
  const values = sheet.getRange(first, 1, last - first + 1, sheet.getLastColumn()).getValues();
  const get = (v, k) => (cols[k] ? String(v[cols[k] - 1]).trim() : '');
  const rows = values.map(v => ({
    external_id: get(v, 'id'), email: get(v, 'email'), first_name: get(v, 'first'),
    last_name: get(v, 'last'), dietary_notes: get(v, 'dietary'),
    linkedin_url: get(v, 'linkedin'), status: get(v, 'status'),
  }));
  const body = JSON.stringify({ event_slug: prop_('EVENT_SLUG'), rows: rows });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, prop_('INGEST_SECRET'),
                                                         Utilities.Charset.UTF_8));
  let out;
  try {
    const res = UrlFetchApp.fetch(prop_('ENDPOINT'), {
      method: 'post', contentType: 'application/json; charset=utf-8', payload: body,
      headers: { 'X-Station-Timestamp': ts, 'X-Station-Signature': sig },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const stamp = new Date().toISOString();
    out = code === 200
      ? JSON.parse(res.getContentText()).results.map(x => [x.result + ' ' + stamp])
      : rows.map(() => ['ERROR HTTP ' + code + ' ' + stamp]);
  } catch (err) {
    out = rows.map(() => ['ERROR ' + String(err).slice(0, 80)]);
  }
  sheet.getRange(first, cols.sync, out.length, 1).setValues(out); // script edits don't re-fire onEdit
}

function hex_(bytes) {
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
