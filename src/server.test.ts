import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './server.js';
import { buildDashboardData } from './aggregator.js';

// Regression guard for the "dashboard almost never opens on Windows" bug:
// the server binds 127.0.0.1 (IPv4 loopback only, by design — see the
// security comment in server.ts), but it used to open/report
// `http://localhost:<port>`. On Windows `localhost` resolves to ::1 (IPv6)
// first, where nothing listens, so the browser hangs in SYN_SENT and the
// dashboard "almost never" comes up. The opened URL must therefore use the
// same loopback literal the server actually binds.
test('startServer reports a reachable URL using the 127.0.0.1 loopback literal, not "localhost"', async () => {
  const data = buildDashboardData([]);
  // Fixed uncommon port; startServer's findFreePort scans a +20 window from
  // here, so a busy base port still resolves without flaking. (port 0 is
  // unusable: findFreePort overloads 0 as its "no free port" sentinel.)
  const handle = await startServer(data, { port: 38765, open: false });
  try {
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/?$/);

    const res = await fetch(handle.url);
    assert.equal(res.status, 200);
  } finally {
    handle.stop();
  }
});
