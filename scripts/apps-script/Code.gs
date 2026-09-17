/**
 * Runway bridge for Google Apps Script (script.google.com).
 * Runs under Dylan's Google account, so the web app never needs a Gmail scope.
 *
 * Jobs:
 *   syncPiazza  every 15 minutes: posts recent Piazza emails to Runway. Runway ignores ids it has seen.
 *   sendDigest  daily near 8am Toronto: fetches the morning digest from Runway and emails it to you.
 *
 * Script properties (Project Settings > Script properties):
 *   RUNWAY_URL     your app URL with no trailing slash, e.g. https://runway-dylan.vercel.app
 *   RUNWAY_SECRET  the same value as INGEST_WEBHOOK_SECRET in Vercel
 *   DIGEST_TO      the address that should receive the digest
 *
 * First run: pick setup in the function menu, click Run, and approve the permissions.
 * Every request is signed: HMAC-SHA256 over "<timestamp>.<body>", hex encoded,
 * sent in x-runway-timestamp and x-runway-signature. Bodies are ASCII-only JSON,
 * so the signature doesn't depend on character encoding.
 */

var PIAZZA_QUERY = 'from:piazza.com newer_than:2d';
var LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
var MAX_BODY_CHARS = 150000;
var BATCH_SIZE = 10;

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('syncPiazza').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('sendDigest').timeBased().atHour(8).everyDays(1).inTimezone('America/Toronto').create();
  ping();
  syncPiazza();
}

function ping() {
  var res = signedFetch_('/api/ingest/ping', 'post', asciiJson_({ at: new Date().toISOString() }));
  console.log('Ping: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
}

function syncPiazza() {
  var cutoff = Date.now() - LOOKBACK_MS;
  var messages = [];
  GmailApp.search(PIAZZA_QUERY, 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      if (m.getDate().getTime() < cutoff) return;
      messages.push({
        id: m.getId(),
        threadId: thread.getId(),
        date: m.getDate().toISOString(),
        from: m.getFrom(),
        subject: m.getSubject(),
        text: m.getPlainBody().slice(0, MAX_BODY_CHARS),
        html: m.getBody().slice(0, MAX_BODY_CHARS)
      });
    });
  });
  for (var i = 0; i < messages.length; i += BATCH_SIZE) {
    var body = asciiJson_({ source: 'piazza', messages: messages.slice(i, i + BATCH_SIZE) });
    var res = signedFetch_('/api/ingest/email', 'post', body);
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('Ingest failed: ' + code + ' ' + res.getContentText().slice(0, 500));
    }
  }
}

function sendDigest() {
  var res = signedFetch_('/api/digest', 'get', '');
  if (res.getResponseCode() !== 200) {
    console.error('Digest failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 500));
    return;
  }
  var digest = JSON.parse(res.getContentText());
  if (!digest.send) return;
  var to = PropertiesService.getScriptProperties().getProperty('DIGEST_TO');
  GmailApp.sendEmail(to, digest.subject, digest.text, { htmlBody: digest.html, name: 'Runway' });
}

function signedFetch_(path, method, body) {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('RUNWAY_URL');
  var secret = props.getProperty('RUNWAY_SECRET');
  if (!baseUrl || !secret) throw new Error('Set RUNWAY_URL and RUNWAY_SECRET in Script properties.');
  var timestamp = String(Math.floor(Date.now() / 1000));
  var signature = hex_(
    Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8)
  );
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      'x-runway-timestamp': timestamp,
      'x-runway-signature': signature
    }
  };
  if (method === 'post') {
    options.contentType = 'application/json';
    options.payload = body;
  }
  return UrlFetchApp.fetch(baseUrl + path, options);
}

// JSON with every non-ASCII character escaped as \uXXXX.
function asciiJson_(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function hex_(bytes) {
  return bytes
    .map(function (b) {
      var v = (b + 256) % 256;
      return (v < 16 ? '0' : '') + v.toString(16);
    })
    .join('');
}
