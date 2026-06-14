const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  console.error("Playwright is required for admin flow QA.");
  console.error("Install it locally or run with NODE_PATH pointing at a Playwright node_modules directory.");
  console.error(error.message);
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MINI4WD_QA_ADMIN_PORT || 4176);

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

const firebaseStub = `
(function(){
  const now = Date.now();
  const sampleRows = [
    { "선수명": "박태진", "팀명": "Brilliant", "결과": "최종우승", "차수": "최종 결승", "단계": "FINAL", "조": "FINAL", "레인": "1LANE" },
    { "선수명": "김민수", "팀명": "GEEKS", "결과": "탈락", "차수": "최종 결승", "단계": "FINAL", "조": "FINAL", "레인": "2LANE" }
  ];
  const store = {
    userProfiles: {
      "qa-admin": { uid: "qa-admin", email: "chaser.escane@gmail.com", role: "admin", venueId: "all", venueName: "전체", approved: true, permissions: { operate: true, dashboard: true } },
      "qa-athens": { uid: "qa-athens", email: "athens@example.com", role: "venue", venueId: "athens-world", venueName: "아테네월드", approved: true, permissions: { operate: true, dashboard: true } },
      "qa-pending": { uid: "qa-pending", email: "pending@example.com", role: "pending", venueId: "pending-track", venueName: "승인대기점", approved: false, permissions: { operate: false, dashboard: false } },
      "qa-suspended": { uid: "qa-suspended", email: "stopped@example.com", role: "suspended", venueId: "stopped-track", venueName: "중지점", approved: false, permissions: { operate: false, dashboard: false } }
    },
    publicVenues: {},
    publicVenueDirectory: {},
    publicLive: {},
    publicHistory: {
      "qa-public-1": { id: "qa-public-1", venueId: "athens-world", venueName: "아테네월드", raceClass: "오픈", tournamentName: "QA 공개 기록", createdAt: new Date(now - 3600000).toISOString(), endedAtISO: new Date(now - 3500000).toISOString(), rows: sampleRows }
    },
    privateResultLogs: {
      "athens-world": {
        "qa-private-1": { id: "qa-private-1", venueId: "athens-world", venueName: "아테네월드", raceClass: "스톡", tournamentName: "QA 비공개 기록", createdAt: new Date(now - 7200000).toISOString(), endedAtISO: new Date(now - 7100000).toISOString(), rows: sampleRows },
        "qa-private-2": { id: "qa-private-2", venueId: "athens-world", venueName: "아테네월드", raceClass: "어드&비맥스", tournamentName: "QA 장문 대회 기록 이름 확인용", createdAt: new Date(now - 10800000).toISOString(), endedAtISO: new Date(now - 10700000).toISOString(), rows: sampleRows.concat(sampleRows) }
      }
    },
    activeTournaments: {},
    operationLocks: {},
    tournaments: {},
    actionLogs: {}
  };
  function split(path) { return String(path || "").split("/").filter(Boolean); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function getAt(path) {
    return split(path).reduce((node, key) => node && Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined, store);
  }
  function setAt(path, value) {
    const parts = split(path);
    let node = store;
    while (parts.length > 1) {
      const key = parts.shift();
      node[key] = node[key] && typeof node[key] === "object" ? node[key] : {};
      node = node[key];
    }
    if (!parts.length) return;
    if (value === null) delete node[parts[0]];
    else node[parts[0]] = clone(value);
  }
  function mergeAt(path, value) {
    const current = getAt(path);
    if (current && typeof current === "object" && value && typeof value === "object") setAt(path, { ...current, ...clone(value) });
    else setAt(path, value);
  }
  function snapshot(value) {
    return { val: () => clone(value), exists: () => value !== undefined && value !== null };
  }
  function ref(path) {
    const api = {
      path: String(path || ""),
      child(childPath) { return ref([this.path, childPath].filter(Boolean).join("/")); },
      get() { return Promise.resolve(snapshot(getAt(this.path))); },
      set(value) { setAt(this.path, value); return Promise.resolve(); },
      update(value) { mergeAt(this.path, value); return Promise.resolve(); },
      remove() { setAt(this.path, null); return Promise.resolve(); },
      once(_event, cb) { const snap = snapshot(getAt(this.path)); if (cb) setTimeout(() => cb(snap), 0); return Promise.resolve(snap); },
      on(_event, cb) { setTimeout(() => cb(snapshot(getAt(this.path))), 0); return cb; },
      off() {},
      orderByChild() { return this; },
      limitToLast() { return this; },
      limitToFirst() { return this; },
      equalTo() { return this; },
      push(value) {
        const key = "qa-" + Math.random().toString(36).slice(2, 10);
        const next = this.child(key);
        if (arguments.length) next.set(value);
        return { key, set: next.set.bind(next), update: next.update.bind(next), remove: next.remove.bind(next) };
      },
      transaction(updateFn) {
        const current = getAt(this.path);
        const next = updateFn(clone(current));
        setAt(this.path, next);
        return Promise.resolve({ committed: true, snapshot: snapshot(next) });
      }
    };
    return api;
  }
  const fakeUser = { uid: "qa-admin", email: "chaser.escane@gmail.com" };
  window.__qaFirebaseStore = store;
  window.firebase = {
    initializeApp: () => ({ name: "qa-app" }),
    apps: [],
    database: () => ({ ref }),
    auth: () => ({
      currentUser: fakeUser,
      onAuthStateChanged(cb) { setTimeout(() => cb(fakeUser), 0); return function(){}; },
      signInWithEmailAndPassword: () => Promise.resolve({ user: fakeUser }),
      createUserWithEmailAndPassword: () => Promise.resolve({ user: fakeUser }),
      signOut: () => Promise.resolve()
    })
  };
  window.firebase.database.ServerValue = { TIMESTAMP: Date.now() };
})();
`;

