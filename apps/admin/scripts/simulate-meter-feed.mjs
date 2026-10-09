#!/usr/bin/env node
// Smart Utility meter-feed simulator (docs/SMART_UTILITY_IMPLEMENTATION_PLAN.md). Sends synthetic
// cumulative readings to the ingestion endpoint exactly as a gateway would, so the dashboard,
// alerts, reconciliation and municipal packs can be exercised without hardware.
//
// Usage (local dev only -- never point this at production):
//   node scripts/simulate-meter-feed.mjs --url http://localhost:3000 --token pmi_xxx \
//     --format milesight --device 24E1241300000AA1 --device 24E1241300000BB2 \
//     --hours 48 --interval 60 --lph 30 --lph 20 --leak 1
//
//   --format milesight | generic   payload shape (Milesight network-server uplink, or generic JSON)
//   --device <id>                  repeatable; one simulated meter per device
//   --lph <n>                      repeatable; litres (or pulses) per hour per device (default 20)
//   --hours <n>                    history to back-fill, ending now (default 24)
//   --interval <minutes>           reading interval (default 60)
//   --leak <deviceIndex>           add a constant overnight flow to that device (night-flow alert)
//   --start <n>                    starting register value (default 1000)

import process from 'node:process';

function args() {
  const out = { device: [], lph: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const key = a[i].replace(/^--/, '');
    const val = a[i + 1];
    if (key === 'device' || key === 'lph') out[key].push(val);
    else out[key] = val;
  }
  return out;
}

const opt = args();
const url = (opt.url ?? 'http://localhost:3000').replace(/\/$/, '');
if (!opt.token || opt.device.length === 0) {
  console.error('Required: --token pmi_... and at least one --device');
  process.exit(1);
}
if (/proplyst\.(co\.za|com)|onrender\.com/i.test(url)) {
  console.error('Refusing to send simulated readings to a production-looking URL.');
  process.exit(1);
}
const format = opt.format ?? 'milesight';
const hours = Number(opt.hours ?? 24);
const interval = Number(opt.interval ?? 60);
const leakIdx = opt.leak === undefined ? -1 : Number(opt.leak);
const start = Number(opt.start ?? 1000);

function sastHour(d) {
  return (d.getUTCHours() + 2) % 24;
}

function milesightFrame(devEUI, pulse, time, fCnt) {
  const b = Buffer.from([0x05, 0xc8, pulse & 0xff, (pulse >> 8) & 0xff, (pulse >> 16) & 0xff, (pulse >>> 24) & 0xff]);
  return { devEUI, fCnt, time: time.toISOString(), data: b.toString('base64') };
}

const now = Date.now();
const steps = Math.floor((hours * 60) / interval);
const registers = opt.device.map(() => start);
let sent = 0;
for (let s = steps; s >= 0; s--) {
  const t = new Date(now - s * interval * 60_000);
  const frames = opt.device.map((dev, i) => {
    const perHour = Number(opt.lph[i] ?? 20);
    const hour = sastHour(t);
    const daytime = hour >= 6 && hour < 22;
    // Realistic shape: most use in the day, near zero at night unless this device "leaks".
    let use = (daytime ? perHour * 1.3 : perHour * 0.05) * (interval / 60);
    if (i === leakIdx) use += 8 * (interval / 60);
    registers[i] += Math.round(use);
    return { dev, value: registers[i] };
  });
  const body =
    format === 'milesight'
      ? frames.map((f, i) => milesightFrame(f.dev, f.value, t, steps - s + i * 100000))
      : { readings: frames.map((f) => ({ deviceId: f.dev, readAt: t.toISOString(), value: f.value, eventId: `${f.dev}:${t.getTime()}` })) };
  const res = await fetch(`${url}/api/v1/integrations/meters/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opt.token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, json);
    process.exit(1);
  }
  if (json.rejected?.length) console.warn('rejected:', json.rejected);
  sent += 1;
}
console.log(`Sent ${sent} batches for ${opt.device.length} device(s).`);
