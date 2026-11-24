import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SAWS_FILE_NAME,
  parseCapAlert,
  parseSawsFeed,
  sawsBand,
  sawsCapUrl,
} from './cap.js';

const NAME = 'GP_CAP_SevereThunderstorms_20261124_085823.xml';
const POLY =
  '-28.04722,32.20281 -28.1265,32.18901 -28.14261,32.15457 -28.04722,32.20281';

function rssItem(guid, title = ' Severe Thunderstorms') {
  return `<item><guid isPermaLink="true">${guid}</guid><link>${guid}</link><title>${title}</title><description>d</description><pubDate>Tue, 24 Nov 2026 08:56:52 +0200</pubDate></item>`;
}

function rss(...items) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;
}

function area(desc, polygon) {
  return `<area><areaDesc>${desc}</areaDesc><polygon>${polygon}</polygon></area>`;
}

function info({
  event = 'Damaging Winds',
  level = 'Warning Level 4',
  onset = '2026-11-24T13:00:00+02:00',
  expires = '2026-11-24T22:59:59+02:00',
  description = 'd',
  areas = area('Zone A', POLY),
} = {}) {
  return `<info><language>en-EN</language><category>Met</category><event>${event}</event><urgency>Immediate</urgency><severity>Minor</severity><certainty>Observed</certainty>${onset ? `<onset>${onset}</onset>` : ''}<expires>${expires}</expires><senderName>SAWS</senderName><headline>${event}</headline><description>${description}</description><instruction>Stay in</instruction><web>https://www.weathersa.co.za</web><contact></contact><parameter><valueName>alertType</valueName><value>${level}</value></parameter>${areas}</info>`;
}

function alert(...infos) {
  return `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>abc.2026.11.24.08.14.12</identifier><sender>s</sender><sent>2026-11-24T08:14:12+02:00</sent><status>Actual</status><msgType>Update</msgType><scope>Restricted</scope>${infos.join('')}</alert>`;
}

test('parseSawsFeed collapses repeated guids and parses the name', () => {
  const url = `https://www.weathersa.co.za/Documents/Warnings/${NAME}`;
  const feed = parseSawsFeed(
    rss(rssItem(url), rssItem(url), rssItem(`http://www.weathersa.co.za/Documents/Warnings/WC_CAP_HighSeas_20261124_090000.xml`)),
  );
  assert.equal(feed.length, 2);
  assert.deepEqual(feed[0], {
    name: NAME,
    office: 'GP',
    hazard: 'SevereThunderstorms',
    nameMs: Date.parse('2026-11-24T08:58:23+02:00'),
  });
  assert.equal(feed[1].name, 'WC_CAP_HighSeas_20261124_090000.xml');
  assert.equal(feed[1].office, 'WC');
});

test('parseSawsFeed skips names that fail the pattern', () => {
  const base = 'https://www.weathersa.co.za/Documents/Warnings/';
  const feed = parseSawsFeed(
    rss(
      rssItem(`${base}../x.xml`),
      rssItem(`${base}GP_CAP_X_2026.xml`),
      rssItem(`${base}GP_CAP_Storm_20261124_085823.xml?y=1`),
    ),
  );
  assert.deepEqual(feed, []);
});

test('parseSawsFeed rejects a non-RSS body', () => {
  assert.throws(() => parseSawsFeed('<html></html>'), /invalid_saws_feed/);
});

test('sawsCapUrl rebuilds the fixed URL and refuses bad names', () => {
  assert.ok(SAWS_FILE_NAME.test(NAME));
  assert.equal(
    sawsCapUrl(NAME),
    `https://www.weathersa.co.za/Documents/Warnings/${NAME}`,
  );
  assert.throws(() => sawsCapUrl('../x.xml'), /invalid_saws_name/);
  assert.throws(() => sawsCapUrl(`${NAME}?y=1`), /invalid_saws_name/);
});

test('sawsBand maps levels to colours', () => {
  assert.equal(sawsBand(1), 'yellow');
  assert.equal(sawsBand(4), 'yellow');
  assert.equal(sawsBand(5), 'orange');
  assert.equal(sawsBand(8), 'orange');
  assert.equal(sawsBand(9), 'red');
  assert.equal(sawsBand(10), 'red');
  assert.equal(sawsBand(0), null);
  assert.equal(sawsBand(11), null);
  assert.equal(sawsBand(null), null);
});

