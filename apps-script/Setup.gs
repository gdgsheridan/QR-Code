/**
 * Station — Form + Sheet setup (README "Connecting a Google Form"). Lives next to Code.gs in the
 * same Apps Script project; it uses SHEET_NAME and headerMap_ from Code.gs.
 *
 * setupTestForm: run ONCE from a NEW, EMPTY Google Sheet:
 *   1. sheets.new → Extensions → Apps Script
 *   2. Paste apps-script/Code.gs from the repo into Code.gs, then add a file "Setup" with THIS code
 *   3. Fill in CONFIG below → select setupTestForm → Run → approve the permissions prompt
 *   4. View → Logs (or the Execution log) shows the form link to open
 *
 * Question titles below must match HEADERS in Code.gs exactly; don't rename them.
 */
const CONFIG = {
  // Your stable tunnel URL (README) or your deployed app, + /api/ingest/sheet
  ENDPOINT: 'https://YOUR-MACHINE.YOUR-TAILNET.ts.net/api/ingest/sheet',
  EVENT_SLUG: 'test-2026',
  INGEST_SECRET: 'PASTE_SHEET_INGEST_SECRET_FROM_.env.local',
};

function setupTestForm() {
  if (CONFIG.ENDPOINT.includes('YOUR-MACHINE') || CONFIG.INGEST_SECRET.length < 32) {
    throw new Error('Fill in CONFIG first (ENDPOINT and INGEST_SECRET).');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheets().some(s => s.getFormUrl())) {
    throw new Error('This spreadsheet already has a linked form. Run setup from a new, empty Sheet.');
  }

  // 1. The form.
  const form = FormApp.create('Station Test — Event Application');
  form.setDescription('Test form for the Station check-in app. Fake names and emails are fine.')
      .setCollectEmail(false)          // "Email Address" is a normal question instead (matches Code.gs)
      .setAllowResponseEdits(false);
  form.addTextItem().setTitle('First Name').setRequired(true);
  form.addTextItem().setTitle('Last Name');
  form.addTextItem().setTitle('Email Address').setRequired(true)
      .setValidation(FormApp.createTextValidation().setHelpText('Enter a valid email.').requireTextIsEmail().build());
  form.addParagraphTextItem().setTitle('Dietary Restrictions');
  form.addTextItem().setTitle('LinkedIn URL').setHelpText('Optional, e.g. https://www.linkedin.com/in/your-name')
      .setValidation(FormApp.createTextValidation().setHelpText('Enter a full URL.').requireTextIsUrl().build());

  // 2. Send responses to this spreadsheet and wait for the response tab to appear.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  const sheet = waitForResponseSheet_(ss.getId(), 6); // Timestamp + 5 questions
  if (sheet.getName() !== SHEET_NAME) sheet.setName(SHEET_NAME); // SHEET_NAME comes from Code.gs

  // 3. The three organizer columns, with a dropdown on Status (blank = pending). Since SPEC v0.4
  //    Station ignores Status (acceptance comes from the RSVP); keep it for your own notes.
  const lastCol = sheet.getLastColumn();
  sheet.getRange(1, lastCol + 1, 1, 3).setValues([['Applicant ID', 'Status', 'Sync Status']]);
  const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Accepted', 'Waitlisted', 'Rejected', 'Withdrawn'], true)
      .setAllowInvalid(false)
      .build();
  sheet.getRange(2, lastCol + 2, sheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
  sheet.setFrozenRows(1);

  // 4. Script properties read by Code.gs.
  PropertiesService.getScriptProperties().setProperties({
    ENDPOINT: CONFIG.ENDPOINT,
    EVENT_SLUG: CONFIG.EVENT_SLUG,
    INGEST_SECRET: CONFIG.INGEST_SECRET,
  });

  // 5. Installable triggers (replacing any earlier copies).
  installTriggers_(ss);

  Logger.log('Open this to submit test applications: ' + form.getPublishedUrl());
  Logger.log('Edit the form: ' + form.getEditUrl());
  Logger.log('Responses land on the "' + SHEET_NAME + '" tab of this Sheet.');
}

/** Point the Sheet at a different app URL (e.g. moving from your tunnel to Vercel): edit CONFIG.ENDPOINT, run this. */
function updateEndpoint() {
  PropertiesService.getScriptProperties().setProperty('ENDPOINT', CONFIG.ENDPOINT);
  Logger.log('ENDPOINT is now ' + CONFIG.ENDPOINT);
}

/**
 * For an EXISTING form that already has responses: after adding the Applicant ID / Status / Sync Status
 * columns and Code.gs, run this once. Rows submitted before the script existed have no Applicant ID and
 * would come back INVALID:external_id when accepted. Only fills blank cells, so it is safe to re-run.
 */
function backfillApplicantIds() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No tab named "' + SHEET_NAME + '". Rename the response tab or change SHEET_NAME in Code.gs.');
  const cols = headerMap_(sheet);
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  const range = sheet.getRange(2, cols.id, n, 1);
  range.setValues(range.getValues().map(([v]) => [v || Utilities.getUuid()]));
  Logger.log('Checked ' + n + ' rows; blank Applicant IDs filled.');
}

/** For an EXISTING Sheet: set script properties from CONFIG and install both triggers (no new form). */
function connectExistingSheet() {
  if (CONFIG.ENDPOINT.includes('YOUR-MACHINE') || CONFIG.INGEST_SECRET.length < 32) {
    throw new Error('Fill in CONFIG first (ENDPOINT and INGEST_SECRET).');
  }
  PropertiesService.getScriptProperties().setProperties({
    ENDPOINT: CONFIG.ENDPOINT,
    EVENT_SLUG: CONFIG.EVENT_SLUG,
    INGEST_SECRET: CONFIG.INGEST_SECRET,
  });
  installTriggers_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Connected to ' + CONFIG.ENDPOINT + ' for event ' + CONFIG.EVENT_SLUG + '.');
}

function installTriggers_(ss) {
  const handlers = ['onFormSubmitInstalled', 'onEditInstalled'];
  ScriptApp.getProjectTriggers()
      .filter(t => handlers.indexOf(t.getHandlerFunction()) !== -1)
      .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitInstalled').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();
}

function waitForResponseSheet_(spreadsheetId, minCols) {
  for (let i = 0; i < 20; i++) {
    SpreadsheetApp.flush();
    const sheet = SpreadsheetApp.openById(spreadsheetId).getSheets().find(s => s.getFormUrl());
    if (sheet && sheet.getLastColumn() >= minCols) return sheet;
    Utilities.sleep(1000);
  }
  throw new Error('The linked response tab did not appear. Delete this Sheet and re-run in a fresh one.');
}
