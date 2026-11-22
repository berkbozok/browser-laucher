// A check against real browsers: for every installed browser it opens a
// normal window, then a normal and an incognito one, makes sure the incognito
// window really is private, exercises reload and arrange, and closes
// everything again. Windows pop up while it runs.
//
//   npm run dev          (in one terminal)
//   npm run test:live    (in another)
//
// Point it at a launcher elsewhere with LAUNCHER=http://127.0.0.1:3210
import { createServer } from "node:http";

const LAUNCHER = process.env.LAUNCHER ?? "http://127.0.0.1:3000";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- A page that tells normal windows from private ones: every visit plants
// its own cookie and notes which earlier visits' cookies it can see.
const visits = [];
const pageServer = createServer((request, response) => {
  const match = /^\/visit\/([\w-]+)$/.exec(request.url ?? "");
  const headers = { "Content-Type": "text/html; charset=utf-8" };
  if (match) {
    const seen = [...(request.headers.cookie ?? "").matchAll(/\bv_([\w-]+)=1/g)].map((m) => m[1]);
    visits.push({ name: match[1], seen });
    headers["Set-Cookie"] = `v_${match[1]}=1; Path=/; Max-Age=3600`;
  }
  response.writeHead(200, headers);
  response.end(
    "<!doctype html><meta name='color-scheme' content='dark'><title>Browser Launcher check</title>" +
      "<body style='font:16px system-ui;padding:40px;background:#0a0a0a;color:#d4d4d4'>Browser Launcher check. This window closes by itself.</body>",
  );
});
await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const page = `http://127.0.0.1:${pageServer.address().port}/visit`;

async function call(path, body) {
  const response = await fetch(LAUNCHER + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

let browsers;
try {
  browsers = (await call("/api/browsers")).browsers.filter((b) => b.installed);
} catch {
  console.error(`Can't reach the launcher at ${LAUNCHER}. Start it with "npm run dev" first.`);
  process.exit(1);
}

const run = Date.now().toString(36);
const rows = [];
for (const browser of browsers) {
  const first = `${run}-${browser.id}-a`;
  const second = `${run}-${browser.id}-b`;
  const row = { browser: browser.name };
  try {
    const one = (await call("/api/open", { url: `${page}/${first}`, browsers: [browser.id] })).results[0];
    await sleep(3000);
    const two = (await call("/api/open", { url: `${page}/${second}`, browsers: [browser.id], includePrivate: true })).results[0];
    await sleep(4000);

    const loads = visits.filter((visit) => visit.name === second);
    const remembered = loads.filter((visit) => visit.seen.includes(first)).length;
    const fresh = loads.length - remembered;
    const tracked = [one.handle, two.handle, two.privateWindow?.handle].filter(Boolean).length;
    // A window the launcher couldn't pick out is left for you to close; not
    // a failure, but worth seeing.
    const opened = 2 + (two.privateWindow?.status === "opened" ? 1 : 0);
    row.followed = `${tracked} of ${opened}`;

    row.normal = one.ok && two.ok && remembered === 1 ? "ok" : `PROBLEM (${one.error ?? two.error ?? `${remembered} remembered`})`;
    row.incognito = !browser.supportsPrivate
      ? "not offered"
      : two.privateWindow?.status === "opened" && fresh === 1
        ? "ok, private"
        : `PROBLEM (${two.privateWindow?.error ?? two.privateWindow?.status ?? "missing"}, ${fresh} fresh)`;

    if (tracked > 0) {
      const mine = () => visits.filter((visit) => visit.name === first || visit.name === second).length;
      const before = mine();
      const reloaded = (await call("/api/reload", { browsers: [browser.id] })).results[0];
      await sleep(4500);
      // Every tracked window should have loaded its page once more. (Firefox
      // does it by swapping in a fresh window on the same address.)
      const extra = mine() - before;
      row.reload =
        reloaded?.done === tracked && extra === tracked && !reloaded.error
          ? "ok"
          : `PROBLEM (${reloaded?.error ?? `${reloaded?.done} told, ${extra} loaded again`})`;
      const arranged = (await call("/api/arrange", { browsers: [browser.id], layout: "tile" })).results[0];
      row.arrange = arranged?.done === tracked && !arranged.error ? "ok" : `PROBLEM (${arranged?.error ?? arranged?.done})`;
      const closed = (await call("/api/close", { browsers: [browser.id] })).results[0];
      row.close = closed?.closed === tracked && !closed.error ? `ok (${tracked})` : `PROBLEM (${closed?.error ?? `${closed?.closed} of ${tracked}`})`;
    } else {
      row.reload = row.arrange = row.close = "by hand";
    }
  } catch (error) {
    row.normal = `PROBLEM (${error.message})`;
  }
  rows.push(row);
}

pageServer.close();
console.table(rows);
const problems = rows.filter((row) => Object.values(row).some((value) => String(value).startsWith("PROBLEM")));
console.log(problems.length === 0 ? "All good." : `Problems in: ${problems.map((row) => row.browser).join(", ")}`);
process.exit(problems.length === 0 ? 0 : 1);
