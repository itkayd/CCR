// TNDS (TransXChange) operator parsing. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendly, parseTxc } from './tnds.ts';

// minimal TransXChange 2.4 document, shaped like the London TNDS files
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<TransXChange xmlns="http://www.transxchange.org.uk/" SchemaVersion="2.4">
  <Operators>
    <Operator id="OId_SEL">
      <NationalOperatorCode>SELK</NationalOperatorCode>
      <OperatorShortName>Stagecoach</OperatorShortName>
      <TradingName>Stagecoach London</TradingName>
    </Operator>
  </Operators>
  <Services>
    <Service>
      <ServiceCode>25</ServiceCode>
      <Lines><Line id="SL1"><LineName>25</LineName></Line><Line id="SL2"><LineName>N25</LineName></Line></Lines>
      <RegisteredOperatorRef>OId_SEL</RegisteredOperatorRef>
    </Service>
  </Services>
</TransXChange>`;

test('reads line names and the registered operator', () => {
  const out = parseTxc(XML);
  assert.deepEqual(out.map((e) => e.line), ['25', 'N25']);
  assert.equal(out[0].operator, 'Stagecoach London');
  assert.equal(out[0].noc, 'SELK');
});

test('maps legal names to the brands riders know', () => {
  assert.equal(friendly('London General Transport Services Ltd'), 'Go-Ahead London');
  assert.equal(friendly('East London Bus & Coach Company'), 'Stagecoach London');
  assert.equal(friendly('London United Busways'), 'Transport UK London Bus');
  assert.equal(friendly('Metroline Travel Ltd'), 'Metroline');
});
