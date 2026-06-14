const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  console.error("Playwright is required for QA surface checks.");
  console.error("Install it locally or run with NODE_PATH pointing at a Playwright node_modules directory.");
  console.error(error.message);
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MINI4WD_QA_PORT || 4174);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readBuildMeta() {
  const sandbox = { window: {}, console };
  vm.runInNewContext(read("src/core/build.js"), sandbox, { filename: "src/core/build.js" });
  return sandbox.window.MINI4WD_BUILD_META || {};
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let pathname = decodeURIComponent(url.pathname || "/");
      if (pathname === "/favicon.ico") {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (pathname === "/") pathname = "/index.html";
      const filePath = path.resolve(root, `.${pathname}`);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": contentType(filePath),
          "Cache-Control": "no-store"
        });
        res.end(data);
      });
    } catch (error) {
      res.writeHead(500);
      res.end(String(error && error.message || error));
    }
  });

  return new Promise(resolve => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function firstExisting(paths) {
  return paths.find(item => item && fs.existsSync(item)) || "";
}

function browserPath() {
  return process.env.MINI4WD_BROWSER_PATH || firstExisting([
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ]);
}

function expectedFor(routeName) {
  if (routeName === "tv-live-missing-record") return { surface: "tv-live", tvWrap: true };
  if (routeName.includes("live") || routeName.includes("lobby")) return { surface: "live-lobby" };
  if (routeName === "print-route") return { surface: "login", loginInputs: true };
  return { surface: "login", loginInputs: true };
}

async function inspectRoute(browser, meta, route, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on("console", msg => {
    if (msg.type() === "error") errors.push(msg.text());
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    const url = request.url();
    if (/favicon|gstatic|firebase|cdn\.jsdelivr|googleapis/.test(url)) return;
    failedRequests.push(`${url} ${request.failure()?.errorText || ""}`.trim());
  });

  const url = `http://127.0.0.1:${port}/index.html${route.hash}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(route.hash.includes("tv-live&t=") ? 5200 : 1300);
  if (route.name === "live-lobby") {
    await page.waitForFunction(() => document.querySelectorAll(".live-card-v89").length === 20, null, { timeout: 6500 }).catch(() => {});
  }

  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const app = document.getElementById("app");
    const firstHeader = document.querySelector(".unified-titlebar-v173, .live-lobby-header-v89, .header");
    const headerRect = firstHeader ? firstHeader.getBoundingClientRect() : null;
    const visibleControls = [...document.querySelectorAll("button,input,select,textarea,.card,.unified-titlebar-v173,.live-card-v89,.toolbar")]
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    const offscreen = visibleControls
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || ""),
          text: String(el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 60),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      })
      .filter(item => item.left < -2 || item.right > window.innerWidth + 2);
    const text = String(app?.innerText || "").replace(/\s+/g, " ");
    const suspiciousQuestionCount = (text.match(/\?/g) || []).length;
    return {
      hash: location.hash,
      surface: doc.getAttribute("data-ui-surface") || "",
      build: doc.getAttribute("data-build-version") || "",
      release: doc.getAttribute("data-release-version") || "",
      bodyClass: body.className,
      appChildren: app ? app.children.length : 0,
      headerTop: headerRect ? Math.round(headerRect.top) : null,
      textSample: text.slice(0, 220),
      hasReplacementChar: text.includes("\uFFFD"),
      suspiciousQuestionCount,
      overflowX: Math.max(doc.scrollWidth, body.scrollWidth) - Math.max(doc.clientWidth, body.clientWidth),
      offscreen: offscreen.slice(0, 8),
      buttons: [...document.querySelectorAll("button")].slice(0, 12).map(button => String(button.innerText || button.textContent || "").trim()),
      liveCards: document.querySelectorAll(".live-card-v89").length,
      loginInputs: document.querySelectorAll("input[type='email'],input[type='password']").length,
      tvWrap: document.querySelectorAll(".tv-wrap").length
    };
  });

  await page.close();

  const expected = expectedFor(route.name);
  const failures = [];
  if (errors.length) failures.push(`console errors: ${errors.join(" | ")}`);
  if (failedRequests.length) failures.push(`failed requests: ${failedRequests.join(" | ")}`);
  if (String(info.build) !== String(meta.version)) failures.push(`build ${info.build} !== ${meta.version}`);
  if (String(info.release) !== String(meta.version)) failures.push(`release ${info.release} !== ${meta.version}`);
  if (info.appChildren < 1) failures.push("empty app root");
  if (info.overflowX > 2) failures.push(`horizontal overflow ${info.overflowX}px`);
  if (info.offscreen.length) failures.push(`offscreen controls ${JSON.stringify(info.offscreen)}`);
  if ((route.name === "live-lobby" || route.name === "lobby-alias") && Number.isFinite(info.headerTop) && info.headerTop > (viewport.width <= 760 ? 10 : 16)) failures.push(`header top gap too large ${info.headerTop}px`);
  if (info.hasReplacementChar || info.suspiciousQuestionCount > 8) failures.push(`text encoding suspect: ${info.textSample}`);
  if (expected.surface && info.surface !== expected.surface) failures.push(`surface ${info.surface} !== ${expected.surface}`);
  if (expected.loginInputs && info.loginInputs < 2) failures.push("missing login inputs");
  if (route.name === "live-lobby" && info.liveCards !== 20) failures.push(`live cards ${info.liveCards} !== 20`);
  if (expected.tvWrap && !info.tvWrap) failures.push("missing tv fallback wrap");

  return {
    route: route.name,
    viewport,
    ok: failures.length === 0,
    failures,
    warnings: warnings.slice(0, 5),
    info
  };
}

async function inspectStaleFallback(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${port}/index.html#view=tv-live&t=qa-stale-route`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = "view=live-lobby"; });
  await page.waitForTimeout(5400);
  const info = await page.evaluate(() => ({
    hash: location.hash,
    surface: document.documentElement.getAttribute("data-ui-surface") || "",
    bodyClass: document.body.className,
    liveCards: document.querySelectorAll(".live-card-v89").length,
    tvWrap: document.querySelectorAll(".tv-wrap").length,
    overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - Math.max(document.documentElement.clientWidth, document.body.clientWidth)
  }));
  await page.close();
  const failures = [];
  if (errors.length) failures.push(`console errors: ${errors.join(" | ")}`);
  if (info.hash !== "#view=live-lobby") failures.push(`hash changed to ${info.hash}`);
  if (info.surface !== "live-lobby") failures.push(`surface ${info.surface} !== live-lobby`);
  if (info.tvWrap) failures.push("stale TV fallback rendered over lobby");
  if (info.liveCards !== 20) failures.push(`live cards ${info.liveCards} !== 20`);
  if (info.overflowX > 2) failures.push(`horizontal overflow ${info.overflowX}px`);
  return { route: "same-tab-stale-tv-fallback", viewport: { width: 390, height: 844 }, ok: failures.length === 0, failures, info };
}