test('parseCapAlert reads every info in a file', () => {
  const cap = parseCapAlert(
    alert(info(), info({ level: 'Warning Level 2', event: 'Heavy Rain' })),
  );
  assert.equal(cap.identifier, 'abc.2026.11.24.08.14.12');
  assert.equal(cap.sentMs, Date.parse('2026-11-24T08:14:12+02:00'));
  assert.equal(cap.status, 'Actual');
  assert.equal(cap.msgType, 'Update');
  assert.equal(cap.infos.length, 2);
  const [a, b] = cap.infos;
  assert.equal(a.level, 4);
  assert.equal(b.level, 2);
  assert.equal(a.band, 'yellow');
  assert.equal(b.band, 'yellow');
  assert.equal(a.levelText, 'Warning Level 4');
  assert.equal(a.event, 'Damaging Winds');
  assert.equal(a.severity, 'Minor');
  assert.equal(a.onsetMs, Date.parse('2026-11-24T13:00:00+02:00'));
  assert.equal(a.expiresMs, Date.parse('2026-11-24T22:59:59+02:00'));
  assert.equal(a.instruction, 'Stay in');
  assert.equal(a.areas[0].desc, 'Zone A');
});

test('parseCapAlert swaps lat,lon pairs and closes rings', () => {
  const unclosed = '-28.0,32.0 -28.1,32.1 -28.2,32.2';
  const cap = parseCapAlert(
    alert(info({ areas: area('Closed', POLY) + area('Open', unclosed) })),
  );
  const [closed, open] = cap.infos[0].areas;
  assert.deepEqual(closed.ring[0], [32.20281, -28.04722]);
  assert.equal(closed.ring.length, 4);
  assert.equal(open.ring.length, 4);
  assert.deepEqual(open.ring[3], open.ring[0]);
});

test('parseCapAlert skips a bad polygon but keeps the others', () => {
  const good = area('Good', POLY);
  for (const bad of [
    '-28.0,32.0 -28.1,32.1',
    '-28.0,32.0 NaN,32.1 -28.2,32.2 -28.0,32.0',
    '95,32.0 -28.1,32.1 -28.2,32.2 95,32.0',
  ]) {
    const cap = parseCapAlert(alert(info({ areas: area('Bad', bad) + good })));
    assert.deepEqual(
      cap.infos[0].areas.map((a) => a.desc),
      ['Good'],
    );
  }
});

test('parseCapAlert drops an info with no event, expiry or valid area', () => {
  const cap = parseCapAlert(
    alert(
      info(),
      info({ event: '' }),
      info({ expires: 'soon' }),
      info({ areas: area('Bad', '1,2') }),
    ),
  );
  assert.equal(cap.infos.length, 1);
});

test('parseCapAlert gives onsetMs null when onset is absent', () => {
  const cap = parseCapAlert(alert(info({ onset: '' })));
  assert.equal(cap.infos[0].onsetMs, null);
});

test('parseCapAlert decodes entities', () => {
  const cap = parseCapAlert(
    alert(
      info({
        description:
          'a &amp; b &lt; c &#8211; d &#x2019; <![CDATA[x <b> &amp; y]]>',
      }),
    ),
  );
  assert.equal(
    cap.infos[0].description,
    'a & b < c – d ’ x <b> &amp; y',
  );
});

test('parseCapAlert keeps a level it cannot read as null', () => {
  const cap = parseCapAlert(alert(info({ level: 'Advisory' })));
  const [i] = cap.infos;
  assert.equal(i.level, null);
  assert.equal(i.band, null);
  assert.equal(i.levelText, 'Advisory');
});

test('parseCapAlert rejects a file that is not CAP', () => {
  assert.throws(() => parseCapAlert('<html></html>'), /invalid_cap/);
  assert.throws(
    () => parseCapAlert('<alert><sent>2026-11-24T08:14:12+02:00</sent></alert>'),
    /invalid_cap/,
  );
});