const xlsxStub = `window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: rows => ({ rows }), book_append_sheet: () => {} }, writeFile: () => {} };`;

async function installNetworkStubs(page) {
  await page.route("**/*", route => {
    const url = route.request().url();
    if (/cdn\.jsdelivr\.net\/npm\/xlsx/.test(url)) {
      route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: xlsxStub });
      return;
    }
    if (/gstatic\.com\/firebasejs/.test(url)) {
      route.fulfill({ status: 200, contentType: "application/javascript; charset=utf-8", body: firebaseStub });
      return;
    }
    route.continue();
  });
}

async function inspectAdminRoute(page, meta, hash, expectedSurface, failures) {
  await page.goto(`http://127.0.0.1:${port}/index.html${hash}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForFunction(surface => document.documentElement.getAttribute("data-ui-surface") === surface, expectedSurface, { timeout: 10000 });
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const app = document.getElementById("app");
    const firstHeader = document.querySelector(".admin-titlebar-v177, .unified-titlebar-v173, .header");
    const headerRect = firstHeader ? firstHeader.getBoundingClientRect() : null;
    const text = String(app?.innerText || "").replace(/\s+/g, " ");
    const inHorizontalScroller = el => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const scrollable = /(auto|scroll)/.test(style.overflowX || "");
        if (scrollable && node.scrollWidth > node.clientWidth + 2) return true;
      }
      return false;
    };
    const visible = [...document.querySelectorAll("button,input,select,textarea,.card,.admin-overview-item-v186,.admin-table-v186 tr")]
      .filter(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: String(el.className || ""),
          text: String(el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 70),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          inHorizontalScroller: inHorizontalScroller(el)
        };
      });
    const table = document.querySelector(".admin-table-v186");
    const tableWrap = document.querySelector(".admin-table-wrap-v177");
    const rowHeights = [...document.querySelectorAll(".admin-table-v186 tbody tr")]
      .slice(0, 6)
      .map(row => Math.round(row.getBoundingClientRect().height));
    const permissionRows = [...document.querySelectorAll(".admin-account-row-v186 .permission-flags-v204")].map(flags => {
      const buttonRects = [...flags.querySelectorAll(".permission-toggle-v204")].map(button => button.getBoundingClientRect());
      const columns = getComputedStyle(flags).gridTemplateColumns.split(" ").filter(Boolean).length;
      const widths = buttonRects.map(rect => Math.round(rect.width));
      const heights = buttonRects.map(rect => Math.round(rect.height));
      return {
        columns,
        buttons: buttonRects.length,
        topCount: new Set(buttonRects.map(rect => Math.round(rect.top))).size,
        widthSpread: widths.length ? Math.max(...widths) - Math.min(...widths) : 0,
        heightSpread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0
      };
    });
    const toolbarRect = document.querySelector(".admin-unified-toolbar-v145")?.getBoundingClientRect();
    const toolbarButtonsRect = document.querySelector(".admin-toolbar-buttons-v204")?.getBoundingClientRect();
    const toolbarRowRects = [...document.querySelectorAll(".admin-toolbar-row-v204")].map(row => row.getBoundingClientRect());
    const accountPillRect = document.querySelector(".admin-account-pill-v204")?.getBoundingClientRect();
    const accountHeaders = [...document.querySelectorAll(".admin-account-table-v204 thead th")].map(cell => (cell.textContent || "").trim());
    return {
      innerWidth: window.innerWidth,
      hash: location.hash,
      surface: doc.getAttribute("data-ui-surface") || "",
      build: doc.getAttribute("data-build-version") || "",
      release: doc.getAttribute("data-release-version") || "",
      bodyClass: body.className,
      appChildren: app ? app.children.length : 0,
      headerTop: headerRect ? Math.round(headerRect.top) : null,
      textSample: text.slice(0, 260),
      replacement: text.includes("\uFFFD"),
      questionCount: (text.match(/\?/g) || []).length,
      overflowX: Math.max(doc.scrollWidth, body.scrollWidth) - Math.max(doc.clientWidth, body.clientWidth),
      offscreen: visible.filter(item => !item.inHorizontalScroller && (item.left < -2 || item.right > window.innerWidth + 2)).slice(0, 8),
      overviewItems: document.querySelectorAll(".admin-overview-item-v186").length,
      accountRows: document.querySelectorAll(".admin-account-row-v186").length,
      recordRows: document.querySelectorAll(".admin-record-row-v186").length,
      tableDisplay: table ? getComputedStyle(table).display : "",
      tableWrapScrollable: tableWrap ? tableWrap.scrollWidth > tableWrap.clientWidth + 2 : false,
      maxRowHeight: rowHeights.length ? Math.max(...rowHeights) : 0,
      actionButtons: document.querySelectorAll(".permission-toggle-v204, .admin-action-cell-v177 button").length,
      accountActionCells: document.querySelectorAll(".admin-account-row-v186 .admin-action-cell-v177").length,
      accountVenueLines: document.querySelectorAll(".admin-account-row-v186 .admin-account-main-v205 .admin-account-venue-v205").length,
      permissionBadges: document.querySelectorAll(".admin-account-row-v186 .permission-badge").length,
      permissionDetails: document.querySelectorAll(".admin-account-row-v186 .permission-detail").length,
      recordSubtexts: document.querySelectorAll(".admin-record-row-v186 .admin-record-main-v186 span").length,
      recordSourceBadges: document.querySelectorAll(".admin-record-row-v186 .admin-record-main-v186 em").length,
      permissionRows,
      toolbarWidth: toolbarRect ? Math.round(toolbarRect.width) : 0,
      toolbarButtonsWidth: toolbarButtonsRect ? Math.round(toolbarButtonsRect.width) : 0,
      toolbarRows: toolbarRowRects.length,
      accountPillBelowToolbar: accountPillRect && toolbarRowRects.length ? Math.round(accountPillRect.top) >= Math.round(Math.max(...toolbarRowRects.map(rect => rect.bottom))) : false,
      accountHeaders
    };
  });
  if (String(info.build) !== String(meta.version) || String(info.release) !== String(meta.version)) failures.push(`${hash}: build/release mismatch ${info.build}/${info.release}`);
  if (info.surface !== expectedSurface) failures.push(`${hash}: surface ${info.surface} !== ${expectedSurface}`);
  if (info.appChildren < 1) failures.push(`${hash}: empty app root`);
  if (Number.isFinite(info.headerTop) && info.headerTop > (info.innerWidth <= 760 ? 10 : 16)) failures.push(`${hash}: header top gap too large ${info.headerTop}px`);
  if (info.replacement || info.questionCount > 12) failures.push(`${hash}: text encoding suspect ${info.textSample}`);
  if (info.overflowX > 2) failures.push(`${hash}: horizontal overflow ${info.overflowX}px`);
  if (info.offscreen.length) failures.push(`${hash}: offscreen controls ${JSON.stringify(info.offscreen)}`);
  if (info.overviewItems !== 4) failures.push(`${hash}: overview items ${info.overviewItems} !== 4`);
  if (expectedSurface === "admin-accounts" && info.accountRows < 4) failures.push(`${hash}: account rows too few ${info.accountRows}`);
  if (expectedSurface === "admin-accounts" && info.accountVenueLines !== info.accountRows) failures.push(`${hash}: venue label should sit above every account ${info.accountVenueLines}/${info.accountRows}`);
  if (expectedSurface === "admin-accounts" && (info.permissionBadges || info.permissionDetails)) failures.push(`${hash}: redundant account permission copy remains ${JSON.stringify({ permissionBadges: info.permissionBadges, permissionDetails: info.permissionDetails })}`);
  if (expectedSurface === "admin-accounts" && info.accountActionCells) failures.push(`${hash}: account management column remains ${info.accountActionCells}`);
  if (expectedSurface === "admin-accounts" && info.permissionRows.length !== info.accountRows) failures.push(`${hash}: permission toggle rows mismatch ${info.permissionRows.length}/${info.accountRows}`);
  if (expectedSurface === "admin-accounts" && info.permissionRows.some(row => row.buttons !== 4)) failures.push(`${hash}: permission toggles should replace account action buttons ${JSON.stringify(info.permissionRows)}`);
  if (expectedSurface === "admin-accounts" && info.permissionRows.some(row => row.widthSpread > 2 || row.heightSpread > 1)) failures.push(`${hash}: permission toggle sizes diverged ${JSON.stringify(info.permissionRows)}`);
  if (expectedSurface === "admin-accounts" && info.accountHeaders.join("|") !== "계정|상태|권한") failures.push(`${hash}: account header order changed ${JSON.stringify(info.accountHeaders)}`);
  if (expectedSurface === "admin-accounts" && info.tableWrapScrollable) failures.push(`${hash}: account table should not scroll horizontally`);
  if (expectedSurface === "admin-accounts" && (info.toolbarRows !== 3 || !info.accountPillBelowToolbar)) failures.push(`${hash}: admin toolbar should be 3 button rows with account info at bottom`);
  if (expectedSurface === "admin-accounts" && info.innerWidth <= 760 && info.toolbarWidth && info.toolbarButtonsWidth < info.toolbarWidth - 16) failures.push(`${hash}: admin toolbar buttons do not fill the mobile toolbar ${info.toolbarButtonsWidth}/${info.toolbarWidth}`);
  if (expectedSurface === "admin-matches" && info.recordRows < 3) failures.push(`${hash}: record rows too few ${info.recordRows}`);
  if (expectedSurface === "admin-matches" && (info.recordSubtexts || info.recordSourceBadges)) failures.push(`${hash}: redundant record source copy remains ${JSON.stringify({ recordSubtexts: info.recordSubtexts, recordSourceBadges: info.recordSourceBadges })}`);
  if (info.innerWidth <= 760 && info.tableDisplay !== "table") failures.push(`${hash}: admin mobile list should stay as compact table, got ${info.tableDisplay}`);
  if (expectedSurface === "admin-matches" && info.innerWidth <= 760 && !info.tableWrapScrollable) failures.push(`${hash}: admin match table wrapper is not horizontally scrollable`);
  if (info.innerWidth <= 760 && info.maxRowHeight > (expectedSurface === "admin-accounts" ? 76 : 52)) failures.push(`${hash}: admin mobile row too tall ${info.maxRowHeight}px`);
  if (info.actionButtons < 1) failures.push(`${hash}: missing admin action buttons`);
  return info;
}

async function runViewport(browser, meta, viewport) {
  const failures = [];
  const logs = [];
  const page = await browser.newPage({ viewport });
  await installNetworkStubs(page);
  page.on("console", msg => { if (msg.type() === "error") failures.push(`console error: ${msg.text()}`); });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("dialog", dialog => dialog.accept());
  logs.push({ step: "admin-accounts", info: await inspectAdminRoute(page, meta, "#view=admin", "admin-accounts", failures) });
  logs.push({ step: "admin-matches", info: await inspectAdminRoute(page, meta, "#view=admin-matches", "admin-matches", failures) });
  await page.close();
  return { viewport, ok: failures.length === 0, failures, logs };
}

async function main() {
  const meta = readBuildMeta();
  const server = await startServer();
  const executablePath = browserPath();
  if (!executablePath) throw new Error("No Chrome or Edge executable was found. Set MINI4WD_BROWSER_PATH.");
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const viewports = [
    { width: 1365, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 }
  ];
  const results = [];
  for (const viewport of viewports) results.push(await runViewport(browser, meta, viewport));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  const failed = results.filter(result => !result.ok);
  console.log(JSON.stringify({ version: meta.version, label: meta.label, checked: results.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