async function main() {
  const meta = readBuildMeta();
  const server = await startServer();
  const executablePath = browserPath();
  if (!executablePath) throw new Error("No Chrome or Edge executable was found. Set MINI4WD_BROWSER_PATH.");

  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const routes = [
    { name: "login-root", hash: "" },
    { name: "login-explicit", hash: "#view=login" },
    { name: "live-lobby", hash: "#view=live-lobby" },
    { name: "lobby-alias", hash: "#view=lobby" },
    { name: "mobile-live-missing-id", hash: "#view=mobile-live" },
    { name: "tv-live-missing-id", hash: "#view=tv-live" },
    { name: "tv-live-missing-record", hash: "#view=tv-live&t=qa-missing-record" },
    { name: "db-guard", hash: "#view=db" },
    { name: "dashboard-guard", hash: "#view=dashboard" },
    { name: "admin-guard", hash: "#view=admin" },
    { name: "admin-matches-guard", hash: "#view=admin-matches" },
    { name: "print-route", hash: "#view=print" }
  ];
  const viewports = [
    { width: 1365, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 }
  ];
  const results = [];
  for (const viewport of viewports) {
    for (const route of routes) results.push(await inspectRoute(browser, meta, route, viewport));
  }
  results.push(await inspectStaleFallback(browser));
  await browser.close();
  await new Promise(resolve => server.close(resolve));

  const failed = results.filter(result => !result.ok);
  console.log(JSON.stringify({
    version: meta.version,
    label: meta.label,
    checked: results.length,
    failed: failed.length,
    results
  }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
