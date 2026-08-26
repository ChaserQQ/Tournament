const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  console.error("Playwright is required for operator flow QA.");
  console.error("Install it locally or run with NODE_PATH pointing at a Playwright node_modules directory.");
  console.error(error.message);
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MINI4WD_QA_OPERATOR_PORT || 4175);

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
  const store = {
    userProfiles: {
      "qa-uid": {
        uid: "qa-uid",
        email: "qa-venue@example.com",
        role: "admin",
        venueId: "all",
        venueName: "전체",
        approved: true,
        permissions: { operate: true, dashboard: true }
      }
    },
    publicVenues: {
      "qa-venue": { venueId: "qa-venue", venueName: "QA Venue", approved: true, updatedAt: Date.now() }
    },
    publicVenueDirectory: {
      "qa-venue": { venueId: "qa-venue", venueName: "QA Venue", approved: true, updatedAt: Date.now() }
    },
    publicLive: {},
    publicHistory: {},
    activeTournaments: {},
    operationLocks: {},
    tournaments: {},
    privateResultLogs: {},
    actionLogs: {}
  };
  try {
    const reloadStore = JSON.parse(sessionStorage.getItem("__qaFirebaseStoreReloadV278") || "null");
    if (reloadStore && typeof reloadStore === "object") {
      Object.keys(store).forEach(key => delete store[key]);
      Object.assign(store, reloadStore);
    }
  } catch (error) {}
  const listeners = [];
  function split(path) { return String(path || "").split("/").filter(Boolean); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function joinPath(base, child) { return [base, child].filter(Boolean).join("/"); }
  function pathsIntersect(a, b) {
    const left = split(a).join("/");
    const right = split(b).join("/");
    if (!left || !right) return true;
    return left === right || left.startsWith(right + "/") || right.startsWith(left + "/");
  }
  function notifyFirebaseListeners(path) {
    const changedPath = split(path).join("/");
    listeners.slice().forEach(item => {
      if (!pathsIntersect(item.path, changedPath)) return;
      setTimeout(() => item.cb(snapshot(getAt(item.path))), 0);
    });
  }
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
      set(value) { setAt(this.path, value); notifyFirebaseListeners(this.path); return Promise.resolve(); },
      update(value) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.entries(value).forEach(([key, nextValue]) => {
            const targetPath = joinPath(this.path, key);
            setAt(targetPath, nextValue);
            notifyFirebaseListeners(targetPath);
          });
        } else {
          mergeAt(this.path, value);
          notifyFirebaseListeners(this.path);
        }
        return Promise.resolve();
      },
      remove() { setAt(this.path, null); notifyFirebaseListeners(this.path); return Promise.resolve(); },
      once(_event, cb) { const snap = snapshot(getAt(this.path)); if (cb) setTimeout(() => cb(snap), 0); return Promise.resolve(snap); },
      on(_event, cb) {
        listeners.push({ path: this.path, cb });
        setTimeout(() => cb(snapshot(getAt(this.path))), 0);
        return cb;
      },
      off(_event, cb) {
        for (let index = listeners.length - 1; index >= 0; index -= 1) {
          if (listeners[index].path === this.path && (!cb || listeners[index].cb === cb)) listeners.splice(index, 1);
        }
      },
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
        window.__qaFirebaseTransactionCounts[this.path] = Number(window.__qaFirebaseTransactionCounts[this.path] || 0) + 1;
        window.__qaFirebaseTransactionLog.push(this.path);
        if (typeof window.__qaBeforeFirebaseTransaction === "function") {
          window.__qaBeforeFirebaseTransaction(this.path, store);
        }
        if (Array.isArray(window.__qaRejectFirebaseTransactionPaths) && window.__qaRejectFirebaseTransactionPaths.includes(this.path)) {
          return Promise.reject(new Error("QA rejected Firebase transaction: " + this.path));
        }
        const current = getAt(this.path);
        const next = updateFn(clone(current));
        if (next === undefined) {
          return Promise.resolve({ committed: false, snapshot: snapshot(current) });
        }
        setAt(this.path, next);
        notifyFirebaseListeners(this.path);
        return Promise.resolve({ committed: true, snapshot: snapshot(next) });
      }
    };
    return api;
  }
  const fakeUser = { uid: "qa-uid", email: "qa-venue@example.com" };
  window.__qaFirebaseStore = store;
  window.__qaFirebaseTransactionCounts = {};
  window.__qaFirebaseTransactionLog = [];
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

async function assertNoUiBreakage(page, label, failures) {
  const info = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const app = document.getElementById("app");
    const firstHeader = document.querySelector(".operator-titlebar-v132, .unified-titlebar-v173, .live-lobby-header-v89, .header");
    const headerRect = firstHeader ? firstHeader.getBoundingClientRect() : null;
    const pageShell = firstHeader ? firstHeader.closest(".wrap, .db-page, .mobile-view, .live-lobby-shell-v89") : null;
    const shellRect = pageShell ? pageShell.getBoundingClientRect() : null;
    const shellStyle = pageShell ? getComputedStyle(pageShell) : null;
    const headerStyle = firstHeader ? getComputedStyle(firstHeader) : null;
    const text = String(app?.innerText || "").replace(/\s+/g, " ");
    const inHorizontalScroller = el => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const scrollable = /(auto|scroll)/.test(style.overflowX || "");
        if (scrollable && node.scrollWidth > node.clientWidth + 2) return true;
      }
      return false;
    };
    const controls = [...document.querySelectorAll("button,input,select,textarea,.card,.unified-titlebar-v173,.round-card,.stage-card,.mobile-operator-dock-v147")]
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
          text: String(el.innerText || el.value || "").replace(/\s+/g, " ").trim().slice(0, 50),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          inHorizontalScroller: inHorizontalScroller(el)
        };
      });
    const rosterTable = document.querySelector(".roster-table-v121");
    const rosterWrap = document.querySelector(".db-roster-scroll-v98, .db-roster-scroll-v99");
    const rosterStar = document.querySelector(".roster-star-btn-v121");
    const rosterStarCell = rosterStar ? rosterStar.closest("td") : null;
    const rosterStarRect = rosterStar ? rosterStar.getBoundingClientRect() : null;
    const rosterStarCellRect = rosterStarCell ? rosterStarCell.getBoundingClientRect() : null;
    const dbAddButton = document.querySelector(".db-register-card-v121 .db-primary-action-v121");
    const dbAddButtonRect = dbAddButton ? dbAddButton.getBoundingClientRect() : null;
    const dbCommandBar = document.querySelector(".db-command-bar-v202");
    const dbCommandBarRect = dbCommandBar ? dbCommandBar.getBoundingClientRect() : null;
    const dbEmailPill = document.querySelector(".db-command-bar-v202 .db-email-pill-v131");
    const dashboardAccountStrip = document.querySelector(".dashboard-account-strip-v207");
    const dashboardAccountButtons = document.querySelector(".dashboard-account-buttons-v207");
    const dashboardAccountStripRect = dashboardAccountStrip ? dashboardAccountStrip.getBoundingClientRect() : null;
    const dashboardAccountButtonsRect = dashboardAccountButtons ? dashboardAccountButtons.getBoundingClientRect() : null;
    const dbToolbarGroups = [...document.querySelectorAll(".db-command-bar-v202 .db-toolbar-group-v202")]
      .map(group => {
        const rect = group.getBoundingClientRect();
        const buttonRects = [...group.querySelectorAll("button,.upload-button,.pill")].map(item => item.getBoundingClientRect());
        return {
          className: String(group.className || ""),
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          itemTopCount: new Set(buttonRects.map(item => Math.round(item.top))).size
        };
      });
    const dbMobileListRhythmV261 = (() => {
      const workspace = document.querySelector(".db-player-layout-v121");
      const listCard = document.querySelector(".db-roster-list-card-v99");
      const bulkToolbar = listCard?.querySelector(".db-bulk-toolbar");
      const table = listCard?.querySelector("table.roster-table-v121");
      const tableHead = table?.querySelector("thead");
      const tableBody = table?.querySelector("tbody");
      const headerCell = listCard?.querySelector("table.roster-table-v121 thead th");
      const firstRow = listCard?.querySelector("table.roster-table-v121 tbody tr");
      const cardRect = listCard ? listCard.getBoundingClientRect() : null;
      const workspaceRect = workspace ? workspace.getBoundingClientRect() : null;
      const bulkRect = bulkToolbar ? bulkToolbar.getBoundingClientRect() : null;
      const wrapRect = rosterWrap ? rosterWrap.getBoundingClientRect() : null;
      const headerRect = headerCell ? headerCell.getBoundingClientRect() : null;
      const firstRowRect = firstRow ? firstRow.getBoundingClientRect() : null;
      const cardStyle = listCard ? getComputedStyle(listCard) : null;
      const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
      const wrapStyle = rosterWrap ? getComputedStyle(rosterWrap) : null;
      const tableStyle = table ? getComputedStyle(table) : null;
      const tableHeadStyle = tableHead ? getComputedStyle(tableHead) : null;
      const tableBodyStyle = tableBody ? getComputedStyle(tableBody) : null;
      const firstRowStyle = firstRow ? getComputedStyle(firstRow) : null;
      const headerStyle = headerCell ? getComputedStyle(headerCell) : null;
      const firstRowCells = firstRow ? [...firstRow.children] : [];
      const firstRowCellRects = firstRowCells.map(cell => ({ cell, rect: cell.getBoundingClientRect() }));
      const firstRowControls = firstRow ? [...firstRow.querySelectorAll("input,select,button,.mini-input")] : [];
      const firstRowBadCells = firstRowRect ? firstRowCellRects.filter(item =>
        item.rect.left < firstRowRect.left - 1
        || item.rect.right > firstRowRect.right + 1
        || item.rect.width <= 0
      ) : [];
      const firstRowBadControls = firstRowRect ? firstRowControls.filter(control => {
        const rect = control.getBoundingClientRect();
        const parentRect = control.closest("td")?.getBoundingClientRect();
        return rect.width <= 0
          || !parentRect
          || rect.left < parentRect.left - 1
          || rect.right > parentRect.right + 1
          || rect.top < parentRect.top - 1
          || rect.bottom > parentRect.bottom + 1
          || rect.left < firstRowRect.left - 1
          || rect.right > firstRowRect.right + 1;
      }) : [];
      const commandButtons = [...document.querySelectorAll(".db-commandbar-v212 button, .db-commandbar-v212 .upload-button")]
        .map(button => ({ label: String(button.innerText || button.textContent || "").trim(), rect: button.getBoundingClientRect() }));
      const bulkButtons = [...document.querySelectorAll(".db-roster-list-card-v99 .db-bulk-buttons button")]
        .map(button => ({ label: String(button.innerText || button.textContent || "").trim(), rect: button.getBoundingClientRect() }));
      const listTargets = [
        { label: "roster-wrap", rect: wrapRect },
        { label: "roster-head", rect: headerRect },
        { label: "roster-first-row", rect: firstRowRect }
      ].filter(item => item.rect && item.rect.width > 0 && item.rect.height > 0);
      const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const overlaps = [...commandButtons, ...bulkButtons].flatMap(button =>
        listTargets.filter(target => intersects(button.rect, target.rect)).map(target => `${button.label || "button"}:${target.label}`)
      );
      return {
        hasWorkspace: !!workspace,
        hasListCard: !!listCard,
        workspaceDisplay: workspaceStyle ? workspaceStyle.display : "",
        workspaceGap: workspaceStyle ? Math.round(parseFloat(workspaceStyle.gap || "0")) : 0,
        rosterCardDisplay: cardStyle ? cardStyle.display : "",
        rosterCardGap: cardStyle ? Math.round(parseFloat(cardStyle.gap || "0")) : 0,
        commandToWorkspaceGap: dbCommandBarRect && workspaceRect ? Math.round(workspaceRect.top - dbCommandBarRect.bottom) : 0,
        bulkToTableGap: bulkRect && wrapRect ? Math.round(wrapRect.top - bulkRect.bottom) : 0,
        tableHeaderPosition: headerStyle ? headerStyle.position : "",
        tableHeaderTop: headerStyle ? headerStyle.top : "",
        rosterWrapOverflowX: wrapStyle ? wrapStyle.overflowX : "",
        tableDisplay: tableStyle ? tableStyle.display : "",
        tableHeadDisplay: tableHeadStyle ? tableHeadStyle.display : "",
        tableBodyDisplay: tableBodyStyle ? tableBodyStyle.display : "",
        firstRowDisplay: firstRowStyle ? firstRowStyle.display : "",
        firstRowGridColumns: firstRowStyle && firstRowStyle.gridTemplateColumns !== "none" ? firstRowStyle.gridTemplateColumns.split(" ").filter(Boolean).length : 0,
        firstRowWidth: firstRowRect ? Math.round(firstRowRect.width) : 0,
        firstRowCellCount: firstRowCells.length,
        firstRowBadCellCount: firstRowBadCells.length,
        firstRowBadControlCount: firstRowBadControls.length,
        firstRowBadCellLabels: firstRowBadCells.slice(0, 5).map(item => item.cell.getAttribute("data-label") || item.cell.cellIndex),
        firstRowBadControlLabels: firstRowBadControls.slice(0, 5).map(item => item.closest("td")?.getAttribute("data-label") || item.tagName),
        buttonListOverlapCount: overlaps.length,
        buttonListOverlaps: overlaps.slice(0, 8),
        rosterWrapOverflowY: rosterWrap ? getComputedStyle(rosterWrap).overflowY : ""
      };
    })();
    const visible = el => {
      if (el.closest("details:not([open])")) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const operatorTextClutter = [...document.querySelectorAll(".operator-shell-v211 .hint, .operator-shell-v211 .privacy-note, .operator-shell-v211 .desc, .operator-shell-v211 .point-tree-guide-v150")]
      .filter(visible)
      .map(el => String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const operatorSystemCopyPatterns = [
      /^(SETUP|INFO|RULE|MODE|TOOLS|ACTION|QUEUE)$/,
      /LIVE ID|자동 고유값|EMPTY SLOT|LIVE WAITING|RECENT RESULT|운영 안정화|도구 · 안정화|운영 도구|사용설명서|선수 DB|heartbeat|lease|세션/,
      /^(도구|작업|도움말)$/,
      /기록 내려받기/
    ];
    const operatorSystemCopy = [...document.querySelectorAll(".operator-shell-v211 *")]
      .filter(visible)
      .map(el => String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter(text => operatorSystemCopyPatterns.some(pattern => pattern.test(text)))
      .slice(0, 8);
    const operatorFoldPanels = document.querySelectorAll("details.operator-page").length;
    const operatorStaticPanels = document.querySelectorAll(".operator-static-panel-v236").length;
    const operatorMobileSlots = [...document.querySelectorAll(".stage-card .slot:not(.empty-lane)")]
      .slice(0, 10)
      .map(slot => {
        const slotRect = slot.getBoundingClientRect();
        const info = slot.querySelector(".player-info-name-first-card");
        const identity = slot.querySelector(".player-identity-block");
        const h2h = slot.querySelector(".slot-h2h-rows");
        const lane = slot.querySelector(".slot-card-lane-line");
        const infoStyle = info ? getComputedStyle(info) : null;
        const identityRect = identity ? identity.getBoundingClientRect() : null;
        const h2hRect = h2h ? h2h.getBoundingClientRect() : null;
        const laneRect = lane ? lane.getBoundingClientRect() : null;
        const columns = infoStyle && infoStyle.gridTemplateColumns && infoStyle.gridTemplateColumns !== "none"
          ? infoStyle.gridTemplateColumns.split(" ").filter(Boolean).length
          : 0;
        return {
          height: Math.round(slotRect.height),
          columns,
          h2hWidth: h2hRect ? Math.round(h2hRect.width) : 0,
          h2hBelowIdentity: !!(identityRect && h2hRect && h2hRect.top >= identityRect.bottom - 1),
          h2hRightOverflow: !!(h2hRect && h2hRect.right > slotRect.right + 1),
          laneClipped: !!(laneRect && (laneRect.top < slotRect.top - 1 || laneRect.bottom > slotRect.bottom + 1))
        };
      });
    const operatorDock = document.querySelector(".mobile-operator-dock-v147");
    const operatorDockRect = operatorDock ? operatorDock.getBoundingClientRect() : null;
    const operatorDockStyle = operatorDock ? getComputedStyle(operatorDock) : null;
    const operatorOverview = document.querySelector(".operator-overview-v226");
    const operatorController = document.querySelector(".operator-control-console-v226");
    const operatorControllerPrimary = operatorController?.querySelector(".operator-controller-primary-v226");
    const operatorDockPrimary = operatorDock?.querySelector(":scope > button");
    const operatorReadyConsoleV240 = document.querySelector(".operator-ready-console-v240");
    const operatorSettingsTextV241 = String(document.querySelector("#operatorSetupAreaV214")?.innerText || document.querySelector("#operatorSetupAreaV214")?.textContent || "");
    const operatorToolsTextV242 = String(document.querySelector("#operatorOpsAreaV183")?.innerText || document.querySelector("#operatorOpsAreaV183")?.textContent || "");
    const operatorMobileTopRouteLabels = [...document.querySelectorAll(".operator-mobile-top-route-v233 button")]
      .filter(visible)
      .map(button => String(button.innerText || button.textContent || "").trim())
      .filter(Boolean);
    const operatorMobileDockLabels = [...document.querySelectorAll(".operator-mobile-dock-v233 > button")]
      .filter(visible)
      .map(button => String(button.innerText || button.textContent || "").trim())
      .filter(Boolean);
    const operatorMobileDockButtonRects = [...document.querySelectorAll(".operator-mobile-dock-v233 > button")]
      .filter(visible)
      .map(button => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        let textTop = 0;
        let textHeight = 0;
        let textWidth = 0;
        let textCenterOffset = 0;
        let textLineCount = 0;
        let textHorizontalOverflow = false;
        try {
          const range = document.createRange();
          range.selectNodeContents(button);
          const textRects = [...range.getClientRects()].filter(item => item.width > 0 && item.height > 0);
          textLineCount = textRects.length;
          if (textRects.length) {
            const minLeft = Math.min(...textRects.map(item => item.left));
            const minTop = Math.min(...textRects.map(item => item.top));
            const maxRight = Math.max(...textRects.map(item => item.right));
            const maxBottom = Math.max(...textRects.map(item => item.bottom));
            textTop = Math.round(minTop);
            textHeight = Math.round(maxBottom - minTop);
            textWidth = Math.round(maxRight - minLeft);
            textHorizontalOverflow = minLeft < rect.left - 1 || maxRight > rect.right + 1;
            textCenterOffset = Math.round(((minTop + ((maxBottom - minTop) / 2)) - (rect.top + (rect.height / 2))) * 10) / 10;
          }
          range.detach();
        } catch (error) {}
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          right: Math.round(rect.right),
          height: Math.round(rect.height),
          center: Math.round(rect.top + (rect.height / 2)),
          display: style.display,
          alignItems: style.alignItems,
          justifyItems: style.justifyItems,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          backgroundClip: style.backgroundClip,
          backgroundOrigin: style.backgroundOrigin,
          borderColor: style.borderTopColor,
          paddingTop: Math.round(parseFloat(style.paddingTop || "0")),
          paddingBottom: Math.round(parseFloat(style.paddingBottom || "0")),
          lineHeight: style.lineHeight,
          textTop,
          textHeight,
          textWidth,
          textCenterOffset,
          textLineCount,
          textHorizontalOverflow
        };
      });
    const operatorMobileDockButtonHeights = operatorMobileDockButtonRects.map(item => item.height);
    const operatorMobileDockAlignmentV249 = {
      count: operatorMobileDockButtonRects.length,
      heightDelta: operatorMobileDockButtonRects.length ? Math.max(...operatorMobileDockButtonRects.map(item => item.height)) - Math.min(...operatorMobileDockButtonRects.map(item => item.height)) : 0,
      topDelta: operatorMobileDockButtonRects.length ? Math.max(...operatorMobileDockButtonRects.map(item => item.top)) - Math.min(...operatorMobileDockButtonRects.map(item => item.top)) : 0,
      centerDelta: operatorMobileDockButtonRects.length ? Math.max(...operatorMobileDockButtonRects.map(item => item.center)) - Math.min(...operatorMobileDockButtonRects.map(item => item.center)) : 0,
      badDisplay: operatorMobileDockButtonRects.filter(item => !/grid/.test(item.display))
    };
    const operatorMobileDockOpticalV251 = {
      count: operatorMobileDockButtonRects.length,
      textCenterOffsetDelta: operatorMobileDockButtonRects.length ? Math.max(...operatorMobileDockButtonRects.map(item => item.textCenterOffset)) - Math.min(...operatorMobileDockButtonRects.map(item => item.textCenterOffset)) : 0,
      maxAbsTextCenterOffset: operatorMobileDockButtonRects.length ? Math.max(...operatorMobileDockButtonRects.map(item => Math.abs(item.textCenterOffset))) : 0,
      badLines: operatorMobileDockButtonRects.filter(item => item.textLineCount > 1),
      badOverflow: operatorMobileDockButtonRects.filter(item => item.textHorizontalOverflow),
      badPadding: operatorMobileDockButtonRects.filter(item => item.paddingTop !== item.paddingBottom),
      badPlacement: operatorMobileDockButtonRects.filter(item => !/grid/.test(item.display) || item.alignItems !== "center" || item.justifyItems !== "center")
    };
    const operatorMobileDockBackgroundV252 = (() => {
      const buttons = operatorMobileDockButtonRects;
      const secondary = buttons.slice(1);
      const secondaryBackgrounds = [...new Set(secondary.map(item => item.backgroundColor))];
      const secondaryBorders = [...new Set(secondary.map(item => item.borderColor))];
      return {
        count: buttons.length,
        primaryBackground: buttons[0]?.backgroundColor || "",
        secondaryBackgrounds,
        secondaryBorders,
        badImages: buttons.filter(item => item.backgroundImage !== "none"),
        badTransparent: buttons.filter(item => /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/i.test(item.backgroundColor)),
        badClip: buttons.filter(item => item.backgroundClip !== "border-box" || item.backgroundOrigin !== "border-box")
      };
    })();
    const operatorMobileDockWidthV253 = (() => {
      const buttons = operatorMobileDockButtonRects;
      const widths = buttons.map(item => item.width);
      const leftGaps = buttons.slice(1).map((item, index) => Math.round(item.left - buttons[index].right));
      return {
        count: buttons.length,
        widths,
        widthDelta: widths.length ? Math.max(...widths) - Math.min(...widths) : 0,
        leftGaps,
        gapDelta: leftGaps.length ? Math.max(...leftGaps) - Math.min(...leftGaps) : 0
      };
    })();
    const operatorMobileDockFrameV262 = (() => {
      const buttons = operatorMobileDockButtonRects;
      const first = buttons[0];
      const dockBottom = operatorDockRect ? Math.round(operatorDockRect.bottom) : 0;
      const buttonInsets = operatorDockRect ? buttons.map(button => ({
        top: Math.round(button.top - operatorDockRect.top),
        bottom: Math.round(dockBottom - (button.top + button.height))
      })) : [];
      const insetDeltas = buttonInsets.map(inset => Math.abs(inset.top - inset.bottom));
      return {
        count: buttons.length,
        height: operatorDockRect ? Math.round(operatorDockRect.height) : 0,
        paddingTop: operatorDockStyle ? Math.round(parseFloat(operatorDockStyle.paddingTop || "0")) : 0,
        paddingBottom: operatorDockStyle ? Math.round(parseFloat(operatorDockStyle.paddingBottom || "0")) : 0,
        topInset: operatorDockRect && first ? Math.round(first.top - operatorDockRect.top) : 0,
        bottomInset: operatorDockRect && first ? Math.round(dockBottom - (first.top + first.height)) : 0,
        insetDelta: operatorDockRect && first ? Math.abs(Math.round(first.top - operatorDockRect.top) - Math.round(dockBottom - (first.top + first.height))) : 0,
        buttonInsets,
        maxButtonInsetDelta: insetDeltas.length ? Math.max(...insetDeltas) : 0
      };
    })();
    const operatorFrameRhythmV254 = (() => {
      const measureStack = (selector, name) => {
        const stack = document.querySelector(selector);
        const items = stack ? [...stack.children].filter(visible) : [];
        const rects = items.map(item => {
          const rect = item.getBoundingClientRect();
          return {
            className: String(item.className || item.id || item.tagName || ""),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom)
          };
        }).filter(item => item.width > 0);
        const gaps = rects.slice(1).map((item, index) => Math.round(item.top - rects[index].bottom));
        return {
          name,
          count: rects.length,
          leftDelta: rects.length ? Math.max(...rects.map(item => item.left)) - Math.min(...rects.map(item => item.left)) : 0,
          rightDelta: rects.length ? Math.max(...rects.map(item => item.right)) - Math.min(...rects.map(item => item.right)) : 0,
          widthDelta: rects.length ? Math.max(...rects.map(item => item.width)) - Math.min(...rects.map(item => item.width)) : 0,
          gaps,
          gapDelta: gaps.length ? Math.max(...gaps) - Math.min(...gaps) : 0
        };
      };
      const buttonGroupSelectors = [
        ".operator-mobile-dock-v233",
        ".operator-round-rail-v226",
        ".operator-controller-grid-v226",
        ".operator-static-panel-v236 .btnrow",
        ".operator-static-panel-v236 .operator-download-button-row-v243",
        ".operator-static-panel-v236 .ops-buttons",
        ".point-buttons"
      ];
      const buttonGroups = buttonGroupSelectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map((group, index) => {
        const buttons = [...group.querySelectorAll(":scope > button")].filter(visible);
        const paddingSets = [...new Set(buttons.map(button => {
          const style = getComputedStyle(button);
          return [
            Math.round(parseFloat(style.paddingTop || "0")),
            Math.round(parseFloat(style.paddingRight || "0")),
            Math.round(parseFloat(style.paddingBottom || "0")),
            Math.round(parseFloat(style.paddingLeft || "0"))
          ].join("/");
        }))];
        return {
          selector,
          index,
          count: buttons.length,
          paddingSets
        };
      })).filter(item => item.count > 1);
      return {
        stacks: [
          measureStack(".operator-task-stack-v227", "task"),
          measureStack(".operator-side-v227", "side")
        ],
        badButtonGroups: buttonGroups.filter(item => item.paddingSets.length > 1)
      };
    })();
    const operatorMobileRewriteV255 = (() => {
      const normalizeHref = href => String(href || "").replace(/\\/g, "/");
      const styleHrefs = [...document.styleSheets].map(sheet => normalizeHref(sheet.href)).filter(Boolean);
      const appCssOrder = styleHrefs.findIndex(href => /src\/styles\/app\.css/.test(href));
      const rewriteCssOrder = styleHrefs.findIndex(href => /src\/styles\/operator-mobile\.css/.test(href));
      const columnCount = selector => {
        const element = document.querySelector(selector);
        if (!element || !visible(element)) return 0;
        const columns = getComputedStyle(element).gridTemplateColumns;
        if (!columns || columns === "none") return 0;
        return columns.split(" ").filter(Boolean).length;
      };
      const frameSelectors = [
        ".operator-titlebar-v249",
        ".operator-commandbar-v224",
        ".operator-overview-v226",
        ".operator-workspace-v227",
        ".operator-round-rail-v226",
        ".operator-current-task-v227",
        "#operatorSetupAreaV214",
        "#operatorOpsAreaV183",
        ".operator-mobile-dock-v233"
      ];
      const frames = frameSelectors.flatMap(selector => [...document.querySelectorAll(selector)]
        .filter(visible)
        .slice(0, 1)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            selector,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom)
          };
        }));
      const shell = document.querySelector(".operator-shell-v211");
      const shellChildren = shell ? [...shell.children].filter(child => visible(child) && getComputedStyle(child).position !== "fixed") : [];
      const shellGaps = shellChildren.slice(1).map((child, index) => {
        const previousRect = shellChildren[index].getBoundingClientRect();
        const rect = child.getBoundingClientRect();
        return Math.round(rect.top - previousRect.bottom);
      });
      const frameLefts = frames.map(item => item.left);
      const frameRights = frames.map(item => item.right);
      const frameWidths = frames.map(item => item.width);
      const legacyVisibleCount = [
        ...document.querySelectorAll(".mobile-operator-overview-v147"),
        ...document.querySelectorAll(".pc-operator-overview-v148")
      ].filter(visible).length;
      return {
        marker: getComputedStyle(document.body).getPropertyValue("--operator-mobile-rewrite-v255").trim(),
        styleOrderOk: appCssOrder >= 0 && rewriteCssOrder > appCssOrder,
        topRouteColumns: columnCount(".operator-mobile-top-route-v233"),
        dockColumns: columnCount(".operator-mobile-dock-v233"),
        overviewColumns: columnCount(".operator-overview-v226"),
        roundColumns: columnCount(".operator-round-rail-v226"),
        frames,
        frameEdgeDelta: frames.length ? Math.max(
          Math.max(...frameLefts) - Math.min(...frameLefts),
          Math.max(...frameRights) - Math.min(...frameRights)
        ) : 999,
        frameWidthDelta: frames.length ? Math.max(...frameWidths) - Math.min(...frameWidths) : 999,
        shellGaps,
        shellGapDelta: shellGaps.length ? Math.max(...shellGaps) - Math.min(...shellGaps) : 0,
        badShellGaps: shellGaps.filter(gap => gap < 6 || gap > 10),
        legacyVisibleCount
      };
    })();
    const operatorHeaderPolishV249 = (() => {
      const header = document.querySelector(".operator-titlebar-v249");
      const style = header ? getComputedStyle(header) : null;
      return {
        count: document.querySelectorAll(".operator-titlebar-v249").length,
        radius: style ? parseFloat(style.borderTopLeftRadius || "0") : 0,
        borderTop: style ? parseFloat(style.borderTopWidth || "0") : 0,
        minHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
        brand: String(header?.querySelector(".eyebrow")?.innerText || "").trim(),
        kicker: String(header?.querySelector(".unified-header-kicker-v173")?.innerText || "").trim(),
        title: String(header?.querySelector("h1")?.innerText || "").trim()
      };
    })();
    const operatorEmergencyPanelV249 = (() => {
      const card = document.querySelector(".emergency-adjust-card-v99");
      const style = card ? getComputedStyle(card) : null;
      return {
        count: document.querySelectorAll(".emergency-adjust-card-v99").length,
        radius: style ? parseFloat(style.borderTopLeftRadius || "0") : 0,
        borderTop: style ? parseFloat(style.borderTopWidth || "0") : 0
      };
    })();
    const operatorCompactRhythmV250 = (() => {
      const shell = document.querySelector(".operator-shell-v211");
      const visibleButtons = [...document.querySelectorAll(".operator-shell-v211 button")]
        .filter(visible)
        .map(button => {
          const rect = button.getBoundingClientRect();
          const childTops = [...button.children]
            .filter(visible)
            .map(child => Math.round(child.getBoundingClientRect().top));
          return {
            text: String(button.innerText || button.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
            className: String(button.className || ""),
            height: Math.round(rect.height),
            childTopCount: new Set(childTops).size
          };
        });
      const roundTabHeights = [...document.querySelectorAll(".operator-round-tab-v226")]
        .filter(visible)
        .map(tab => Math.round(tab.getBoundingClientRect().height));
      const taskStack = document.querySelector(".operator-task-stack-v227");
      const taskItems = taskStack ? [...taskStack.children].filter(visible).map(item => item.getBoundingClientRect()) : [];
      const taskGaps = taskItems.slice(1).map((rect, index) => Math.round(rect.top - taskItems[index].bottom));
      const header = document.querySelector(".operator-titlebar-v249");
      return {
        badButtons: visibleButtons.filter(item => item.childTopCount > 1 || item.height > (window.innerWidth <= 760 ? 42 : 46)).slice(0, 8),
        maxRoundTabHeight: roundTabHeights.length ? Math.max(...roundTabHeights) : 0,
        maxTaskGap: taskGaps.length ? Math.max(...taskGaps) : 0,
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0
      };
    })();
    const operatorRoundRail = document.querySelector(".operator-round-rail-v226");
    const operatorFinalShortcut = document.querySelector(".operator-final-shortcut-v245");
    const operatorPendingFinalBoxes = [...document.querySelectorAll(".operator-final-area-v227 > .final-box")].filter(visible);
    const operatorMergedOverviewV246 = {
      overviewCount: document.querySelectorAll(".operator-overview-v226").length,
      controlsInOverview: operatorOverview ? operatorOverview.querySelectorAll(":scope > .operator-overview-controls-v246").length : 0,
      feedbackInOverview: operatorOverview ? operatorOverview.querySelectorAll(":scope > .operator-feedback-v228").length : 0,
      standaloneControllerCount: document.querySelectorAll(".operator-task-stack-v227 > .operator-control-console-v226").length,
      controllerHeadCount: document.querySelectorAll(".operator-controller-head-v226").length,
      progressBadgeCount: operatorOverview ? operatorOverview.querySelectorAll(".operator-overview-progress-v246").length : 0,
      nextLineCount: operatorOverview ? operatorOverview.querySelectorAll(".operator-overview-next-v246").length : 0,
      text: String(operatorOverview?.innerText || operatorOverview?.textContent || "").trim().slice(0, 220)
    };
    const operatorFinalShortcutV245 = (() => {
      const railRect = operatorRoundRail?.getBoundingClientRect();
      const shortcutRect = operatorFinalShortcut?.getBoundingClientRect();
      const text = String(operatorFinalShortcut?.innerText || operatorFinalShortcut?.textContent || "").trim();
      let finalRaceStarted = false;
      let isRevival = false;
      try {
        finalRaceStarted = typeof state !== "undefined" && !!state.finalRace;
        isRevival = typeof state !== "undefined" && state.settings?.matchMode === "revival";
      } catch (error) {}
      return {
        count: operatorFinalShortcut && visible(operatorFinalShortcut) ? 1 : 0,
        text,
        finalRaceStarted,
        isRevival,
        pendingFinalBoxCount: operatorPendingFinalBoxes.length,
        topGap: railRect && shortcutRect ? Math.round(shortcutRect.top - railRect.bottom) : 999,
        leftDelta: railRect && shortcutRect ? Math.round(Math.abs(shortcutRect.left - railRect.left)) : 999,
        rightDelta: railRect && shortcutRect ? Math.round(Math.abs(shortcutRect.right - railRect.right)) : 999
      };
    })();
    const operatorBorderSample = [
      [".operator-overview-v226", "overview"],
      [".operator-commandbar-v224", "commandbar"],
      [".operator-round-rail-v226", "round-rail"],
      [".operator-round-tab-v226", "round-tab"],
      [".operator-current-task-v227", "current-task"],
      [".operator-side-panel-v227", "side-panel"],
      [".operator-mobile-dock-v233", "mobile-dock"]
    ].flatMap(([selector, name]) => [...document.querySelectorAll(selector)]
      .filter(visible)
      .slice(0, 3)
      .map(element => {
        const style = getComputedStyle(element);
        return {
          name,
          radius: parseFloat(style.borderTopLeftRadius || "0"),
          borderTop: parseFloat(style.borderTopWidth || "0")
        };
      }));
    const operatorFinalistConfirmButtons = [...document.querySelectorAll("button[onclick*='confirmRoundFinalist']")]
      .filter(visible)
      .map(button => String(button.innerText || button.textContent || "").trim());
    const operatorLowerPanels = {
      currentTask: document.querySelectorAll(".operator-current-task-v227").length,
      stageBoard: document.querySelectorAll(".operator-stage-board-v227").length,
      queuePanel: document.querySelectorAll(".operator-queue-panel-v227").length,
      sidePanel: document.querySelectorAll(".operator-side-panel-v227").length,
      stageCard: document.querySelectorAll(".operator-stage-v227").length,
      group: document.querySelectorAll(".operator-group-v227").length
    };
    const operatorQueuePanelGoneV248 = document.querySelectorAll(".operator-queue-panel-v227").length === 0
      && !String(document.body.innerText || document.body.textContent || "").includes("대기열");
    const operatorSideUnified = {
      sections: document.querySelectorAll(".operator-unified-section-v230").length,
      subheads: document.querySelectorAll(".operator-subhead-v230").length,
      toolPrimaryRows: document.querySelectorAll(".operator-tool-primary-row-v230").length
    };
    const operatorPointStageTrimV247 = [...document.querySelectorAll(".point-stage-trim-v247")]
      .filter(visible)
      .map(card => {
        const text = String(card.innerText || card.textContent || "");
        return {
          headCount: card.querySelectorAll(".operator-stage-head-v227").length,
          hasBroadcastCopy: text.includes("TV 송출중"),
          hasPointRuleCopy: /3\s*\/\s*2\s*\/\s*1\s*\/\s*0점/.test(text),
          text: text.slice(0, 160)
        };
      });
    const contentBounds = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const left = rect.left + (parseFloat(style.paddingLeft || "0") || 0);
      const right = rect.right - (parseFloat(style.paddingRight || "0") || 0);
      return { left, right, width: right - left };
    };
    const operatorSideAlignmentV243 = ["operatorSetupAreaV214", "operatorOpsAreaV183"].map(id => {
      const panel = document.getElementById(id);
      if (!panel) return { id, missing: true, headerEdgeDelta: 999, headerHeight: 0, badRows: [] };
      const panelRect = panel.getBoundingClientRect();
      const header = panel.querySelector(":scope > .ui-panel-head-v224");
      const headerRect = header ? header.getBoundingClientRect() : null;
      const rows = [...panel.querySelectorAll(".btnrow, .operator-tool-primary-row-v230, .operator-download-button-row-v243, .ops-buttons")]
        .filter(visible)
        .map(row => {
          const rowRect = row.getBoundingClientRect();
          const box = contentBounds(row.closest(".finalist-item, .operator-unified-section-v230, .ops-panel, .emergency-adjust-card-v99") || row.parentElement || row);
          const buttons = [...row.querySelectorAll(":scope > button")].filter(visible).map(button => button.getBoundingClientRect());
          const buttonLeft = buttons.length ? Math.min(...buttons.map(rect => rect.left)) : rowRect.left;
          const buttonRight = buttons.length ? Math.max(...buttons.map(rect => rect.right)) : rowRect.right;
          return {
            className: row.className,
            rowEdgeDelta: Math.max(Math.abs(rowRect.left - box.left), Math.abs(rowRect.right - box.right)),
            buttonEdgeDelta: Math.max(Math.abs(buttonLeft - rowRect.left), Math.abs(buttonRight - rowRect.right))
          };
        });
      return {
        id,
        missing: false,
        headerEdgeDelta: headerRect ? Math.max(Math.abs(headerRect.left - panelRect.left), Math.abs(headerRect.right - panelRect.right)) : 999,
        headerHeight: headerRect ? Math.round(headerRect.height) : 0,
        badRows: rows.filter(row => row.rowEdgeDelta > 2 || row.buttonEdgeDelta > 2)
      };
    });
    const operatorWrap = document.querySelector(".wrap");
    const operatorWrapStyle = operatorWrap ? getComputedStyle(operatorWrap) : null;
    const rosterRowHeights = [...document.querySelectorAll(".roster-table-v121 tbody tr")]
      .filter(row => row.querySelector("input[data-roster-select]"))
      .slice(0, 6)
      .map(row => Math.round(row.getBoundingClientRect().height));
    return {
      innerWidth: window.innerWidth,
      surface: doc.getAttribute("data-ui-surface") || "",
      build: doc.getAttribute("data-build-version") || "",
      release: doc.getAttribute("data-release-version") || "",
      bodyClass: body.className,
      textSample: text.slice(0, 220),
      appChildren: app ? app.children.length : 0,
      headerTop: headerRect ? Math.round(headerRect.top) : null,
      shellTop: shellRect ? Math.round(shellRect.top) : null,
      shellPaddingTop: shellStyle ? shellStyle.paddingTop : "",
      shellMarginTop: shellStyle ? shellStyle.marginTop : "",
      headerMarginTop: headerStyle ? headerStyle.marginTop : "",
      replacement: text.includes("\uFFFD"),
      questionCount: (text.match(/\?/g) || []).length,
      overflowX: Math.max(doc.scrollWidth, body.scrollWidth) - Math.max(doc.clientWidth, body.clientWidth),
      offscreen: controls.filter(item => !item.inHorizontalScroller && (item.left < -2 || item.right > window.innerWidth + 2)).slice(0, 8),
      buttons: [...document.querySelectorAll("button")].map(button => String(button.innerText || button.textContent || "").trim()).filter(Boolean).slice(0, 30),
      rosterRowCount: document.querySelectorAll(".roster-table-v121 tbody tr").length,
      rosterTableDisplay: rosterTable ? getComputedStyle(rosterTable).display : "",
      rosterWrapScrollable: rosterWrap ? rosterWrap.scrollWidth > rosterWrap.clientWidth + 2 : false,
      rosterMaxRowHeight: rosterRowHeights.length ? Math.max(...rosterRowHeights) : 0,
      rosterStarHeight: rosterStarRect ? Math.round(rosterStarRect.height) : 0,
      rosterStarOverflow: !!(rosterStarRect && rosterStarCellRect && (rosterStarRect.left < rosterStarCellRect.left - 1 || rosterStarRect.right > rosterStarCellRect.right + 1)),
      dbAddButtonHeight: dbAddButtonRect ? Math.round(dbAddButtonRect.height) : 0,
      dbCommandBarHeight: dbCommandBarRect ? Math.round(dbCommandBarRect.height) : 0,
      dbEmailPillDisplay: dbEmailPill ? getComputedStyle(dbEmailPill).display : "",
      dashboardAccountStripWidth: dashboardAccountStripRect ? Math.round(dashboardAccountStripRect.width) : 0,
      dashboardAccountButtonsWidth: dashboardAccountButtonsRect ? Math.round(dashboardAccountButtonsRect.width) : 0,
      dashboardAccountPillCount: document.querySelectorAll(".dashboard-account-strip-v207 .pill").length,
      dbToolbarGroups,
      dbMobileListRhythmV261,
      operatorMobileSlots,
      operatorFoldPanels,
      operatorStaticPanels,
      operatorTextClutterCount: operatorTextClutter.length,
      operatorTextClutterSample: operatorTextClutter.slice(0, 6),
      operatorSystemCopy,
      operatorDockHeight: operatorDockRect ? Math.round(operatorDockRect.height) : 0,
      operatorDockRadius: operatorDockStyle ? parseFloat(operatorDockStyle.borderTopLeftRadius || "0") : 0,
      operatorDockBorderTop: operatorDockStyle ? parseFloat(operatorDockStyle.borderTopWidth || "0") : 0,
      operatorDockBackdrop: operatorDockStyle ? String(operatorDockStyle.backdropFilter || operatorDockStyle.webkitBackdropFilter || "") : "",
      operatorControllerCount: document.querySelectorAll(".operator-control-console-v226").length,
      operatorReadyConsoleVisibleV240: operatorReadyConsoleV240 ? visible(operatorReadyConsoleV240) : false,
      operatorGroupCopyV241: {
        hasNew: operatorSettingsTextV241.includes("\uC870 \uD3B8\uC131"),
        hasOld: operatorSettingsTextV241.includes("\uC870 \uC218")
      },
      operatorLivePanelGoneV242: !document.querySelector("#operatorOpsAreaV183 .live-sync-panel")
        && !operatorToolsTextV242.includes("\uB77C\uC774\uBE0C \uC1A1\uCD9C")
        && !operatorToolsTextV242.includes("\uC1A1\uCD9C \uC5C6\uC74C")
        && !operatorToolsTextV242.includes("\uC1A1\uCD9C \uC911"),
      operatorControllerPrimaryText: String(operatorControllerPrimary?.innerText || operatorControllerPrimary?.textContent || "").trim(),
      operatorDockPrimaryText: String(operatorDockPrimary?.innerText || operatorDockPrimary?.textContent || "").trim(),
      operatorMobileTopRouteLabels,
      operatorMobileDockLabels,
      operatorMobileDockButtonHeights,
      operatorMobileDockAlignmentV249,
      operatorMobileDockOpticalV251,
      operatorMobileDockBackgroundV252,
      operatorMobileDockWidthV253,
      operatorMobileDockFrameV262,
      operatorFrameRhythmV254,
      operatorMobileRewriteV255,
      operatorHeaderPolishV249,
      operatorEmergencyPanelV249,
      operatorCompactRhythmV250,
      operatorMergedOverviewV246,
      operatorFinalShortcutV245,
      operatorBorderSample,
      operatorFinalistConfirmButtons,
      operatorFeedbackNearController: !!document.querySelector(".operator-control-console-v226 + .operator-feedback-v228"),
      operatorLowerPanels,
      operatorQueuePanelGoneV248,
      operatorSideUnified,
      operatorPointStageTrimV247,
      operatorSideAlignmentV243,
      operatorOpBadgeCount: document.querySelectorAll(".operator-avatar-v225").length,
      operatorWrapPaddingBottom: operatorWrapStyle ? parseFloat(operatorWrapStyle.paddingBottom || "0") : 0,
      currentStage: !!document.querySelector("#currentStageTop"),
      pointRows: document.querySelectorAll(".score-row").length,
      liveCards: document.querySelectorAll(".live-card-v89").length
    };
  });
  if (info.appChildren < 1) failures.push(`${label}: empty app root`);
  if (Number.isFinite(info.headerTop) && info.headerTop > (info.innerWidth <= 760 ? 10 : 16)) failures.push(`${label}: header top gap too large ${info.headerTop}px`);
  if (info.replacement || info.questionCount > 12) failures.push(`${label}: text encoding suspect ${info.textSample}`);
  if (info.overflowX > 2) failures.push(`${label}: horizontal overflow ${info.overflowX}px`);
  if (info.offscreen.length) failures.push(`${label}: offscreen controls ${JSON.stringify(info.offscreen)}`);
  if (info.surface === "operator" && info.operatorControllerCount !== 1) failures.push(`${label}: operator controller count ${info.operatorControllerCount} !== 1`);
  if (info.surface === "operator" && info.innerWidth <= 760 && !info.currentStage && info.operatorReadyConsoleVisibleV240) failures.push(`${label}: mobile ready current-game console should be hidden`);
  if (info.surface === "operator" && !info.operatorGroupCopyV241.hasNew) failures.push(`${label}: operator group composition copy missing`);
  if (info.surface === "operator" && info.operatorGroupCopyV241.hasOld) failures.push(`${label}: old operator group-count copy still visible`);
  if (info.surface === "operator" && !info.operatorLivePanelGoneV242) failures.push(`${label}: operator live broadcast panel should be removed`);
  if (info.surface === "operator" && info.operatorSystemCopy.length) failures.push(`${label}: operator system copy visible ${JSON.stringify(info.operatorSystemCopy)}`);
  if (info.surface === "operator" && info.operatorOpBadgeCount) failures.push(`${label}: operator OP badge still visible`);
  if (info.surface === "operator" && info.operatorFoldPanels) failures.push(`${label}: operator setup/tools still use folding details panels ${info.operatorFoldPanels}`);
  if (info.surface === "operator" && info.operatorStaticPanels !== 2) failures.push(`${label}: operator static side panel count ${info.operatorStaticPanels} !== 2`);
  if (info.surface === "operator") {
    const header = info.operatorHeaderPolishV249;
    if (header.count !== 1 || Math.round(header.radius) !== 8 || header.borderTop < 1 || header.minHeight < (info.innerWidth <= 760 ? 48 : 60) || !header.brand || !header.kicker || (info.innerWidth > 760 && !header.title)) {
      failures.push(`${label}: operator v249 header polish mismatch ${JSON.stringify(header)}`);
    }
    const emergency = info.operatorEmergencyPanelV249;
    if (emergency.count !== 1 || Math.round(emergency.radius) !== 8 || emergency.borderTop < 1) {
      failures.push(`${label}: operator v249 emergency panel border mismatch ${JSON.stringify(emergency)}`);
    }
    const compact = info.operatorCompactRhythmV250;
    if (compact.badButtons.length || compact.maxRoundTabHeight > (info.innerWidth <= 760 ? 40 : 42) || compact.maxTaskGap > 10 || compact.headerHeight > (info.innerWidth <= 760 ? 72 : 82)) {
      failures.push(`${label}: operator v250 compact rhythm mismatch ${JSON.stringify(compact)}`);
    }
  }
  if (info.surface === "operator") {
    const badBorder = info.operatorBorderSample.filter(item => Math.round(item.radius) !== 8 || item.borderTop < 1);
    if (badBorder.length) failures.push(`${label}: operator border contract mismatch ${JSON.stringify(badBorder)}`);
  }
  if (info.surface === "operator") {
    const merged = info.operatorMergedOverviewV246;
    if (merged.overviewCount !== 1 || merged.controlsInOverview !== 1 || merged.feedbackInOverview !== 1 || merged.standaloneControllerCount !== 0 || merged.controllerHeadCount !== 0) {
      failures.push(`${label}: operator current-game duplicate panels not merged ${JSON.stringify(merged)}`);
    }
    if (info.currentStage && (!merged.progressBadgeCount || !merged.nextLineCount)) {
      failures.push(`${label}: merged overview missing current group/progress detail ${JSON.stringify(merged)}`);
    }
  }
  if (info.surface === "operator" && !info.operatorFinalShortcutV245.finalRaceStarted && !info.operatorFinalShortcutV245.isRevival) {
    const shortcut = info.operatorFinalShortcutV245;
    if (shortcut.count !== 1) failures.push(`${label}: final shortcut missing under round tabs ${JSON.stringify(shortcut)}`);
    if (!/최종 결승 진행|9강 준결 생성/.test(shortcut.text)) failures.push(`${label}: final shortcut text mismatch ${JSON.stringify(shortcut)}`);
    if (shortcut.pendingFinalBoxCount !== 0) failures.push(`${label}: old pending final summary card still visible ${JSON.stringify(shortcut)}`);
    if (shortcut.topGap < 0 || shortcut.topGap > 16 || shortcut.leftDelta > 1 || shortcut.rightDelta > 1) failures.push(`${label}: final shortcut not aligned below round tabs ${JSON.stringify(shortcut)}`);
  }
  if (info.surface === "operator" && !info.operatorFeedbackNearController) failures.push(`${label}: operator feedback is not beside the controller`);
  if (/^(start-point-round|point-scores)$/.test(label) && info.surface === "operator" && info.operatorFinalistConfirmButtons.length) failures.push(`${label}: finalist confirm button visible before final stage ${JSON.stringify(info.operatorFinalistConfirmButtons)}`);
  if (/^(start-point-round|point-scores)$/.test(label) && info.surface === "operator") {
    if (!info.operatorPointStageTrimV247.length) failures.push(`${label}: point stage trim card missing`);
    const badPointStageTrim = info.operatorPointStageTrimV247.filter(item => item.headCount || item.hasBroadcastCopy || item.hasPointRuleCopy);
    if (badPointStageTrim.length) failures.push(`${label}: point stage header/rule copy still visible ${JSON.stringify(badPointStageTrim)}`);
  }
  if (info.surface === "operator" && info.operatorLowerPanels.currentTask !== 1) failures.push(`${label}: operator v227 current task count ${info.operatorLowerPanels.currentTask} !== 1`);
  if (info.surface === "operator" && info.currentStage && !info.operatorLowerPanels.stageBoard) failures.push(`${label}: operator v227 stage board missing`);
  if (info.surface === "operator" && !info.operatorQueuePanelGoneV248) failures.push(`${label}: operator v248 queue panel still visible ${info.operatorLowerPanels.queuePanel}`);
  if (info.surface === "operator" && info.operatorLowerPanels.sidePanel !== 2) failures.push(`${label}: operator v227 side panel count ${info.operatorLowerPanels.sidePanel} !== 2`);
  if (info.surface === "operator" && info.operatorSideUnified.sections < 4) failures.push(`${label}: operator v230 unified sections missing ${JSON.stringify(info.operatorSideUnified)}`);
  if (info.surface === "operator" && info.operatorSideUnified.subheads < 4) failures.push(`${label}: operator v230 subheads missing ${JSON.stringify(info.operatorSideUnified)}`);
  if (info.surface === "operator" && info.operatorSideUnified.toolPrimaryRows !== 1) failures.push(`${label}: operator v230 tool primary row count ${info.operatorSideUnified.toolPrimaryRows} !== 1`);
  if (info.surface === "operator") {
    const badSideAlignment = info.operatorSideAlignmentV243.filter(item => item.missing || item.headerEdgeDelta > 1 || item.headerHeight < (info.innerWidth <= 760 ? 42 : 44) || item.badRows.length);
    if (badSideAlignment.length) failures.push(`${label}: operator side panel header/button alignment mismatch ${JSON.stringify(badSideAlignment)}`);
  }
  if (info.surface === "operator") {
    const rhythm = info.operatorFrameRhythmV254;
    const badStacks = rhythm.stacks.filter(item => item.count > 1 && (item.leftDelta > 1 || item.rightDelta > 1 || item.widthDelta > 1 || item.gapDelta > 2));
    if (badStacks.length || rhythm.badButtonGroups.length) {
      failures.push(`${label}: operator frame/button rhythm mismatch ${JSON.stringify({ badStacks, badButtonGroups: rhythm.badButtonGroups })}`);
    }
  }
  if (info.surface === "operator" && info.currentStage && !info.operatorLowerPanels.group) failures.push(`${label}: operator v227 group DOM missing`);
  if (info.surface === "operator" && info.innerWidth > 760 && !info.operatorControllerPrimaryText) failures.push(`${label}: operator controller primary action missing`);
  if (info.surface === "operator" && info.innerWidth <= 760 && !info.operatorDockPrimaryText) failures.push(`${label}: operator mobile dock primary action missing`);
  if (info.surface === "operator" && info.innerWidth <= 760) {
    const rewrite = info.operatorMobileRewriteV255;
    if (rewrite.marker !== "1" || !rewrite.styleOrderOk || rewrite.topRouteColumns !== 4 || rewrite.dockColumns !== 4 || rewrite.overviewColumns !== 3 || rewrite.roundColumns !== 3 || rewrite.legacyVisibleCount) {
      failures.push(`${label}: operator mobile rewrite v255 contract mismatch ${JSON.stringify(rewrite)}`);
    }
    if (rewrite.frameEdgeDelta > 1 || rewrite.frameWidthDelta > 1 || rewrite.shellGapDelta > 1 || rewrite.badShellGaps.length) {
      failures.push(`${label}: operator mobile rewrite v255 alignment mismatch ${JSON.stringify({ frameEdgeDelta: rewrite.frameEdgeDelta, frameWidthDelta: rewrite.frameWidthDelta, shellGaps: rewrite.shellGaps, badShellGaps: rewrite.badShellGaps, frames: rewrite.frames })}`);
    }
    const dockAlignment = info.operatorMobileDockAlignmentV249;
    if (dockAlignment.count !== 4 || dockAlignment.heightDelta > 1 || dockAlignment.topDelta > 1 || dockAlignment.centerDelta > 1 || dockAlignment.badDisplay.length) {
      failures.push(`${label}: operator mobile dock vertical alignment mismatch ${JSON.stringify(dockAlignment)}`);
    }
    const dockOptical = info.operatorMobileDockOpticalV251;
    if (dockOptical.count !== 4 || dockOptical.textCenterOffsetDelta > 1 || dockOptical.maxAbsTextCenterOffset > 1 || dockOptical.badLines.length || dockOptical.badOverflow.length || dockOptical.badPadding.length || dockOptical.badPlacement.length) {
      failures.push(`${label}: operator mobile dock optical alignment mismatch ${JSON.stringify(dockOptical)}`);
    }
    const dockBackground = info.operatorMobileDockBackgroundV252;
    if (dockBackground.count !== 4 || !dockBackground.primaryBackground || dockBackground.secondaryBackgrounds.length !== 1 || dockBackground.secondaryBorders.length !== 1 || dockBackground.badImages.length || dockBackground.badTransparent.length || dockBackground.badClip.length) {
      failures.push(`${label}: operator mobile dock background mismatch ${JSON.stringify(dockBackground)}`);
    }
    const dockWidth = info.operatorMobileDockWidthV253;
    if (dockWidth.count !== 4 || dockWidth.widthDelta > 1 || dockWidth.gapDelta > 1) {
      failures.push(`${label}: operator mobile dock background width mismatch ${JSON.stringify(dockWidth)}`);
    }
    const dockFrame = info.operatorMobileDockFrameV262;
    if (dockFrame.count !== 4 || dockFrame.height !== 58 || dockFrame.paddingTop !== 8 || dockFrame.paddingBottom !== 8 || dockFrame.topInset !== 9 || dockFrame.bottomInset !== 9 || dockFrame.insetDelta > 1 || dockFrame.maxButtonInsetDelta > 1) {
      failures.push(`${label}: operator mobile dock vertical frame mismatch ${JSON.stringify(dockFrame)}`);
    }
    const missingRoutes = ["선수", "기록", "라이브", "관리"].filter(item => !info.operatorMobileTopRouteLabels.includes(item));
    const missingDock = ["경기", "설정", "기타"].filter(item => !info.operatorMobileDockLabels.includes(item));
    if (missingRoutes.length) failures.push(`${label}: operator mobile top route buttons missing ${missingRoutes.join(", ")} from ${JSON.stringify(info.operatorMobileTopRouteLabels)}`);
    if (missingDock.length) failures.push(`${label}: operator mobile dock buttons missing ${missingDock.join(", ")} from ${JSON.stringify(info.operatorMobileDockLabels)}`);
    if (info.operatorMobileDockButtonHeights.length) {
      const minDockButtonHeight = Math.min(...info.operatorMobileDockButtonHeights);
      const maxDockButtonHeight = Math.max(...info.operatorMobileDockButtonHeights);
      if (maxDockButtonHeight - minDockButtonHeight > 1) failures.push(`${label}: operator mobile dock button heights differ ${JSON.stringify(info.operatorMobileDockButtonHeights)}`);
      if (maxDockButtonHeight > 40) failures.push(`${label}: operator mobile dock buttons too tall ${JSON.stringify(info.operatorMobileDockButtonHeights)}`);
    }
    if (info.operatorDockHeight > 70) failures.push(`${label}: operator mobile dock too tall ${info.operatorDockHeight}px`);
    if (info.operatorDockRadius > 10) failures.push(`${label}: operator mobile dock radius too round ${info.operatorDockRadius}px`);
    if (info.operatorDockBorderTop < 1) failures.push(`${label}: operator mobile dock border missing ${info.operatorDockBorderTop}px`);
    if (info.operatorDockBackdrop && info.operatorDockBackdrop !== "none") failures.push(`${label}: operator mobile dock backdrop should be flat ${info.operatorDockBackdrop}`);
  }
  if (info.surface === "player-management" && info.innerWidth > 760 && info.rosterWrapScrollable) failures.push(`${label}: DB desktop table should not horizontally scroll`);
  if (info.surface === "player-management" && info.innerWidth > 760 && info.rosterMaxRowHeight > 44) failures.push(`${label}: DB desktop row too tall ${info.rosterMaxRowHeight}px`);
  if (info.surface === "player-management" && info.innerWidth > 760 && info.rosterStarHeight > 28) failures.push(`${label}: DB favorite star too tall ${info.rosterStarHeight}px`);
  if (info.surface === "player-management" && info.innerWidth > 760 && info.rosterStarOverflow) failures.push(`${label}: DB favorite star overlaps its cell`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.rosterTableDisplay !== "block") failures.push(`${label}: DB mobile roster should render as card list, got ${info.rosterTableDisplay}`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.rosterWrapScrollable) failures.push(`${label}: DB mobile roster should not require horizontal scroll`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.rosterMaxRowHeight > 360) failures.push(`${label}: DB mobile roster card too tall ${info.rosterMaxRowHeight}px`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.dbAddButtonHeight > 34) failures.push(`${label}: DB add-player button too tall ${info.dbAddButtonHeight}px`);
  if (info.surface === "player-management" && info.dbToolbarGroups.length !== 3) failures.push(`${label}: DB toolbar groups ${info.dbToolbarGroups.length} !== 3`);
  if (info.surface === "player-management" && info.innerWidth > 760 && info.dbCommandBarHeight > 54) failures.push(`${label}: DB toolbar too tall ${info.dbCommandBarHeight}px`);
  if (info.surface === "player-management" && info.innerWidth > 760 && info.dbToolbarGroups.some(group => group.itemTopCount > 1)) failures.push(`${label}: DB toolbar group wrapped ${JSON.stringify(info.dbToolbarGroups)}`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.dbEmailPillDisplay !== "none") failures.push(`${label}: DB mobile email pill is visible`);
  if (info.surface === "player-management" && info.innerWidth <= 760 && info.dbCommandBarHeight > 145) failures.push(`${label}: DB mobile toolbar too tall ${info.dbCommandBarHeight}px`);
  if (info.surface === "player-management" && info.innerWidth <= 760) {
    const rhythm = info.dbMobileListRhythmV261 || {};
    if (rhythm.workspaceDisplay !== "flex" || rhythm.workspaceGap !== 10) failures.push(`${label}: DB mobile workspace rhythm drift ${JSON.stringify(rhythm)}`);
    if (rhythm.rosterCardDisplay !== "flex" || rhythm.rosterCardGap !== 8) failures.push(`${label}: DB mobile list card rhythm drift ${JSON.stringify(rhythm)}`);
    if (rhythm.commandToWorkspaceGap < 8) failures.push(`${label}: DB command buttons overlap workspace ${JSON.stringify(rhythm)}`);
    if (rhythm.bulkToTableGap < 8) failures.push(`${label}: DB bulk buttons overlap roster list ${JSON.stringify(rhythm)}`);
    if (rhythm.rosterWrapOverflowX !== "hidden") failures.push(`${label}: DB mobile roster should hide horizontal overflow ${JSON.stringify(rhythm)}`);
    if (rhythm.tableDisplay !== "block" || rhythm.tableHeadDisplay !== "none" || rhythm.tableBodyDisplay !== "grid" || rhythm.firstRowDisplay !== "grid" || rhythm.firstRowGridColumns !== 3) {
      failures.push(`${label}: DB mobile roster card structure mismatch ${JSON.stringify(rhythm)}`);
    }
    if (rhythm.firstRowBadCellCount > 0 || rhythm.firstRowBadControlCount > 0) {
      failures.push(`${label}: DB mobile roster card cells overflow ${JSON.stringify(rhythm)}`);
    }
    if (rhythm.tableHeaderPosition !== "static") failures.push(`${label}: DB mobile roster header should not be sticky ${JSON.stringify(rhythm)}`);
    if (rhythm.buttonListOverlapCount > 0) failures.push(`${label}: DB mobile buttons overlap roster list ${JSON.stringify(rhythm)}`);
  }
  if (info.surface === "dashboard" && info.innerWidth <= 760 && info.dashboardAccountPillCount !== 1) failures.push(`${label}: dashboard account pills ${info.dashboardAccountPillCount} !== 1`);
  if (info.surface === "dashboard" && info.innerWidth <= 760 && info.dashboardAccountStripWidth && info.dashboardAccountButtonsWidth < info.dashboardAccountStripWidth - 16) failures.push(`${label}: dashboard account buttons do not fill the card ${info.dashboardAccountButtonsWidth}/${info.dashboardAccountStripWidth}`);
  if (info.surface === "operator" && info.innerWidth <= 760 && info.currentStage && info.operatorMobileSlots.length) {
    const badSlots = info.operatorMobileSlots.filter(slot => slot.columns !== 2 || slot.h2hWidth < 100 || slot.h2hRightOverflow || slot.laneClipped);
    const minSlotHeight = Math.min(...info.operatorMobileSlots.map(slot => slot.height));
    const maxSlotHeight = Math.max(...info.operatorMobileSlots.map(slot => slot.height));
    if (badSlots.length) failures.push(`${label}: mobile operator slot content cramped ${JSON.stringify(badSlots.slice(0, 3))}`);
    if (minSlotHeight < 84) failures.push(`${label}: mobile operator slot too short ${minSlotHeight}px`);
    if (maxSlotHeight > 150) failures.push(`${label}: mobile operator slot too tall ${maxSlotHeight}px`);
    if (info.operatorDockHeight && info.operatorWrapPaddingBottom < info.operatorDockHeight + 36) failures.push(`${label}: mobile operator dock clearance too small ${info.operatorWrapPaddingBottom}/${info.operatorDockHeight}`);
  }
  if (/^(start-point-round|point-scores)$/.test(label) && info.surface === "operator" && info.innerWidth <= 760 && info.currentStage) {
    if (info.operatorTextClutterCount > 3) failures.push(`${label}: mobile operator text clutter ${info.operatorTextClutterCount} ${JSON.stringify(info.operatorTextClutterSample)}`);
  }
  return info;
}

async function clickByText(page, text, failures, label = text) {
  const locator = page.getByRole("button", { name: text }).first();
  const count = await locator.count();
  if (!count) {
    failures.push(`missing button: ${label}`);
    return false;
  }
  await locator.click();
  await page.waitForTimeout(250);
  return true;
}

async function showOperatorPage(page) {
  await page.evaluate(() => {
    location.hash = "";
    renderOperator();
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator", null, { timeout: 10000 });
  // Let the hashchange boot and its lease/background-sync callbacks settle
  // before the next page.evaluate mutates the same operator state.
  await page.waitForTimeout(180);
}

async function clickOperatorMobileRoute(page, label, failures) {
  const locator = page.locator(".operator-mobile-top-route-v233 button").filter({ hasText: label }).first();
  const count = await locator.count();
  if (!count) {
    failures.push(`missing mobile operator route: ${label}`);
    return false;
  }
  await locator.click();
  await page.waitForTimeout(350);
  return true;
}

async function runViewport(browser, meta, viewport) {
  const failures = [];
  const logs = [];
  const page = await browser.newPage({ viewport });
  await installNetworkStubs(page);
  page.on("console", msg => {
    if (msg.type() === "error") failures.push(`console error: ${msg.text()}`);
  });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded", timeout: 25000 });
  try {
    await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator", null, { timeout: 10000 });
  } catch (error) {
    throw new Error(`${error.message}; startup failures: ${failures.join(" | ")}`);
  }

  logs.push({ step: "operator-load", info: await assertNoUiBreakage(page, "operator-load", failures) });

  const functionTypes = await page.evaluate(() => ({
    setMatchMode: typeof window.setMatchMode,
    startQualifierRound: typeof window.startQualifierRound,
    setTournamentField: typeof window.setTournamentField,
    createNextStage: typeof window.createNextStage,
    goToNextRoundAfterFinalist: typeof window.goToNextRoundAfterFinalist,
    setPointScore: typeof window.setPointScore,
    setForcedGroupCountDraft: typeof window.setForcedGroupCountDraft,
    commitForcedGroupCountInput: typeof window.commitForcedGroupCountInput,
    restoreOperatorUndoV266: typeof window.restoreOperatorUndoV266,
    scrollOperatorSectionV147: typeof window.scrollOperatorSectionV147,
    requestActiveTournamentListV135: typeof window.requestActiveTournamentListV135,
    retryFinishSyncV278: typeof window.retryFinishSyncV278
  }));
  Object.entries(functionTypes).forEach(([name, type]) => {
    if (type !== "function") failures.push(`global function missing: ${name} (${type})`);
  });

  const firebaseServerClockLeaseV279 = await page.evaluate(async () => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const clock = window.__mini4wdFirebaseServerClockV279;
    const store = window.__qaFirebaseStore;
    const venueId = "qa-clock-offset-v279";
    if (!clock || typeof clock.now !== "function" || typeof clock.refresh !== "function") {
      return { supported: false };
    }
    const backupInfo = clone(store[".info"]);
    const backupLease = clone(store.operationLocks?.leases?.[venueId]);
    const backupState = exportState();
    const backupActiveRoundIndex = activeRoundIndex;
    const backupFirebaseTournamentId = firebaseTournamentId;
    const originalDateNow = Date.now;
    let result = { supported: true };
    try {
      store[".info"] = { ...(store[".info"] || {}), serverTimeOffset: 30_000 };
      const offsetLoaded = await clock.refresh(true);
      store[".info"].serverTimeOffset = 31_000;
      Date.now = () => originalDateNow() - 120_000;
      const rollbackRefresh = await clock.refresh(false);
      const rollbackOffset = clock.offset();
      Date.now = originalDateNow;
      store[".info"].serverTimeOffset = 30_000;
      await clock.refresh(true);
      state.tournament.status = "draft";
      firebaseTournamentId = "";
      const claimed = await window.claimOperationLeaseV178("qa-server-clock-v279", true, {
        venueId,
        venueName: "QA Clock Venue",
        tournamentId: "",
        tournamentName: "",
        registryGeneration: "",
        status: "draft"
      });
      const lease = clone(store.operationLocks?.leases?.[venueId]);
      const serverRemainingMs = Number(lease?.leaseUntil || 0) - clock.now();
      const clientRemainingMs = Number(lease?.leaseUntil || 0) - Date.now();
      result = {
        supported: true,
        offsetLoaded,
        loadedOffset: clock.offset(),
        rollbackRefresh,
        rollbackOffset,
        rollbackClockRefetched: rollbackRefresh && rollbackOffset === 31_000,
        claimed,
        lease,
        serverRemainingMs,
        clientRemainingMs,
        leaseUsesServerClock: Boolean(
          claimed
          && Number(lease?.leaseUntil || 0) > 0
          && serverRemainingMs >= 43_000
          && serverRemainingMs <= 45_500
          && clientRemainingMs >= 73_000
          && clientRemainingMs <= 75_500
        )
      };
    } finally {
      Date.now = originalDateNow;
      store[".info"] = { ...(store[".info"] || {}), serverTimeOffset: 0 };
      await clock.refresh(true);
      result.offsetRestored = clock.offset() === 0;
      if (backupInfo == null) delete store[".info"];
      else store[".info"] = backupInfo;
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      if (backupLease == null) delete store.operationLocks.leases[venueId];
      else store.operationLocks.leases[venueId] = backupLease;
      state = normalizeImportedState(backupState);
      activeRoundIndex = backupActiveRoundIndex;
      state.activeRoundIndex = backupActiveRoundIndex;
      firebaseTournamentId = backupFirebaseTournamentId;
      persistCurrentState();
    }
    return result;
  });
  logs.push({ step: "firebase-server-clock-lease-v279", info: { firebaseServerClockLeaseV279 } });
  if (
    !firebaseServerClockLeaseV279.supported
    || !firebaseServerClockLeaseV279.offsetLoaded
    || firebaseServerClockLeaseV279.loadedOffset !== 30_000
    || !firebaseServerClockLeaseV279.rollbackClockRefetched
    || !firebaseServerClockLeaseV279.claimed
    || !firebaseServerClockLeaseV279.leaseUsesServerClock
    || !firebaseServerClockLeaseV279.offsetRestored
  ) {
    failures.push(`firebase server clock lease v279 failed ${JSON.stringify(firebaseServerClockLeaseV279)}`);
  }

  const publicPayloadPrivacy = await page.evaluate(() => {
    const rawIdA = "player-phone-01012345678";
    const rawIdB = "player-phone-01087654321";
    const playerA = {
      id: rawIdA,
      name: "REAL_NAME_SECRET_A",
      nickname: "Alpha",
      team: "QA",
      lane: 1,
      realName: "REAL_NAME_SECRET_A",
      contact: "CONTACT_SECRET_A",
      privatePlayerField: "PRIVATE_PLAYER_SECRET_A"
    };
    const playerB = {
      id: rawIdB,
      name: "REAL_NAME_SECRET_B",
      nickname: "Beta",
      team: "QB",
      lane: 2,
      realName: "REAL_NAME_SECRET_B",
      contact: "CONTACT_SECRET_B",
      privatePlayerField: "PRIVATE_PLAYER_SECRET_B"
    };
    const makeSensitiveGroup = (id, name) => ({
      id,
      name,
      slots: [playerA, playerB],
      advanceIds: [rawIdA],
      points: { [rawIdA]: 3, [rawIdB]: 0 },
      tiedScore: 3,
      realName: "GROUP_REAL_NAME_SECRET",
      contact: "GROUP_CONTACT_SECRET",
      privateGroupField: "PRIVATE_GROUP_SECRET"
    });
    const source = {
      inputText: "PRIVATE_INPUT_TEXT",
      privateTopLevelField: "PRIVATE_TOP_LEVEL_SECRET",
      settings: { laneCount: 3, matchMode: "points3", contact: "SETTINGS_CONTACT_SECRET" },
      tournament: {
        name: "Public DTO QA",
        venue: "QA Venue",
        venueId: "qa-venue",
        raceClass: "오픈",
        status: "running",
        realName: "TOURNAMENT_REAL_NAME_SECRET",
        contact: "TOURNAMENT_CONTACT_SECRET"
      },
      activeRoundIndex: 0,
      broadcast: { mode: "stage", roundIndex: 0, stageIndex: 0, privateBroadcastField: "PRIVATE_BROADCAST_SECRET" },
      qualifierRounds: [{
        id: "privacy-round",
        index: 1,
        title: "1차 라운드",
        stagePlan: ["포인트 결정전"],
        privateRoundField: "PRIVATE_ROUND_SECRET",
        finalist: { ...playerA },
        crowFinalists: [{ ...playerA, crowRank: 1 }],
        stages: [{
          id: "privacy-stage",
          qualifierIndex: 1,
          stageIndex: 1,
          name: "포인트 결정전",
          type: "pointFinal",
          pointOptions: [3, 2, 1, 0],
          pointFinalRule: "top-score",
          pointTreeStep: 2,
          pointTreeRanking: [
            { ...playerA, total: 3 },
            { ...playerB, total: 0 }
          ],
          pointFinalSource: [
            { ...playerA, total: 3 },
            { ...playerB, total: 0 }
          ],
          meta: { attempts: 4, score: 8, sameTeam: 1, groupSize: 2, privateMetaField: "PRIVATE_META_SECRET" },
          groups: [makeSensitiveGroup("privacy-stage-group", "예선 1조")],
          realName: "STAGE_REAL_NAME_SECRET",
          contact: "STAGE_CONTACT_SECRET",
          privateStageField: "PRIVATE_STAGE_SECRET"
        }]
      }],
      finalRace: {
        id: "privacy-final",
        name: "최종 결승",
        type: "pointFinal",
        groupSize: 2,
        group: makeSensitiveGroup("privacy-final-group", "FINAL"),
        realName: "FINAL_REAL_NAME_SECRET",
        contact: "FINAL_CONTACT_SECRET",
        privateFinalField: "PRIVATE_FINAL_SECRET"
      },
      updatedAt: 123456789
    };
    const payload = makePublicStatePayload(source);
    // makePublicStatePayload persists aliases on the private source. Clone that
    // persisted state, add a lexicographically earlier late racer, and verify
    // existing public IDs do not shift when the participant set grows.
    const rawIdC = "000-private-added-participant";
    const expandedSource = JSON.parse(JSON.stringify(source));
    const expandedGroup = expandedSource.qualifierRounds[0].stages[0].groups[0];
    expandedGroup.slots.push({
      id: rawIdC,
      name: "REAL_NAME_SECRET_C",
      nickname: "Gamma",
      team: "QC",
      lane: 3,
      contact: "CONTACT_SECRET_C"
    });
    expandedGroup.points[rawIdC] = 1;
    const expandedPayload = makePublicStatePayload(expandedSource);
    const json = JSON.stringify([payload, expandedPayload]);
    const stage = payload.qualifierRounds?.[0]?.stages?.[0];
    const stageGroup = stage?.groups?.[0];
    const finalGroup = payload.finalRace?.group;
    const alphaId = stageGroup?.slots?.find(player => player.name === "Alpha")?.id || "";
    const betaId = stageGroup?.slots?.find(player => player.name === "Beta")?.id || "";
    const expandedStageGroup = expandedPayload.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
    const expandedAlphaId = expandedStageGroup?.slots?.find(player => player.name === "Alpha")?.id || "";
    const expandedBetaId = expandedStageGroup?.slots?.find(player => player.name === "Beta")?.id || "";
    const expandedGammaId = expandedStageGroup?.slots?.find(player => player.name === "Gamma")?.id || "";
    const rankingIds = Object.fromEntries((stage?.pointTreeRanking || []).map(player => [player.name, player.id]));
    const sourceIds = Object.fromEntries((stage?.pointFinalSource || []).map(player => [player.name, player.id]));
    const h2hNames = Object.fromEntries((stageGroup?.slots || [])
      .filter(player => !player.isEmptyLane)
      .map(player => [player.name, (player.h2hMetrics || []).map(item => item.name)]));
    const forbiddenKeys = new Set([
      "contact", "realName", "privateTopLevelField", "privateBroadcastField", "privateRoundField",
      "privatePlayerField", "privateGroupField", "privateStageField", "privateMetaField", "privateFinalField",
      "publicParticipantAliases"
    ]);
    const forbiddenKeyPaths = [];
    const visit = (value, path = "payload") => {
      if (!value || typeof value !== "object") return;
      Object.entries(value).forEach(([key, child]) => {
        const childPath = `${path}.${key}`;
        if (forbiddenKeys.has(key)) forbiddenKeyPaths.push(childPath);
        visit(child, childPath);
      });
    };
    visit(payload);
    visit(expandedPayload, "expandedPayload");
    const forbiddenTokens = [
      rawIdA, rawIdB, rawIdC, "01012345678", "01087654321",
      "REAL_NAME_SECRET", "CONTACT_SECRET", "PRIVATE_", "PRIVATE_INPUT_TEXT"
    ];
    const leakedTokens = forbiddenTokens.filter(token => json.includes(token));
    const stagePointIdsConsistent = Boolean(
      alphaId && betaId && alphaId.startsWith("pub-") && betaId.startsWith("pub-") && alphaId !== betaId
      && stageGroup.advanceIds.length === 1 && stageGroup.advanceIds[0] === alphaId
      && stageGroup.points[alphaId] === 3 && stageGroup.points[betaId] === 0
      && rankingIds.Alpha === alphaId && rankingIds.Beta === betaId
      && sourceIds.Alpha === alphaId && sourceIds.Beta === betaId
    );
    const finalIdsConsistent = Boolean(
      finalGroup?.slots?.find(player => player.name === "Alpha")?.id === alphaId
      && finalGroup?.slots?.find(player => player.name === "Beta")?.id === betaId
      && finalGroup?.advanceIds?.[0] === alphaId
      && finalGroup?.points?.[alphaId] === 3
      && finalGroup?.points?.[betaId] === 0
    );
    const h2hNamesSanitized = h2hNames.Alpha?.join("|") === "Beta" && h2hNames.Beta?.join("|") === "Alpha";
    const participantSetChangeIdsStable = Boolean(
      expandedAlphaId === alphaId
      && expandedBetaId === betaId
      && expandedGammaId.startsWith("pub-")
      && expandedGammaId !== alphaId
      && expandedGammaId !== betaId
    );
    const allowlistPreserved = Boolean(
      stage?.id === "privacy-stage"
      && stage?.qualifierIndex === 1
      && stage?.stageIndex === 1
      && stage?.type === "pointFinal"
      && stage?.pointFinalRule === "top-score"
      && stage?.pointTreeStep === 2
      && stage?.meta?.attempts === 4
      && stageGroup?.tiedScore === 3
      && payload.finalRace?.id === "privacy-final"
      && payload.finalRace?.groupSize === 2
    );
    return {
      forbiddenKeyPaths,
      leakedTokens,
      stagePointIdsConsistent,
      finalIdsConsistent,
      h2hNamesSanitized,
      participantSetChangeIdsStable,
      allowlistPreserved,
      alphaId,
      betaId,
      h2hNames,
      stageKeys: Object.keys(stage || {}),
      groupKeys: Object.keys(stageGroup || {}),
      finalRaceKeys: Object.keys(payload.finalRace || {})
    };
  });
  logs.push({ step: "public-payload-privacy", info: { publicPayloadPrivacy } });
  if (publicPayloadPrivacy.forbiddenKeyPaths.length || publicPayloadPrivacy.leakedTokens.length) {
    failures.push(`public payload leaked private fields ${JSON.stringify(publicPayloadPrivacy)}`);
  }
  if (!publicPayloadPrivacy.stagePointIdsConsistent || !publicPayloadPrivacy.finalIdsConsistent || !publicPayloadPrivacy.h2hNamesSanitized || !publicPayloadPrivacy.participantSetChangeIdsStable || !publicPayloadPrivacy.allowlistPreserved) {
    failures.push(`public payload id mapping or allowlist regression ${JSON.stringify(publicPayloadPrivacy)}`);
  }

  const remoteAutoClosePrivacyV278 = await page.evaluate(async () => {
    const staleId = "qa-stale-private-v278";
    const refreshedId = "qa-refreshed-before-close-v278";
    const legacyId = "qa-legacy-flat-close-v278";
    const rollbackId = "qa-public-close-reject-v278";
    const freshnessId = "qa-public-freshness-reject-v278";
    const doubleFailureId = "qa-public-and-rollback-reject-v278";
    const parentFreshId = "qa-parent-timestamp-fresh-v278";
    const concurrentId = "qa-concurrent-publisher-lease-v278";
    const finalizeFailureId = "qa-finalize-marker-reject-v278";
    const divergentFinishId = "qa-divergent-terminal-finish-v278";
    const divergentAutoId = "qa-divergent-terminal-auto-v278";
    const finishConflictId = "qa-finish-pending-newer-running-v278";
    const competingActiveId = "qa-competing-active-v278";
    const supersededFinishId = "qa-superseded-finish-v278";
    const supersededAutoId = "qa-superseded-auto-close-v278";
    const generationConflictId = "qa-generation-conflict-v278";
    const registryReleaseRaceId = "qa-registry-release-race-v278";
    const cleanupRaceOldId = "qa-cleanup-race-old-v278";
    const cleanupRaceNewId = "qa-cleanup-race-new-v278";
    const twoPhaseId = "qa-private-public-compensation-v278";
    const twoPhaseRaceId = "qa-private-public-cas-race-v278";
    const futurePublisherAutoId = "qa-future-publisher-auto-close-v279";
    const strictNumericAutoId = "qa-strict-numeric-auto-close-v279";
    const staleAt = Date.now() - (61 * 60 * 1000);
    const makePrivateState = (id, updatedAt) => {
      const next = makeInitialState(3);
      next.remoteWriteProtocolV279 = 279;
      const rawPlayerId = `${id}-phone-01012345678`;
      const secondRawPlayerId = `${id}-phone-01087654321`;
      next.inputText = `PRIVATE_STALE_INPUT_${id}`;
      next.settings = { ...next.settings, laneCount: 3, matchMode: "basic" };
      next.tournament = {
        ...next.tournament,
        remoteWriteProtocolV279: 279,
        name: `Auto close ${id}`,
        venue: "QA Venue",
        venueId: "qa-venue",
        raceClass: "오픈",
        status: "running",
        liveId: id,
        liveSignature: `${id}-signature`,
        lockedParticipants: `PRIVATE_LOCKED_PARTICIPANTS_${id}`,
        privateTournamentField: `PRIVATE_TOURNAMENT_${id}`
      };
      next.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
      next.qualifierRounds = [{
        id: `${id}-round`,
        index: 1,
        title: "1차 라운드",
        stagePlan: ["예선"],
        stages: [{
          id: `${id}-stage`,
          qualifierIndex: 1,
          stageIndex: 1,
          name: "예선",
          groups: [{
            id: `${id}-group`,
            name: "예선 1조",
            slots: [{
              id: rawPlayerId,
              name: `REAL_NAME_SECRET_${id}`,
              nickname: `Public ${id}`,
              team: "QA",
              lane: 1,
              realName: `REAL_NAME_FIELD_${id}`,
              contact: `CONTACT_SECRET_${id}`,
              privatePlayerField: `PRIVATE_PLAYER_${id}`
            }, {
              id: secondRawPlayerId,
              name: `SECOND_REAL_SECRET_${id}`,
              nickname: `Second ${id}`,
              team: "QB",
              lane: 2,
              realName: `SECOND_REAL_FIELD_${id}`,
              contact: `SECOND_CONTACT_SECRET_${id}`,
              privatePlayerField: `SECOND_PRIVATE_PLAYER_${id}`
            }],
            advanceIds: [rawPlayerId],
            points: {}
          }]
        }],
        finalist: null,
        crowFinalists: []
      }];
      next.updatedAt = updatedAt;
      return next;
    };

    const store = window.__qaFirebaseStore;
    const activeRegistryBackup = store.activeTournaments?.["qa-venue"]
      ? JSON.parse(JSON.stringify(store.activeTournaments["qa-venue"]))
      : undefined;
    const privateHistoryBackup = store.privateResultLogs?.["qa-venue"]
      ? JSON.parse(JSON.stringify(store.privateResultLogs["qa-venue"]))
      : undefined;
    const publicHistoryBackup = JSON.parse(JSON.stringify(store.publicHistory || {}));
    const serverInfoBackup = store[".info"] === undefined ? undefined : JSON.parse(JSON.stringify(store[".info"]));
    const serverClock = window.__mini4wdFirebaseServerClockV279;
    const serverClockOffsetBackup = Number(serverClock?.offset?.() || 0);
    const publisherOriginalDateNow = Date.now;
    store.tournaments[staleId] = { state: makePrivateState(staleId, staleAt), updatedAt: staleAt };
    store.tournaments[refreshedId] = { state: makePrivateState(refreshedId, staleAt + 1000), updatedAt: staleAt + 1000 };
    store.tournaments[legacyId] = makePrivateState(legacyId, staleAt + 500);
    store.tournaments[legacyId].tournament.venue = "";
    store.tournaments[legacyId].tournament.venueName = "Legacy QA Venue";
    store.tournaments[parentFreshId] = { state: makePrivateState(parentFreshId, staleAt + 600), updatedAt: Date.now() };
    window.__qaBeforeFirebaseTransaction = path => {
      if (path !== `tournaments/${refreshedId}`) return;
      const freshAt = Date.now();
      store.tournaments[refreshedId].state.updatedAt = freshAt;
      store.tournaments[refreshedId].updatedAt = freshAt;
    };

    try {
      await window.requestActiveTournamentListV135();
      const privateClosed = store.tournaments?.[staleId]?.state;
      const publicClosed = store.publicLive?.[staleId];
      const legacyClosed = store.tournaments?.[legacyId]?.state;
      const publicLegacy = store.publicLive?.[legacyId];
      const parentFreshState = store.tournaments?.[parentFreshId]?.state;
      const publicJson = JSON.stringify([publicClosed || {}, publicLegacy || {}]);
      const forbiddenKeys = new Set(["inputText", "lockedParticipants", "realName", "contact", "privateTournamentField", "privatePlayerField"]);
      const forbiddenKeyPaths = [];
      const visit = (value, path = "publicLive") => {
        if (!value || typeof value !== "object") return;
        Object.entries(value).forEach(([key, child]) => {
          const childPath = `${path}.${key}`;
          if (forbiddenKeys.has(key)) forbiddenKeyPaths.push(childPath);
          visit(child, childPath);
        });
      };
      visit(publicClosed);
      visit(publicLegacy, "publicLiveLegacy");
      const leakedTokens = [
        "PRIVATE_STALE_INPUT_", "PRIVATE_LOCKED_PARTICIPANTS_", "REAL_NAME_SECRET_",
        "REAL_NAME_FIELD_", "CONTACT_SECRET_", "PRIVATE_TOURNAMENT_", "PRIVATE_PLAYER_", "01012345678", "01087654321"
      ].filter(token => publicJson.includes(token));
      const requiredEnvelopePreserved = Boolean(
        publicClosed?.id === staleId
        && publicClosed?.status === "finished"
        && publicClosed?.live === false
        && publicClosed?.venueId === "qa-venue"
        && publicClosed?.venueName === "QA Venue"
        && publicClosed?.tournamentName === `Auto close ${staleId}`
        && publicClosed?.raceClass === "오픈"
        && publicClosed?.state?.tournament?.status === "finished"
        && Number(publicClosed?.updatedAt) > staleAt
      );
      const privateStatePreserved = Boolean(
        privateClosed?.tournament?.status === "finished"
        && privateClosed?.tournament?.autoClosePublishPending === false
        && privateClosed?.inputText === `PRIVATE_LOCKED_PARTICIPANTS_${staleId}`
        && privateClosed?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.slots?.[0]?.contact === `CONTACT_SECRET_${staleId}`
      );
      const autoCloseHistoryPublished = Boolean(
        store.privateResultLogs?.["qa-venue"]?.[staleId]?.id === staleId
        && store.privateResultLogs?.["qa-venue"]?.[staleId]?.sourceTournamentId === staleId
        && store.publicHistory?.[staleId]?.id === staleId
        && store.publicHistory?.[staleId]?.sourceTournamentId === staleId
      );
      const refreshed = store.tournaments?.[refreshedId]?.state;
      const freshTournamentNotClosed = Boolean(
        refreshed?.tournament?.status === "running"
        && Number(refreshed?.updatedAt) > staleAt
        && !store.publicLive?.[refreshedId]
      );
      const legacyFlatRecordClosed = Boolean(
        legacyClosed?.tournament?.status === "finished"
        && publicLegacy?.id === legacyId
        && publicLegacy?.venueName === "Legacy QA Venue"
        && publicLegacy?.liveKeyLabel?.startsWith("Legacy QA Venue ·")
        && publicLegacy?.state?.tournament?.status === "finished"
        && !publicJson.includes(`CONTACT_SECRET_${legacyId}`)
      );
      const parentTimestampNotClosed = Boolean(
        parentFreshState?.tournament?.status === "running"
        && !store.publicLive?.[parentFreshId]
      );

      window.__qaBeforeFirebaseTransaction = null;
      store.tournaments[rollbackId] = { state: makePrivateState(rollbackId, staleAt + 750), updatedAt: staleAt + 750 };
      store.activeTournaments["qa-venue"] = { venueId: "qa-venue", tournamentId: rollbackId, status: "running", updatedAt: staleAt + 750 };
      window.__qaRejectFirebaseTransactionPaths = [`publicLive/${rollbackId}`];
      await window.requestActiveTournamentListV135();
      window.__qaRejectFirebaseTransactionPaths = [];
      const pendingAfterPublicFailure = Boolean(
        store.tournaments?.[rollbackId]?.state?.tournament?.status === "finished"
        && store.tournaments?.[rollbackId]?.state?.tournament?.autoClosePublishPending === true
        && !store.publicLive?.[rollbackId]
      );
      const pendingRegistryPreservedBeforeRepair = store.activeTournaments?.["qa-venue"]?.tournamentId === rollbackId;
      store.tournaments[rollbackId].state.tournament.autoClosePublisherAt = 0;
      await window.requestActiveTournamentListV135();
      const rollbackState = store.tournaments?.[rollbackId]?.state;
      const publicFailureStayedRetryable = Boolean(
        pendingAfterPublicFailure
        && rollbackState?.tournament?.status === "finished"
        && rollbackState?.tournament?.autoClosePublishPending === false
        && store.publicLive?.[rollbackId]?.status === "finished"
      );
      if (store.activeTournaments?.["qa-venue"]?.tournamentId === rollbackId) delete store.activeTournaments["qa-venue"];

      const newerPublicAt = Date.now() + 60000;
      const staleFreshnessState = makePrivateState(freshnessId, staleAt + 800);
      // Both clients started from the same durable private aliases. The newer
      // writer carries them forward while changing public slot order/progress.
      makePublicStatePayload(staleFreshnessState);
      staleFreshnessState.tournament.activeRegistryGeneration = "freshness-generation";
      const newerPublicSource = normalizeImportedState(JSON.parse(JSON.stringify(staleFreshnessState)));
      newerPublicSource.tournament.status = "running";
      newerPublicSource.updatedAt = newerPublicAt;
      const freshnessRawPlayerId = `${freshnessId}-phone-01012345678`;
      const freshnessSecondRawPlayerId = `${freshnessId}-phone-01087654321`;
      const newerFreshnessGroup = newerPublicSource.qualifierRounds[0].stages[0].groups[0];
      newerFreshnessGroup.points[freshnessRawPlayerId] = 7;
      newerFreshnessGroup.points[freshnessSecondRawPlayerId] = 2;
      newerFreshnessGroup.advanceIds = [freshnessSecondRawPlayerId];
      newerFreshnessGroup.slots.reverse();
      newerFreshnessGroup.slots[0].lane = 1;
      newerFreshnessGroup.slots[1].lane = 2;
      newerPublicSource.tournament.activeRegistryGeneration = "freshness-generation";
      store.tournaments[freshnessId] = { state: staleFreshnessState, updatedAt: staleAt + 800 };
      store.activeTournaments["qa-venue"] = { venueId: "qa-venue", tournamentId: freshnessId, registryGeneration: "freshness-generation", status: "running", updatedAt: staleAt + 800 };
      store.publicLive[freshnessId] = {
        id: freshnessId,
        registryGeneration: "freshness-generation",
        status: "running",
        live: true,
        updatedAt: newerPublicAt,
        state: makePublicStatePayload(newerPublicSource)
      };
      await window.requestActiveTournamentListV135();
      await window.requestActiveTournamentListV135();
      const freshnessState = store.tournaments?.[freshnessId]?.state;
      const freshnessRejectedAndRolledBack = Boolean(
        freshnessState?.tournament?.status === "running"
        && Number(freshnessState?.updatedAt) === newerPublicAt
        && store.publicLive?.[freshnessId]?.status === "running"
        && Number(store.publicLive?.[freshnessId]?.updatedAt) === newerPublicAt
      );
      const autoCloseRollbackRegistryRestored = store.activeTournaments?.["qa-venue"]?.tournamentId === freshnessId;
      const freshnessGroup = freshnessState?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
      const freshnessPlayer = freshnessGroup?.slots?.find(player => player?.id === freshnessRawPlayerId);
      const freshnessSecondPlayer = freshnessGroup?.slots?.find(player => player?.id === freshnessSecondRawPlayerId);
      const autoCloseRollbackMergedNewerProgress = Boolean(
        freshnessGroup?.points?.[freshnessRawPlayerId] === 7
        && freshnessGroup?.points?.[freshnessSecondRawPlayerId] === 2
        && freshnessGroup?.advanceIds?.[0] === freshnessSecondRawPlayerId
        && freshnessGroup?.slots?.[0]?.id === freshnessSecondRawPlayerId
        && freshnessPlayer?.id === freshnessRawPlayerId
        && freshnessPlayer?.lane === 2
        && freshnessPlayer?.contact === `CONTACT_SECRET_${freshnessId}`
        && freshnessSecondPlayer?.lane === 1
        && freshnessSecondPlayer?.contact === `SECOND_CONTACT_SECRET_${freshnessId}`
        && freshnessState?.tournament?.activeRegistryGeneration === "freshness-generation"
        && !Object.keys(freshnessGroup?.points || {}).some(id => id.startsWith("pub-"))
      );

      delete store.tournaments[rollbackId];
      delete store.publicLive[rollbackId];
      delete store.tournaments[freshnessId];
      delete store.publicLive[freshnessId];
      if (store.activeTournaments?.["qa-venue"]?.tournamentId === freshnessId) delete store.activeTournaments["qa-venue"];
      store.tournaments[doubleFailureId] = { state: makePrivateState(doubleFailureId, staleAt + 900), updatedAt: staleAt + 900 };
      window.__qaBeforeFirebaseTransaction = path => {
        if (path === `publicLive/${doubleFailureId}`) {
          window.__qaRejectFirebaseTransactionPaths = [`publicLive/${doubleFailureId}`, `tournaments/${doubleFailureId}`];
        }
      };
      await window.requestActiveTournamentListV135();
      const pendingAfterDoubleFailure = Boolean(
        store.tournaments?.[doubleFailureId]?.state?.tournament?.status === "finished"
        && store.tournaments?.[doubleFailureId]?.state?.tournament?.autoClosePublishPending === true
        && !store.publicLive?.[doubleFailureId]
      );
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      store.tournaments[doubleFailureId].state.tournament.autoClosePublisherAt = 0;
      await window.requestActiveTournamentListV135();
      const repairedState = store.tournaments?.[doubleFailureId]?.state;
      const doubleFailureSelfHealed = Boolean(
        pendingAfterDoubleFailure
        && repairedState?.tournament?.status === "finished"
        && repairedState?.tournament?.autoClosePublishPending === false
        && store.publicLive?.[doubleFailureId]?.status === "finished"
        && store.publicLive?.[doubleFailureId]?.state?.tournament?.status === "finished"
      );

      delete store.tournaments[doubleFailureId];
      delete store.publicLive[doubleFailureId];
      store.tournaments[finalizeFailureId] = { state: makePrivateState(finalizeFailureId, staleAt + 925), updatedAt: staleAt + 925 };
      window.__qaBeforeFirebaseTransaction = path => {
        if (path === `publicLive/${finalizeFailureId}`) {
          window.__qaRejectFirebaseTransactionPaths = [`tournaments/${finalizeFailureId}`];
        }
      };
      await window.requestActiveTournamentListV135();
      const pendingAfterFinalizeFailure = Boolean(
        store.tournaments?.[finalizeFailureId]?.state?.tournament?.status === "finished"
        && store.tournaments?.[finalizeFailureId]?.state?.tournament?.autoClosePublishPending === true
        && store.publicLive?.[finalizeFailureId]?.status === "finished"
      );
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      store.tournaments[finalizeFailureId].state.tournament.autoClosePublisherAt = 0;
      await window.requestActiveTournamentListV135();
      const finalizeFailureState = store.tournaments?.[finalizeFailureId]?.state;
      const finalizeFailureSelfHealed = Boolean(
        pendingAfterFinalizeFailure
        && finalizeFailureState?.tournament?.status === "finished"
        && finalizeFailureState?.tournament?.autoClosePublishPending === false
        && store.publicLive?.[finalizeFailureId]?.status === "finished"
      );

      delete store.tournaments[finalizeFailureId];
      delete store.publicLive[finalizeFailureId];
      store.tournaments[concurrentId] = { state: makePrivateState(concurrentId, staleAt + 950), updatedAt: staleAt + 950 };
      window.__qaFirebaseTransactionCounts[`publicLive/${concurrentId}`] = 0;
      await Promise.all([
        window.requestActiveTournamentListV135(),
        window.requestActiveTournamentListV135()
      ]);
      const concurrentState = store.tournaments?.[concurrentId]?.state;
      const concurrentPublisherLeaseHeld = Boolean(
        concurrentState?.tournament?.status === "finished"
        && concurrentState?.tournament?.autoClosePublishPending === false
        && store.publicLive?.[concurrentId]?.status === "finished"
        && Number(window.__qaFirebaseTransactionCounts[`publicLive/${concurrentId}`] || 0) === 1
      );

      const divergentFinishRecordId = `record-${divergentFinishId}`;
      const divergentFinishState = makePrivateState(divergentFinishId, staleAt + 960);
      divergentFinishState.tournament.status = "finished";
      divergentFinishState.tournament.activeRegistryGeneration = "divergent-finish-generation";
      divergentFinishState.tournament.endedAtISO = "2026-08-22T01:00:00.000Z";
      divergentFinishState.tournament.finishSyncPending = true;
      divergentFinishState.tournament.finishSyncTerminalUpdatedAt = staleAt + 960;
      divergentFinishState.tournament.finishSyncRecord = {
        id: divergentFinishRecordId,
        venueId: "qa-venue",
        tournamentName: "Divergent private finish"
      };
      store.tournaments[divergentFinishId] = { state: divergentFinishState, updatedAt: divergentFinishState.updatedAt };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: divergentFinishId,
        registryGeneration: "divergent-finish-generation",
        status: "running",
        updatedAt: staleAt + 960
      };
      const divergentFinishPublicSource = normalizeImportedState(JSON.parse(JSON.stringify(divergentFinishState)));
      divergentFinishPublicSource.tournament.endedAtISO = "2026-08-22T01:00:01.000Z";
      divergentFinishPublicSource.tournament.finishSyncPending = false;
      divergentFinishPublicSource.updatedAt = staleAt + 961;
      store.publicLive[divergentFinishId] = makePublicLivePayload(divergentFinishPublicSource);
      await window.requestActiveTournamentListV135();
      await new Promise(resolve => setTimeout(resolve, 30));
      const divergentFinishRetired = store.tournaments?.[divergentFinishId]?.state;
      const divergentFinishStoppedRetrying = Boolean(
        divergentFinishRetired?.tournament?.status === "finished"
        && divergentFinishRetired?.tournament?.finishSyncPending === false
        && divergentFinishRetired?.tournament?.terminalSyncConflictV278?.reason === "divergent-terminal-public"
        && divergentFinishRetired?.tournament?.terminalSyncConflictV278?.publicAttemptId === "ended:2026-08-22T01:00:01.000Z"
        && store.publicLive?.[divergentFinishId]?.state?.tournament?.endedAtISO === "2026-08-22T01:00:01.000Z"
        && !store.privateResultLogs?.["qa-venue"]?.[divergentFinishRecordId]
        && !store.publicHistory?.[divergentFinishRecordId]
      );

      const divergentAutoRecordId = `record-${divergentAutoId}`;
      const divergentAutoState = makePrivateState(divergentAutoId, staleAt + 970);
      divergentAutoState.tournament.status = "finished";
      divergentAutoState.tournament.activeRegistryGeneration = "divergent-auto-generation";
      divergentAutoState.tournament.endedAtISO = "2026-08-22T02:00:00.000Z";
      divergentAutoState.tournament.autoClosed = true;
      divergentAutoState.tournament.autoCloseAttemptId = "divergent-auto-private-attempt";
      divergentAutoState.tournament.autoClosePublishPending = true;
      divergentAutoState.tournament.autoClosePreviousUpdatedAt = staleAt + 970;
      divergentAutoState.tournament.recordId = divergentAutoRecordId;
      store.tournaments[divergentAutoId] = { state: divergentAutoState, updatedAt: divergentAutoState.updatedAt };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: divergentAutoId,
        registryGeneration: "divergent-auto-generation",
        status: "running",
        updatedAt: staleAt + 970
      };
      const divergentAutoPublicSource = normalizeImportedState(JSON.parse(JSON.stringify(divergentAutoState)));
      divergentAutoPublicSource.tournament.endedAtISO = "2026-08-22T02:00:01.000Z";
      divergentAutoPublicSource.tournament.autoClosePublishPending = false;
      divergentAutoPublicSource.updatedAt = staleAt + 971;
      store.publicLive[divergentAutoId] = makePublicLivePayload(divergentAutoPublicSource);
      await window.requestActiveTournamentListV135();
      await new Promise(resolve => setTimeout(resolve, 30));
      const divergentAutoRetired = store.tournaments?.[divergentAutoId]?.state;
      const divergentAutoStoppedRetrying = Boolean(
        divergentAutoRetired?.tournament?.status === "finished"
        && divergentAutoRetired?.tournament?.autoClosePublishPending === false
        && divergentAutoRetired?.tournament?.terminalSyncConflictV278?.reason === "divergent-terminal-public"
        && divergentAutoRetired?.tournament?.terminalSyncConflictV278?.publicAttemptId === "ended:2026-08-22T02:00:01.000Z"
        && store.publicLive?.[divergentAutoId]?.state?.tournament?.endedAtISO === "2026-08-22T02:00:01.000Z"
        && !store.privateResultLogs?.["qa-venue"]?.[divergentAutoRecordId]
        && !store.publicHistory?.[divergentAutoRecordId]
      );
      const divergentTerminalConflictsRetired = divergentFinishStoppedRetrying && divergentAutoStoppedRetrying;

      const finishConflictBaseState = makePrivateState(finishConflictId, staleAt + 975);
      makePublicStatePayload(finishConflictBaseState);
      const finishConflictState = normalizeImportedState(JSON.parse(JSON.stringify(finishConflictBaseState)));
      finishConflictState.tournament.status = "finished";
      finishConflictState.tournament.endedAtISO = new Date(staleAt + 975).toISOString();
      finishConflictState.tournament.finishSyncPending = true;
      finishConflictState.tournament.finishSyncPreviousUpdatedAt = staleAt + 975;
      finishConflictState.tournament.finishSyncPreviousEndedAtISO = "";
      finishConflictState.tournament.finishSyncPreviousEndedAtDisplay = "";
      finishConflictState.tournament.finishSyncPreviousLiveStopped = false;
      finishConflictState.tournament.finishSyncPreviousFirebaseAutoSave = true;
      finishConflictState.tournament.activeRegistryGeneration = "finish-generation";
      store.tournaments[finishConflictId] = { state: finishConflictState, updatedAt: staleAt + 975 };
      const newerRunningAt = Date.now() + 60000;
      const newerFinishPublicSource = normalizeImportedState(JSON.parse(JSON.stringify(finishConflictBaseState)));
      newerFinishPublicSource.tournament.status = "running";
      newerFinishPublicSource.updatedAt = newerRunningAt;
      const finishRawPlayerId = `${finishConflictId}-phone-01012345678`;
      const finishSecondRawPlayerId = `${finishConflictId}-phone-01087654321`;
      const newerFinishGroup = newerFinishPublicSource.qualifierRounds[0].stages[0].groups[0];
      newerFinishGroup.points[finishRawPlayerId] = 9;
      newerFinishGroup.points[finishSecondRawPlayerId] = 4;
      newerFinishGroup.advanceIds = [finishSecondRawPlayerId];
      newerFinishGroup.slots.reverse();
      newerFinishGroup.slots[0].lane = 1;
      newerFinishGroup.slots[1].lane = 3;
      newerFinishPublicSource.tournament.activeRegistryGeneration = "finish-generation";
      store.publicLive[finishConflictId] = {
        id: finishConflictId,
        registryGeneration: "finish-generation",
        status: "running",
        live: true,
        updatedAt: newerRunningAt,
        state: makePublicStatePayload(newerFinishPublicSource)
      };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: finishConflictId,
        registryGeneration: "finish-generation",
        status: "running",
        updatedAt: staleAt + 975
      };
      const pendingCleanupResult = await window.cleanupActiveTournamentForVenueV151("qa-venue");
      const finishPendingRegistryPreserved = Boolean(
        pendingCleanupResult?.removed === false
        && pendingCleanupResult?.reason === "terminal-sync-pending"
        && store.activeTournaments?.["qa-venue"]?.tournamentId === finishConflictId
      );
      await window.requestActiveTournamentListV135();
      await window.requestActiveTournamentListV135();
      const finishConflictPrivate = store.tournaments?.[finishConflictId]?.state;
      const finishPendingHonorsNewerRunning = Boolean(
        finishConflictPrivate?.tournament?.status === "running"
        && finishConflictPrivate?.tournament?.finishSyncPending !== true
        && Number(finishConflictPrivate?.updatedAt) === newerRunningAt
        && store.publicLive?.[finishConflictId]?.status === "running"
        && Number(store.publicLive?.[finishConflictId]?.updatedAt) === newerRunningAt
        && store.activeTournaments?.["qa-venue"]?.tournamentId === finishConflictId
      );
      const finishConflictGroup = finishConflictPrivate?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
      const finishConflictPlayer = finishConflictGroup?.slots?.find(player => player?.id === finishRawPlayerId);
      const finishConflictSecondPlayer = finishConflictGroup?.slots?.find(player => player?.id === finishSecondRawPlayerId);
      const finishRollbackMergedNewerProgress = Boolean(
        finishConflictGroup?.points?.[finishRawPlayerId] === 9
        && finishConflictGroup?.points?.[finishSecondRawPlayerId] === 4
        && finishConflictGroup?.advanceIds?.[0] === finishSecondRawPlayerId
        && finishConflictGroup?.slots?.[0]?.id === finishSecondRawPlayerId
        && finishConflictPlayer?.id === finishRawPlayerId
        && finishConflictPlayer?.lane === 3
        && finishConflictPlayer?.contact === `CONTACT_SECRET_${finishConflictId}`
        && finishConflictSecondPlayer?.lane === 1
        && finishConflictSecondPlayer?.contact === `SECOND_CONTACT_SECRET_${finishConflictId}`
        && finishConflictPrivate?.tournament?.activeRegistryGeneration === "finish-generation"
        && !Object.keys(finishConflictGroup?.points || {}).some(id => id.startsWith("pub-"))
      );

      const generationPendingState = makePrivateState(generationConflictId, staleAt + 978);
      generationPendingState.tournament.status = "finished";
      generationPendingState.tournament.finishSyncPending = true;
      generationPendingState.tournament.finishSyncPreviousUpdatedAt = staleAt + 978;
      generationPendingState.tournament.finishSyncPreviousEndedAtISO = "";
      generationPendingState.tournament.finishSyncPreviousEndedAtDisplay = "";
      generationPendingState.tournament.finishSyncPreviousLiveStopped = false;
      generationPendingState.tournament.finishSyncPreviousFirebaseAutoSave = true;
      generationPendingState.tournament.activeRegistryGeneration = "generation-a";
      store.tournaments[generationConflictId] = { state: generationPendingState, updatedAt: staleAt + 978 };
      const generationPublicAt = Date.now() + 70000;
      const generationPublicSource = makePrivateState(generationConflictId, generationPublicAt);
      generationPublicSource.tournament.activeRegistryGeneration = "generation-a";
      store.publicLive[generationConflictId] = {
        id: generationConflictId,
        registryGeneration: "generation-a",
        status: "running",
        live: true,
        updatedAt: generationPublicAt,
        state: makePublicStatePayload(generationPublicSource)
      };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: generationConflictId,
        registryGeneration: "generation-b",
        status: "running",
        updatedAt: generationPublicAt
      };
      await window.requestActiveTournamentListV135();
      const generationConflictProtected = Boolean(
        store.tournaments?.[generationConflictId]?.state?.tournament?.status === "finished"
        && store.tournaments?.[generationConflictId]?.state?.tournament?.finishSyncPending === true
        && store.publicLive?.[generationConflictId]?.status === "running"
        && store.publicLive?.[generationConflictId]?.registryGeneration === "generation-a"
        && store.activeTournaments?.["qa-venue"]?.registryGeneration === "generation-b"
      );

      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: registryReleaseRaceId,
        registryGeneration: "release-a",
        status: "running",
        updatedAt: Date.now()
      };
      window.__qaBeforeFirebaseTransaction = path => {
        if (path !== "activeTournaments/qa-venue") return;
        window.__qaBeforeFirebaseTransaction = null;
        store.activeTournaments["qa-venue"] = {
          venueId: "qa-venue",
          tournamentId: registryReleaseRaceId,
          registryGeneration: "release-b",
          status: "running",
          updatedAt: Date.now() + 1
        };
      };
      releaseActiveTournamentForVenue("finished-clear", registryReleaseRaceId, "release-a", "qa-venue");
      await new Promise(resolve => setTimeout(resolve, 0));
      const oldGenerationReleasePreservedNewClaim = store.activeTournaments?.["qa-venue"]?.registryGeneration === "release-b";
      releaseActiveTournamentForVenue("finished-clear", registryReleaseRaceId, "", "qa-venue");
      await new Promise(resolve => setTimeout(resolve, 0));
      const legacyReleasePreservedTokenizedClaim = store.activeTournaments?.["qa-venue"]?.registryGeneration === "release-b";
      releaseActiveTournamentForVenue("finished-clear", registryReleaseRaceId, "release-b", "qa-venue");
      await new Promise(resolve => setTimeout(resolve, 0));
      const matchingGenerationReleaseSucceeded = !store.activeTournaments?.["qa-venue"];

      const cleanupOldState = makePrivateState(cleanupRaceOldId, Date.now());
      cleanupOldState.tournament.status = "finished";
      cleanupOldState.tournament.activeRegistryGeneration = "cleanup-old";
      store.tournaments[cleanupRaceOldId] = { state: cleanupOldState, updatedAt: cleanupOldState.updatedAt };
      const cleanupNewState = makePrivateState(cleanupRaceNewId, Date.now() + 1);
      cleanupNewState.tournament.activeRegistryGeneration = "cleanup-new";
      store.tournaments[cleanupRaceNewId] = { state: cleanupNewState, updatedAt: cleanupNewState.updatedAt };
      store.publicLive[cleanupRaceNewId] = {
        id: cleanupRaceNewId,
        registryGeneration: "cleanup-new",
        status: "running",
        live: true,
        updatedAt: cleanupNewState.updatedAt,
        state: makePublicStatePayload(cleanupNewState)
      };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: cleanupRaceOldId,
        registryGeneration: "cleanup-old",
        status: "running",
        updatedAt: cleanupOldState.updatedAt
      };
      window.__qaBeforeFirebaseTransaction = path => {
        if (path !== "activeTournaments/qa-venue") return;
        window.__qaBeforeFirebaseTransaction = null;
        store.activeTournaments["qa-venue"] = {
          venueId: "qa-venue",
          tournamentId: cleanupRaceNewId,
          registryGeneration: "cleanup-new",
          status: "running",
          updatedAt: cleanupNewState.updatedAt
        };
      };
      const cleanupRaceResult = await window.cleanupActiveTournamentForVenueV151("qa-venue");
      const activeCleanupRacePreservedNewClaim = Boolean(
        cleanupRaceResult?.removed === false
        && cleanupRaceResult?.reason === "active-registry-changed"
        && store.activeTournaments?.["qa-venue"]?.tournamentId === cleanupRaceNewId
        && store.activeTournaments?.["qa-venue"]?.registryGeneration === "cleanup-new"
      );

      const competingAt = Date.now();
      const competingState = makePrivateState(competingActiveId, competingAt);
      store.tournaments[competingActiveId] = { state: competingState, updatedAt: competingAt };
      store.publicLive[competingActiveId] = {
        id: competingActiveId,
        status: "running",
        live: true,
        updatedAt: competingAt,
        state: { tournament: { status: "running" }, updatedAt: competingAt }
      };
      store.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: competingActiveId,
        status: "running",
        updatedAt: competingAt
      };

      const supersededFinishState = makePrivateState(supersededFinishId, staleAt + 980);
      supersededFinishState.tournament.status = "finished";
      supersededFinishState.tournament.finishSyncPending = true;
      supersededFinishState.tournament.finishSyncPreviousUpdatedAt = staleAt + 980;
      supersededFinishState.tournament.finishSyncPreviousEndedAtISO = "";
      supersededFinishState.tournament.finishSyncPreviousEndedAtDisplay = "";
      supersededFinishState.tournament.finishSyncPreviousLiveStopped = false;
      supersededFinishState.tournament.finishSyncPreviousFirebaseAutoSave = true;
      store.tournaments[supersededFinishId] = { state: supersededFinishState, updatedAt: staleAt + 980 };
      const supersededFinishPublicAt = competingAt + 60000;
      store.publicLive[supersededFinishId] = {
        id: supersededFinishId,
        status: "running",
        live: true,
        updatedAt: supersededFinishPublicAt,
        state: { tournament: { status: "running" }, updatedAt: supersededFinishPublicAt }
      };
      await window.requestActiveTournamentListV135();
      const supersededFinishPrivate = store.tournaments?.[supersededFinishId]?.state;
      const registryConflictConverged = Boolean(
        supersededFinishPrivate?.tournament?.status === "finished"
        && supersededFinishPrivate?.tournament?.finishSyncPending !== true
        && !store.publicLive?.[supersededFinishId]
        && store.tournaments?.[competingActiveId]?.state?.tournament?.status === "running"
        && store.publicLive?.[competingActiveId]?.status === "running"
        && store.activeTournaments?.["qa-venue"]?.tournamentId === competingActiveId
      );

      store.tournaments[supersededAutoId] = {
        state: makePrivateState(supersededAutoId, staleAt + 990),
        updatedAt: staleAt + 990
      };
      const supersededAutoPublicAt = competingAt + 120000;
      store.publicLive[supersededAutoId] = {
        id: supersededAutoId,
        status: "running",
        live: true,
        updatedAt: supersededAutoPublicAt,
        state: { tournament: { status: "running" }, updatedAt: supersededAutoPublicAt }
      };
      await window.requestActiveTournamentListV135();
      const supersededAutoPrivate = store.tournaments?.[supersededAutoId]?.state;
      const autoCloseRegistryConflictConverged = Boolean(
        supersededAutoPrivate?.tournament?.status === "finished"
        && supersededAutoPrivate?.tournament?.autoClosePublishPending === false
        && !store.publicLive?.[supersededAutoId]
        && store.tournaments?.[competingActiveId]?.state?.tournament?.status === "running"
        && store.publicLive?.[competingActiveId]?.status === "running"
        && store.activeTournaments?.["qa-venue"]?.tournamentId === competingActiveId
      );

      const localStateBeforeTwoPhase = exportState();
      const localRoundBeforeTwoPhase = activeRoundIndex;
      const localFirebaseIdBeforeTwoPhase = firebaseTournamentId;
      const twoPhaseStorageKeys = ["mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature", "mini4wdActiveLiveDate"];
      const twoPhaseStorageBefore = Object.fromEntries(twoPhaseStorageKeys.map(key => [key, localStorage.getItem(key)]));
      const makeTwoPhaseFixture = (id, generation, at) => {
        const fixture = makePrivateState(id, at);
        fixture.tournament.activeRegistryGeneration = generation;
        makePublicStatePayload(fixture);
        return fixture;
      };
      const db = initFirebase();
      const twoPhaseGeneration = "two-phase-generation";
      const twoPhaseAttempted = makeTwoPhaseFixture(twoPhaseId, twoPhaseGeneration, Date.now() + 1000);
      const twoPhaseOlder = normalizeImportedState(JSON.parse(JSON.stringify(twoPhaseAttempted)));
      twoPhaseOlder.updatedAt = twoPhaseAttempted.updatedAt - 1000;
      const twoPhaseNewer = normalizeImportedState(JSON.parse(JSON.stringify(twoPhaseAttempted)));
      twoPhaseNewer.tournament.name = "QA newer public progression";
      twoPhaseNewer.updatedAt = twoPhaseAttempted.updatedAt + 1000;
      const twoPhaseRawA = `${twoPhaseId}-phone-01012345678`;
      const twoPhaseGroup = twoPhaseNewer.qualifierRounds[0].stages[0].groups[0];
      twoPhaseGroup.points[twoPhaseRawA] = 11;
      twoPhaseGroup.advanceIds = [twoPhaseRawA];
      store.tournaments[twoPhaseId] = { state: JSON.parse(JSON.stringify(twoPhaseOlder)), updatedAt: twoPhaseOlder.updatedAt };
      store.publicLive[twoPhaseId] = makePublicLivePayload(twoPhaseNewer);
      state = normalizeImportedState(JSON.parse(JSON.stringify(twoPhaseAttempted)));
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = twoPhaseId;
      localStorage.setItem("mini4wdTournamentId", twoPhaseId);
      localStorage.setItem("mini4wdActiveLiveId", twoPhaseId);
      try {
        await writePrivateThenPublicLiveV278(db, twoPhaseId, twoPhaseAttempted, makePublicLivePayload(twoPhaseAttempted), "qa-two-phase-reconcile-v278");
      } catch (error) {}
      const twoPhasePrivateAfter = store.tournaments?.[twoPhaseId]?.state;
      const twoPhasePrivateGroup = twoPhasePrivateAfter?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
      const privatePublicFreshnessRejectReconciled = Boolean(
        twoPhasePrivateAfter?.tournament?.name === "QA newer public progression"
        && Number(twoPhasePrivateAfter?.updatedAt) === Number(twoPhaseNewer.updatedAt)
        && twoPhasePrivateGroup?.points?.[twoPhaseRawA] === 11
        && twoPhasePrivateGroup?.slots?.find(player => player?.id === twoPhaseRawA)?.contact === `CONTACT_SECRET_${twoPhaseId}`
        && state.tournament?.name === "QA newer public progression"
        && Number(state.updatedAt) === Number(twoPhaseNewer.updatedAt)
      );

      const raceGeneration = "two-phase-race-generation";
      const raceAttempted = makeTwoPhaseFixture(twoPhaseRaceId, raceGeneration, Date.now() + 4000);
      const raceOlder = normalizeImportedState(JSON.parse(JSON.stringify(raceAttempted)));
      raceOlder.updatedAt = raceAttempted.updatedAt - 1000;
      const raceRejectedPublic = normalizeImportedState(JSON.parse(JSON.stringify(raceAttempted)));
      raceRejectedPublic.tournament.name = "QA rejected public T2";
      raceRejectedPublic.updatedAt = raceAttempted.updatedAt + 1000;
      const raceConcurrent = normalizeImportedState(JSON.parse(JSON.stringify(raceAttempted)));
      raceConcurrent.tournament.name = "QA concurrent private T3";
      raceConcurrent.updatedAt = raceAttempted.updatedAt + 2000;
      raceConcurrent.liveSyncAttemptIdV278 = "qa-other-writer-token";
      const raceRawA = `${twoPhaseRaceId}-phone-01012345678`;
      raceConcurrent.qualifierRounds[0].stages[0].groups[0].points[raceRawA] = 23;
      store.tournaments[twoPhaseRaceId] = { state: JSON.parse(JSON.stringify(raceOlder)), updatedAt: raceOlder.updatedAt };
      store.publicLive[twoPhaseRaceId] = makePublicLivePayload(raceRejectedPublic);
      state = normalizeImportedState(JSON.parse(JSON.stringify(raceAttempted)));
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = twoPhaseRaceId;
      localStorage.setItem("mini4wdTournamentId", twoPhaseRaceId);
      localStorage.setItem("mini4wdActiveLiveId", twoPhaseRaceId);
      window.__qaFirebaseTransactionCounts[`tournaments/${twoPhaseRaceId}`] = 0;
      window.__qaBeforeFirebaseTransaction = path => {
        if (path !== `tournaments/${twoPhaseRaceId}`) return;
        if (Number(window.__qaFirebaseTransactionCounts[path] || 0) !== 2) return;
        store.tournaments[twoPhaseRaceId] = {
          state: JSON.parse(JSON.stringify(raceConcurrent)),
          updatedAt: raceConcurrent.updatedAt
        };
        store.publicLive[twoPhaseRaceId] = makePublicLivePayload(raceConcurrent);
      };
      try {
        await writePrivateThenPublicLiveV278(db, twoPhaseRaceId, raceAttempted, makePublicLivePayload(raceAttempted), "qa-two-phase-cas-v278");
      } catch (error) {}
      window.__qaBeforeFirebaseTransaction = null;
      const racePrivateAfter = store.tournaments?.[twoPhaseRaceId]?.state;
      const racePublicAfter = store.publicLive?.[twoPhaseRaceId];
      const privatePublicCompensationCasPreservedConcurrentWrite = Boolean(
        racePrivateAfter?.tournament?.name === "QA concurrent private T3"
        && Number(racePrivateAfter?.updatedAt) === Number(raceConcurrent.updatedAt)
        && racePrivateAfter?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points?.[raceRawA] === 23
        && racePublicAfter?.tournamentName === "QA concurrent private T3"
        && Number(racePublicAfter?.updatedAt) === Number(raceConcurrent.updatedAt)
        && state.tournament?.name === "QA concurrent private T3"
      );
      state = normalizeImportedState(localStateBeforeTwoPhase);
      activeRoundIndex = localRoundBeforeTwoPhase;
      state.activeRoundIndex = activeRoundIndex;
      firebaseTournamentId = localFirebaseIdBeforeTwoPhase;
      twoPhaseStorageKeys.forEach(key => {
        const value = twoPhaseStorageBefore[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });

      const legacyMapId = "qa-legacy-pub-reorder-v278";
      const legacyPrivate = makePrivateState(legacyMapId, staleAt + 995);
      delete legacyPrivate.tournament.publicParticipantAliases;
      const legacyRawA = `${legacyMapId}-phone-01012345678`;
      const legacyRawB = `${legacyMapId}-phone-01087654321`;
      const legacyPublicState = makePublicStatePayload(legacyPrivate);
      const legacyPublicGroup = legacyPublicState.qualifierRounds[0].stages[0].groups[0];
      legacyPublicGroup.slots = [
        { id: "pub-1", name: `Second ${legacyMapId}`, nickname: `Second ${legacyMapId}`, team: "QB", lane: 1 },
        { id: "pub-2", name: `Public ${legacyMapId}`, nickname: `Public ${legacyMapId}`, team: "QA", lane: 2 }
      ];
      legacyPublicGroup.points = { "pub-1": 5, "pub-2": 9 };
      legacyPublicGroup.advanceIds = ["pub-2"];
      legacyPublicState.updatedAt = Date.now() + 180000;
      const legacyMerged = window.__mini4wdMergeNewerPublicRunningStateV278(legacyPrivate, {
        id: legacyMapId,
        status: "running",
        live: true,
        updatedAt: legacyPublicState.updatedAt,
        state: legacyPublicState
      });
      const legacyMergedGroup = legacyMerged.qualifierRounds[0].stages[0].groups[0];
      const legacyPubReorderMappedByIdentity = Boolean(
        legacyMergedGroup.slots[0]?.id === legacyRawB
        && legacyMergedGroup.slots[0]?.contact === `SECOND_CONTACT_SECRET_${legacyMapId}`
        && legacyMergedGroup.slots[1]?.id === legacyRawA
        && legacyMergedGroup.slots[1]?.contact === `CONTACT_SECRET_${legacyMapId}`
        && legacyMergedGroup.points?.[legacyRawB] === 5
        && legacyMergedGroup.points?.[legacyRawA] === 9
        && legacyMergedGroup.advanceIds?.[0] === legacyRawA
      );

      const ambiguousPrivate = makePrivateState("qa-legacy-pub-ambiguous-v278", staleAt + 996);
      delete ambiguousPrivate.tournament.publicParticipantAliases;
      ambiguousPrivate.qualifierRounds[0].stages[0].groups[0].slots.forEach(player => {
        player.nickname = "Twin";
        player.team = "Same";
      });
      const ambiguousPublicState = makePublicStatePayload(ambiguousPrivate);
      const ambiguousPublicGroup = ambiguousPublicState.qualifierRounds[0].stages[0].groups[0];
      ambiguousPublicGroup.slots = [
        { id: "pub-2", name: "Twin", nickname: "Twin", team: "Same", lane: 1 },
        { id: "pub-1", name: "Twin", nickname: "Twin", team: "Same", lane: 2 }
      ];
      ambiguousPublicGroup.points = { "pub-1": 3, "pub-2": 7 };
      ambiguousPublicGroup.advanceIds = ["pub-2"];
      ambiguousPublicState.updatedAt = Date.now() + 180001;
      const ambiguousMerged = window.__mini4wdMergeNewerPublicRunningStateV278(ambiguousPrivate, {
        id: "qa-legacy-pub-ambiguous-v278",
        status: "running",
        live: true,
        updatedAt: ambiguousPublicState.updatedAt,
        state: ambiguousPublicState
      });
      const ambiguousMergedGroup = ambiguousMerged.qualifierRounds[0].stages[0].groups[0];
      const legacyPubAmbiguousStayedOpaque = Boolean(
        ambiguousMergedGroup.slots.map(player => player?.id).join(",") === "pub-2,pub-1"
        && ambiguousMergedGroup.slots.every(player => !player?.contact && !player?.realName)
        && Object.keys(ambiguousMergedGroup.points || {}).sort().join(",") === "pub-1,pub-2"
        && ambiguousMergedGroup.advanceIds?.[0] === "pub-2"
      );

      let autoClosePublisherClockRefetched = false;
      let futureAutoPublisherClaimReplaced = false;
      let strictNumericUpdatedAtWonOverFutureStartedAt = false;
      let publisherClockDebug = {};
      try {
        const publisherClientBase = publisherOriginalDateNow();
        const rollbackClientNow = publisherClientBase - 120000;
        const publisherServerOffset = 240000;
        const foreignPublisherAt = publisherClientBase + 60000;
        const foreignPublisherToken = "qa-foreign-future-auto-publisher-v279";
        const futureGeneration = "qa-future-auto-publisher-generation-v279";
        const futurePending = makePrivateState(futurePublisherAutoId, publisherClientBase - (61 * 60 * 1000));
        futurePending.tournament = {
          ...futurePending.tournament,
          status: "finished",
          activeRegistryGeneration: futureGeneration,
          endedAtISO: new Date(publisherClientBase - 1000).toISOString(),
          endedAtDisplay: formatDateTimeLocal(new Date(publisherClientBase - 1000)),
          liveStopped: true,
          autoClosed: true,
          autoCloseReason: "qa future publisher retry v279",
          autoClosedAt: new Date(publisherClientBase - 1000).toISOString(),
          autoCloseAttemptId: "qa-future-auto-attempt-v279",
          recordId: "record-qa-future-auto-attempt-v279",
          autoClosePublishPending: true,
          autoClosePreviousUpdatedAt: publisherClientBase - (61 * 60 * 1000),
          autoClosePreviousEndedAtISO: "",
          autoClosePreviousEndedAtDisplay: "",
          autoClosePreviousLiveStopped: false,
          autoClosePublisherToken: foreignPublisherToken,
          autoClosePublisherAt: foreignPublisherAt
        };
        futurePending.updatedAt = publisherClientBase - 1000;
        store.tournaments[futurePublisherAutoId] = {
          protocolVersion: 279,
          venueId: "qa-venue",
          registryGeneration: futureGeneration,
          status: "finished",
          state: futurePending,
          updatedAt: futurePending.updatedAt
        };
        delete store.publicLive[futurePublisherAutoId];
        store.activeTournaments["qa-venue"] = {
          protocolVersion: 279,
          venueId: "qa-venue",
          venueName: "QA Venue",
          uid: "qa-uid",
          tournamentId: futurePublisherAutoId,
          registryGeneration: futureGeneration,
          tournamentName: futurePending.tournament.name,
          status: "running",
          fenceToken: "qa-future-auto-fence-v279",
          fenceSequence: 1501,
          updatedAt: publisherClientBase - 1000
        };

        const numericGeneration = "qa-strict-numeric-generation-v279";
        const authoritativeNumericAt = publisherClientBase - (61 * 60 * 1000);
        const futureStartedAt = new Date(publisherClientBase + (24 * 60 * 60 * 1000)).toISOString();
        const strictNumeric = makePrivateState(strictNumericAutoId, authoritativeNumericAt);
        strictNumeric.tournament = {
          ...strictNumeric.tournament,
          activeRegistryGeneration: numericGeneration,
          startedAtISO: futureStartedAt
        };
        strictNumeric.updatedAt = authoritativeNumericAt;
        store.tournaments[strictNumericAutoId] = {
          protocolVersion: 279,
          venueId: "qa-venue",
          registryGeneration: numericGeneration,
          status: "running",
          state: strictNumeric,
          updatedAt: authoritativeNumericAt
        };
        delete store.publicLive[strictNumericAutoId];

        let futureClaimAtPublic = null;
        let numericPreviousAtPublic = 0;
        window.__qaBeforeFirebaseTransaction = path => {
          if (path === `publicLive/${futurePublisherAutoId}`) {
            const pending = store.tournaments?.[futurePublisherAutoId]?.state || store.tournaments?.[futurePublisherAutoId];
            futureClaimAtPublic = {
              token: String(pending?.tournament?.autoClosePublisherToken || ""),
              at: Number(pending?.tournament?.autoClosePublisherAt || 0)
            };
          }
          if (path === `publicLive/${strictNumericAutoId}`) {
            const pending = store.tournaments?.[strictNumericAutoId]?.state || store.tournaments?.[strictNumericAutoId];
            numericPreviousAtPublic = Number(pending?.tournament?.autoClosePreviousUpdatedAt || 0);
          }
        };
        store[".info"] = { ...(store[".info"] || {}), serverTimeOffset: publisherServerOffset };
        Date.now = () => rollbackClientNow;
        await window.requestActiveTournamentListV135();
        window.__qaBeforeFirebaseTransaction = null;
        autoClosePublisherClockRefetched = Boolean(
          serverClock
          && Number(serverClock.offset()) === publisherServerOffset
        );
        const futureFinal = store.tournaments?.[futurePublisherAutoId]?.state || store.tournaments?.[futurePublisherAutoId];
        const futurePublic = store.publicLive?.[futurePublisherAutoId];
        futureAutoPublisherClaimReplaced = Boolean(
          futureClaimAtPublic?.token
          && futureClaimAtPublic.token !== foreignPublisherToken
          && futureClaimAtPublic.at >= foreignPublisherAt
          && futureFinal?.tournament?.status === "finished"
          && futureFinal?.tournament?.autoClosePublishPending === false
          && !futureFinal?.tournament?.autoClosePublisherToken
          && !futureFinal?.tournament?.autoClosePublisherAt
          && futurePublic?.status === "finished"
          && futurePublic?.live === false
        );
        const numericFinal = store.tournaments?.[strictNumericAutoId]?.state || store.tournaments?.[strictNumericAutoId];
        const numericPublic = store.publicLive?.[strictNumericAutoId];
        strictNumericUpdatedAtWonOverFutureStartedAt = Boolean(
          Date.parse(futureStartedAt) > publisherClientBase
          && numericPreviousAtPublic === authoritativeNumericAt
          && numericFinal?.tournament?.status === "finished"
          && numericFinal?.tournament?.autoClosePublishPending === false
          && numericFinal?.tournament?.startedAtISO === futureStartedAt
          && numericPublic?.status === "finished"
          && numericPublic?.live === false
        );
        publisherClockDebug = {
          publisherServerOffset,
          loadedOffset: Number(serverClock?.offset?.() || 0),
          foreignPublisherAt,
          futureClaimAtPublic,
          futurePending: Boolean(futureFinal?.tournament?.autoClosePublishPending),
          futurePublicStatus: futurePublic?.status || "",
          authoritativeNumericAt,
          numericPreviousAtPublic,
          numericStatus: numericFinal?.tournament?.status || "",
          numericPublicStatus: numericPublic?.status || ""
        };
      } finally {
        Date.now = publisherOriginalDateNow;
        window.__qaBeforeFirebaseTransaction = null;
        if (serverClock) {
          store[".info"] = { ...(store[".info"] || {}), serverTimeOffset: serverClockOffsetBackup };
          await serverClock.refresh(true);
        }
        if (serverInfoBackup === undefined) delete store[".info"];
        else store[".info"] = JSON.parse(JSON.stringify(serverInfoBackup));
      }
      return {
        forbiddenKeyPaths,
        leakedTokens,
        requiredEnvelopePreserved,
        privateStatePreserved,
        autoCloseHistoryPublished,
        freshTournamentNotClosed,
        legacyFlatRecordClosed,
        parentTimestampNotClosed,
        pendingRegistryPreservedBeforeRepair,
        publicFailureStayedRetryable,
        freshnessRejectedAndRolledBack,
        autoCloseRollbackRegistryRestored,
        autoCloseRollbackMergedNewerProgress,
        doubleFailureSelfHealed,
        finalizeFailureSelfHealed,
        concurrentPublisherLeaseHeld,
        divergentTerminalConflictsRetired,
        finishPendingRegistryPreserved,
        finishPendingHonorsNewerRunning,
        finishRollbackMergedNewerProgress,
        generationConflictProtected,
        oldGenerationReleasePreservedNewClaim,
        legacyReleasePreservedTokenizedClaim,
        matchingGenerationReleaseSucceeded,
        activeCleanupRacePreservedNewClaim,
        registryConflictConverged,
        autoCloseRegistryConflictConverged,
        legacyPubReorderMappedByIdentity,
        legacyPubAmbiguousStayedOpaque,
        autoClosePublisherClockRefetched,
        futureAutoPublisherClaimReplaced,
        strictNumericUpdatedAtWonOverFutureStartedAt,
        publisherClockDebug,
        privatePublicFreshnessRejectReconciled,
        privatePublicCompensationCasPreservedConcurrentWrite,
        privateStatus: privateClosed?.tournament?.status || "",
        publicStatus: publicClosed?.state?.tournament?.status || "",
        refreshedStatus: refreshed?.tournament?.status || "",
        legacyStatus: legacyClosed?.tournament?.status || "",
        rollbackStatus: rollbackState?.tournament?.status || "",
        repairedStatus: repairedState?.tournament?.status || ""
      };
    } finally {
      Date.now = publisherOriginalDateNow;
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      delete store.tournaments[staleId];
      delete store.tournaments[refreshedId];
      delete store.tournaments[legacyId];
      delete store.tournaments[rollbackId];
      delete store.tournaments[freshnessId];
      delete store.tournaments[doubleFailureId];
      delete store.tournaments[parentFreshId];
      delete store.tournaments[concurrentId];
      delete store.tournaments[finalizeFailureId];
      delete store.tournaments[divergentFinishId];
      delete store.tournaments[divergentAutoId];
      delete store.tournaments[finishConflictId];
      delete store.tournaments[competingActiveId];
      delete store.tournaments[supersededFinishId];
      delete store.tournaments[supersededAutoId];
      delete store.tournaments[generationConflictId];
      delete store.tournaments[cleanupRaceOldId];
      delete store.tournaments[cleanupRaceNewId];
      delete store.tournaments[twoPhaseId];
      delete store.tournaments[twoPhaseRaceId];
      delete store.tournaments[futurePublisherAutoId];
      delete store.tournaments[strictNumericAutoId];
      delete store.publicLive[staleId];
      delete store.publicLive[refreshedId];
      delete store.publicLive[legacyId];
      delete store.publicLive[rollbackId];
      delete store.publicLive[freshnessId];
      delete store.publicLive[doubleFailureId];
      delete store.publicLive[parentFreshId];
      delete store.publicLive[concurrentId];
      delete store.publicLive[finalizeFailureId];
      delete store.publicLive[divergentFinishId];
      delete store.publicLive[divergentAutoId];
      delete store.publicLive[finishConflictId];
      delete store.publicLive[competingActiveId];
      delete store.publicLive[supersededFinishId];
      delete store.publicLive[supersededAutoId];
      delete store.publicLive[generationConflictId];
      delete store.publicLive[cleanupRaceOldId];
      delete store.publicLive[cleanupRaceNewId];
      delete store.publicLive[twoPhaseId];
      delete store.publicLive[twoPhaseRaceId];
      delete store.publicLive[futurePublisherAutoId];
      delete store.publicLive[strictNumericAutoId];
      if (activeRegistryBackup === undefined) delete store.activeTournaments["qa-venue"];
      else store.activeTournaments["qa-venue"] = activeRegistryBackup;
      store.privateResultLogs = store.privateResultLogs || {};
      if (privateHistoryBackup === undefined) delete store.privateResultLogs["qa-venue"];
      else store.privateResultLogs["qa-venue"] = privateHistoryBackup;
      store.publicHistory = publicHistoryBackup;
      if (serverClock) {
        store[".info"] = { ...(store[".info"] || {}), serverTimeOffset: serverClockOffsetBackup };
        await serverClock.refresh(true);
      }
      if (serverInfoBackup === undefined) delete store[".info"];
      else store[".info"] = JSON.parse(JSON.stringify(serverInfoBackup));
      renderOperator();
    }
  });
  logs.push({ step: "remote-auto-close-privacy-v278", info: { remoteAutoClosePrivacyV278 } });
  if (remoteAutoClosePrivacyV278.forbiddenKeyPaths.length || remoteAutoClosePrivacyV278.leakedTokens.length) {
    failures.push(`remote auto-close leaked private state ${JSON.stringify(remoteAutoClosePrivacyV278)}`);
  }
  if (!remoteAutoClosePrivacyV278.requiredEnvelopePreserved || !remoteAutoClosePrivacyV278.privateStatePreserved || !remoteAutoClosePrivacyV278.autoCloseHistoryPublished || !remoteAutoClosePrivacyV278.freshTournamentNotClosed || !remoteAutoClosePrivacyV278.legacyFlatRecordClosed || !remoteAutoClosePrivacyV278.parentTimestampNotClosed || !remoteAutoClosePrivacyV278.pendingRegistryPreservedBeforeRepair || !remoteAutoClosePrivacyV278.publicFailureStayedRetryable || !remoteAutoClosePrivacyV278.freshnessRejectedAndRolledBack || !remoteAutoClosePrivacyV278.autoCloseRollbackRegistryRestored || !remoteAutoClosePrivacyV278.autoCloseRollbackMergedNewerProgress || !remoteAutoClosePrivacyV278.doubleFailureSelfHealed || !remoteAutoClosePrivacyV278.finalizeFailureSelfHealed || !remoteAutoClosePrivacyV278.concurrentPublisherLeaseHeld || !remoteAutoClosePrivacyV278.divergentTerminalConflictsRetired || !remoteAutoClosePrivacyV278.finishPendingRegistryPreserved || !remoteAutoClosePrivacyV278.finishPendingHonorsNewerRunning || !remoteAutoClosePrivacyV278.finishRollbackMergedNewerProgress || !remoteAutoClosePrivacyV278.generationConflictProtected || !remoteAutoClosePrivacyV278.oldGenerationReleasePreservedNewClaim || !remoteAutoClosePrivacyV278.legacyReleasePreservedTokenizedClaim || !remoteAutoClosePrivacyV278.matchingGenerationReleaseSucceeded || !remoteAutoClosePrivacyV278.activeCleanupRacePreservedNewClaim || !remoteAutoClosePrivacyV278.registryConflictConverged || !remoteAutoClosePrivacyV278.autoCloseRegistryConflictConverged || !remoteAutoClosePrivacyV278.legacyPubReorderMappedByIdentity || !remoteAutoClosePrivacyV278.legacyPubAmbiguousStayedOpaque || !remoteAutoClosePrivacyV278.privatePublicFreshnessRejectReconciled || !remoteAutoClosePrivacyV278.privatePublicCompensationCasPreservedConcurrentWrite || !remoteAutoClosePrivacyV278.autoClosePublisherClockRefetched || !remoteAutoClosePrivacyV278.futureAutoPublisherClaimReplaced || !remoteAutoClosePrivacyV278.strictNumericUpdatedAtWonOverFutureStartedAt) {
    failures.push(`remote auto-close safety regression ${JSON.stringify(remoteAutoClosePrivacyV278)}`);
  }

  const finishSyncFailureV278 = await page.evaluate(async () => {
    const backupState = exportState();
    const backupActiveRoundIndex = activeRoundIndex;
    const backupFirebaseTournamentId = firebaseTournamentId;
    const backupDbVenueIdDraft = dbVenueIdDraft;
    const storageKeys = [STORAGE_KEY, LOCAL_SNAPSHOT_KEY, OPERATOR_UNDO_STORAGE_KEY_V266, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature", "mini4wdActiveLiveDate"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const activeRegistryBackup = window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]
      ? JSON.parse(JSON.stringify(window.__qaFirebaseStore.activeTournaments["qa-venue"]))
      : undefined;
    const operationLeaseBackup = window.__qaFirebaseStore?.operationLocks?.leases?.["qa-venue"]
      ? JSON.parse(JSON.stringify(window.__qaFirebaseStore.operationLocks.leases["qa-venue"]))
      : undefined;
    const finishServerInfoBackup = window.__qaFirebaseStore?.[".info"] === undefined
      ? undefined
      : JSON.parse(JSON.stringify(window.__qaFirebaseStore[".info"]));
    const finishServerClock = window.__mini4wdFirebaseServerClockV279;
    const finishServerClockOffsetBackup = Number(finishServerClock?.offset?.() || 0);
    const finishOriginalDateNow = Date.now;
    let tournamentId = "";
    let canonicalTournamentId = "";
    let staleConflictId = "";
    let finishRecordId = "";
    let staleFalseHistoryId = "";
    let completedTerminalId = "";
    let snapshotRestoreId = "";
    let mixedGenerationSnapshotId = "";
    let exactVenueSnapshotId = "";
    let exactVenueCompetitorId = "";
    const exactSnapshotVenueId = "qa-snapshot-exact-venue";
    const currentDraftVenueId = "qa-current-venue";
    try {
      state = makeInitialState(3);
      state.inputText = "Finish A/QA\nFinish B/QB";
      state.tournament = {
        ...state.tournament,
        name: "QA Finish Sync Failure",
        venue: "QA Venue",
        venueId: "qa-venue",
        raceClass: "오픈",
        status: "finished",
        startedAtISO: new Date().toISOString(),
        endedAtISO: new Date().toISOString(),
        endedAtDisplay: formatDateTimeLocal(new Date())
      };
      state.updatedAt = Date.now();
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      canonicalTournamentId = buildAutoTournamentId();
      tournamentId = "qa-recovered-noncanonical-live-v278";
      state.tournament.liveId = tournamentId;
      state.tournament.liveSignature = canonicalTournamentId;
      state.tournament.finishSyncRecord = makeTournamentRecord();
      finishRecordId = state.tournament.finishSyncRecord.id;
      firebaseTournamentId = tournamentId;
      localStorage.setItem("mini4wdTournamentId", tournamentId);
      localStorage.setItem("mini4wdActiveLiveId", tournamentId);
      localStorage.setItem("mini4wdActiveLiveSignature", canonicalTournamentId);
      window.__qaRejectFirebaseTransactionPaths = [`publicLive/${tournamentId}`];
      window.__qaFirebaseTransactionLog = [];

      const firstResult = await syncFinishedTournamentAndAdvanceV278("qa-finish-sync-failure-v278");
      const firstSyncTransactionLog = [...window.__qaFirebaseTransactionLog];
      const privatePendingWrittenBeforePublic = firstSyncTransactionLog.indexOf(`tournaments/${tournamentId}`) >= 0
        && firstSyncTransactionLog.indexOf(`tournaments/${tournamentId}`) < firstSyncTransactionLog.indexOf(`publicLive/${tournamentId}`);
      const pendingAfterFailure = Boolean(state.tournament.finishSyncPending);
      const statusAfterFailure = state.tournament.status;
      const syncErrorAfterFailure = state.tournament.finishSyncError || "";
      const remotePrivatePendingAfterFailure = Boolean(window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state?.tournament?.finishSyncPending);
      const noHistoryBeforeTerminalPublic = Boolean(
        !window.__qaFirebaseStore?.privateResultLogs?.["qa-venue"]?.[finishRecordId]
        && !window.__qaFirebaseStore?.publicHistory?.[finishRecordId]
      );
      prepareNewTournamentFromFinished();
      const statusAfterBlockedPrepare = state.tournament.status;

      window.__qaRejectFirebaseTransactionPaths = [];
      const repairBridgeLeaseExpiredAt = firebaseServerNowV279() - 1000;
      window.__qaFirebaseStore.operationLocks = window.__qaFirebaseStore.operationLocks || {};
      window.__qaFirebaseStore.operationLocks.leases = window.__qaFirebaseStore.operationLocks.leases || {};
      window.__qaFirebaseStore.operationLocks.leases["qa-venue"] = {
        protocolVersion: 279,
        scope: "venue",
        venueId: "qa-venue",
        venueName: "QA Venue",
        uid: "qa-uid",
        email: "qa-venue@example.com",
        sessionId: window.__mini4wdOperatorSession?.sessionId || "",
        sessionLineageId: window.__mini4wdOperatorSession?.lineageId || "qa-finish-retry-lineage-v279",
        claimSequence: 640,
        fenceSequenceHighWater: 640,
        fenceToken: "qa-finish-retry-fence-v279",
        tournamentId,
        registryGeneration: String(state.tournament?.activeRegistryGeneration || ""),
        tournamentName: state.tournament?.name || "QA Finish Sync Failure",
        status: "running",
        reason: "qa-expired-finish-retry-v279",
        leaseUntil: repairBridgeLeaseExpiredAt,
        clientUpdatedAt: repairBridgeLeaseExpiredAt,
        updatedAt: repairBridgeLeaseExpiredAt,
        build: "qa-v279"
      };
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      const repairBridgeLeaseExpiredBeforeRetry = Number(window.__qaFirebaseStore.operationLocks.leases["qa-venue"].leaseUntil || 0) < firebaseServerNowV279();
      const finishPublisherClientBase = finishOriginalDateNow();
      const finishPublisherRollbackNow = finishPublisherClientBase - 120000;
      const finishPublisherServerOffset = 240000;
      const finishForeignPublisherAt = finishPublisherClientBase + 60000;
      const finishForeignPublisherToken = "qa-foreign-future-finish-publisher-v279";
      const pendingRemoteFinish = window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state
        || window.__qaFirebaseStore?.tournaments?.[tournamentId];
      pendingRemoteFinish.tournament.finishSyncPublisherToken = finishForeignPublisherToken;
      pendingRemoteFinish.tournament.finishSyncPublisherAt = finishForeignPublisherAt;
      window.__qaFirebaseStore[".info"] = {
        ...(window.__qaFirebaseStore[".info"] || {}),
        serverTimeOffset: finishPublisherServerOffset
      };
      Date.now = () => finishPublisherRollbackNow;
      const repairBridgeEvents = [];
      window.__qaFirebaseTransactionLog = [];
      window.__qaBeforeFirebaseTransaction = path => {
        if (![ `tournaments/${tournamentId}`, `publicLive/${tournamentId}` ].includes(path)) return;
        const pendingPrivate = window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state || window.__qaFirebaseStore?.tournaments?.[tournamentId];
        repairBridgeEvents.push({
          path,
          status: pendingPrivate?.tournament?.status || "",
          pending: Boolean(pendingPrivate?.tournament?.finishSyncPending),
          publisherToken: String(pendingPrivate?.tournament?.finishSyncPublisherToken || ""),
          publisherAt: Number(pendingPrivate?.tournament?.finishSyncPublisherAt || 0)
        });
      };
      const retryResult = await window.retryFinishSyncV278();
      window.__qaBeforeFirebaseTransaction = null;
      const finishPublisherClockRefetched = Boolean(
        finishServerClock
        && Number(finishServerClock.offset()) === finishPublisherServerOffset
      );
      Date.now = finishOriginalDateNow;
      if (finishServerClock) {
        window.__qaFirebaseStore[".info"] = {
          ...(window.__qaFirebaseStore[".info"] || {}),
          serverTimeOffset: finishServerClockOffsetBackup
        };
        await finishServerClock.refresh(true);
      }
      if (finishServerInfoBackup === undefined) delete window.__qaFirebaseStore[".info"];
      else window.__qaFirebaseStore[".info"] = JSON.parse(JSON.stringify(finishServerInfoBackup));
      const repairBridgeTransactionLog = [...window.__qaFirebaseTransactionLog];
      const repairClaimIndex = repairBridgeTransactionLog.indexOf(`tournaments/${tournamentId}`);
      const repairPublicIndex = repairBridgeTransactionLog.indexOf(`publicLive/${tournamentId}`);
      const repairFinalizeIndex = repairBridgeTransactionLog.lastIndexOf(`tournaments/${tournamentId}`);
      const repairPublicEntry = repairBridgeEvents.find(event => event.path === `publicLive/${tournamentId}`) || null;
      const repairClaimEntry = repairBridgeEvents.filter(event => event.path === `tournaments/${tournamentId}`)[0] || null;
      const repairFinalizeEntry = repairBridgeEvents.filter(event => event.path === `tournaments/${tournamentId}`)[1] || null;
      const repairBridgePublisherClaimBeforeTerminalAndFinalize = Boolean(
        repairClaimIndex >= 0
        && repairPublicIndex > repairClaimIndex
        && repairFinalizeIndex > repairPublicIndex
        && repairPublicEntry?.status === "finished"
        && repairPublicEntry?.pending === true
        && repairPublicEntry?.publisherToken
        && repairFinalizeEntry?.publisherToken === repairPublicEntry.publisherToken
      );
      const finishFuturePublisherClaimReplaced = Boolean(
        finishPublisherClockRefetched
        && repairClaimEntry?.publisherToken === finishForeignPublisherToken
        && repairClaimEntry?.publisherAt === finishForeignPublisherAt
        && repairPublicEntry?.publisherToken
        && repairPublicEntry.publisherToken !== finishForeignPublisherToken
        && repairPublicEntry.publisherAt >= finishForeignPublisherAt
        && repairFinalizeEntry?.publisherToken === repairPublicEntry.publisherToken
        && repairFinalizeEntry?.publisherAt === repairPublicEntry.publisherAt
      );
      const remoteScanRecoveredPendingFinish = Boolean(
        window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state?.tournament?.status === "finished"
        && window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state?.tournament?.finishSyncPending === false
        && window.__qaFirebaseStore?.publicLive?.[tournamentId]?.status === "finished"
      );
      const historyPublishedAfterTerminalAcceptance = Boolean(
        window.__qaFirebaseStore?.privateResultLogs?.["qa-venue"]?.[finishRecordId]
        && window.__qaFirebaseStore?.publicHistory?.[finishRecordId]
      );
      const statusAfterRetry = state.tournament.status;
      const remotePrivate = window.__qaFirebaseStore?.tournaments?.[tournamentId]?.state;
      const remotePublic = window.__qaFirebaseStore?.publicLive?.[tournamentId];
      const repairBridgePublisherTokenCleared = Boolean(
        remotePrivate?.tournament?.finishSyncPending === false
        && !remotePrivate?.tournament?.finishSyncPublisherToken
        && !remotePrivate?.tournament?.finishSyncPublisherAt
      );
      const canonicalRemote = window.__qaFirebaseStore?.tournaments?.[canonicalTournamentId] || window.__qaFirebaseStore?.publicLive?.[canonicalTournamentId];

      // Simulate the original failed tab retrying after another session has
      // resumed the tournament. The semantic finish timestamp must stay old;
      // retry time itself must not make the stale finish look newer.
      staleConflictId = "qa-stale-local-finish-retry-v278";
      const staleTerminalAt = Date.now() - 120000;
      const newerRunningAt = Date.now() - 60000;
      const remoteRunningState = makeInitialState(3);
      remoteRunningState.inputText = "Resume A/QA\nResume B/QB";
      remoteRunningState.tournament = {
        ...remoteRunningState.tournament,
        name: "QA Newer Remote Resume",
        venue: "QA Venue",
        venueId: "qa-venue",
        raceClass: "오픈",
        status: "running",
        startedAtISO: new Date(staleTerminalAt - 60000).toISOString(),
        liveId: staleConflictId,
        liveSignature: ""
      };
      const staleCanonicalSignature = (() => {
        const previousState = state;
        state = remoteRunningState;
        try { return buildAutoTournamentId(); }
        finally { state = previousState; }
      })();
      remoteRunningState.tournament.liveSignature = staleCanonicalSignature;
      remoteRunningState.updatedAt = newerRunningAt;
      remoteRunningState.activeRoundIndex = 0;
      // Keep this as a legacy flat record: a child /state transaction would
      // blindly create stale terminal state and mask the newer flat runner.
      window.__qaFirebaseStore.tournaments[staleConflictId] = JSON.parse(JSON.stringify(remoteRunningState));
      window.__qaFirebaseStore.publicLive[staleConflictId] = {
        id: staleConflictId,
        status: "running",
        live: true,
        updatedAt: newerRunningAt,
        state: makePublicStatePayload(remoteRunningState)
      };
      window.__qaFirebaseStore.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: staleConflictId,
        status: "running",
        updatedAt: newerRunningAt
      };
      state = normalizeImportedState(remoteRunningState);
      // Queue the installed v104 batcher while still running, then transition
      // locally to pending before its 220ms timer fires.
      queueFirebaseSave();
      state.tournament.status = "finished";
      state.tournament.finishSyncPending = true;
      state.tournament.finishSyncTerminalUpdatedAt = staleTerminalAt;
      state.tournament.finishSyncPreviousUpdatedAt = staleTerminalAt - 1000;
      state.tournament.finishSyncPreviousEndedAtISO = "";
      state.tournament.finishSyncPreviousEndedAtDisplay = "";
      state.tournament.finishSyncPreviousLiveStopped = false;
      state.tournament.finishSyncPreviousFirebaseAutoSave = true;
      staleFalseHistoryId = "qa-stale-finish-history-v278";
      state.tournament.finishSyncRecord = {
        id: staleFalseHistoryId,
        venueId: "qa-venue",
        venueName: "QA Venue",
        tournamentName: "Stale false terminal",
        rows: []
      };
      state.tournament.endedAtISO = new Date(staleTerminalAt).toISOString();
      state.tournament.endedAtDisplay = formatDateTimeLocal(new Date(staleTerminalAt));
      // A pagehide/save may have refreshed this local field after the finish.
      // finishSyncTerminalUpdatedAt remains the authoritative comparison time.
      state.updatedAt = Date.now();
      firebaseTournamentId = staleConflictId;
      localStorage.setItem("mini4wdTournamentId", staleConflictId);
      localStorage.setItem("mini4wdActiveLiveId", staleConflictId);
      localStorage.setItem("mini4wdActiveLiveSignature", staleCanonicalSignature);
      renderOperator();
      const pendingCancelHidden = !Array.from(document.querySelectorAll("button"))
        .some(button => button.textContent?.trim() === "종료 취소");
      const pendingPublicFallbackBlocked = await forcePublishPublicLiveV50("qa-pending-public-fallback-v278") === false;
      await new Promise(resolve => setTimeout(resolve, 950));
      const renderAutosaveHonorsNewerRunning = Boolean(
        pendingPublicFallbackBlocked
        &&
        state.tournament.status === "finished"
        && state.tournament.finishSyncPending === true
        && (window.__qaFirebaseStore?.tournaments?.[staleConflictId]?.state || window.__qaFirebaseStore?.tournaments?.[staleConflictId])?.tournament?.status === "running"
        && Number((window.__qaFirebaseStore?.tournaments?.[staleConflictId]?.state || window.__qaFirebaseStore?.tournaments?.[staleConflictId])?.updatedAt) === newerRunningAt
        && window.__qaFirebaseStore?.publicLive?.[staleConflictId]?.status === "running"
        && Number(window.__qaFirebaseStore?.publicLive?.[staleConflictId]?.updatedAt) === newerRunningAt
      );
      window.__qaFirebaseTransactionLog = [];
      const staleLocalRetryResult = await window.retryFinishSyncV278();
      const staleLocalRetryTransactionLog = [...window.__qaFirebaseTransactionLog];
      const staleConflictPrivate = window.__qaFirebaseStore?.tournaments?.[staleConflictId]?.state || window.__qaFirebaseStore?.tournaments?.[staleConflictId];
      const staleConflictPublic = window.__qaFirebaseStore?.publicLive?.[staleConflictId];
      const staleLocalRetryDebug = {
        result: staleLocalRetryResult,
        localStatus: state.tournament.status,
        localPending: Boolean(state.tournament.finishSyncPending),
        localUpdatedAt: Number(state.updatedAt),
        privateStatus: staleConflictPrivate?.tournament?.status || "",
        privateUpdatedAt: Number(staleConflictPrivate?.updatedAt),
        publicStatus: staleConflictPublic?.status || "",
        publicUpdatedAt: Number(staleConflictPublic?.updatedAt),
        registryTournamentId: window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]?.tournamentId || "",
        expectedTournamentId: staleConflictId,
        expectedUpdatedAt: newerRunningAt,
        transactionLog: staleLocalRetryTransactionLog
      };
      const staleLocalRetryHonorsNewerRunning = Boolean(
        staleLocalRetryDebug.result === false
        && staleLocalRetryDebug.localStatus === "running"
        && staleLocalRetryDebug.localPending === false
        && staleLocalRetryDebug.localUpdatedAt >= newerRunningAt
        && staleLocalRetryDebug.privateStatus === "running"
        && staleLocalRetryDebug.privateUpdatedAt === newerRunningAt
        && staleLocalRetryDebug.publicStatus === "running"
        && staleLocalRetryDebug.publicUpdatedAt === newerRunningAt
        && staleLocalRetryDebug.registryTournamentId === staleConflictId
      );
      const staleTerminalCreatedNoFalseHistory = Boolean(
        !window.__qaFirebaseStore?.privateResultLogs?.["qa-venue"]?.[staleFalseHistoryId]
        && !window.__qaFirebaseStore?.publicHistory?.[staleFalseHistoryId]
      );
      const staleLocalRetryMadeNoTerminalWrites = Boolean(
        !staleLocalRetryTransactionLog.includes(`tournaments/${staleConflictId}`)
        && !staleLocalRetryTransactionLog.includes(`publicLive/${staleConflictId}`)
      );

      completedTerminalId = "qa-completed-terminal-generic-block-v278";
      const completedRemoteAt = Date.now() + 90000;
      const completedRemoteRunning = normalizeImportedState(remoteRunningState);
      completedRemoteRunning.tournament.liveId = completedTerminalId;
      completedRemoteRunning.tournament.liveSignature = staleCanonicalSignature;
      completedRemoteRunning.tournament.status = "running";
      completedRemoteRunning.tournament.activeRegistryGeneration = "completed-new-generation";
      completedRemoteRunning.updatedAt = completedRemoteAt;
      window.__qaFirebaseStore.tournaments[completedTerminalId] = {
        state: JSON.parse(JSON.stringify(completedRemoteRunning)),
        updatedAt: completedRemoteAt
      };
      window.__qaFirebaseStore.publicLive[completedTerminalId] = {
        id: completedTerminalId,
        registryGeneration: "completed-new-generation",
        status: "running",
        live: true,
        updatedAt: completedRemoteAt,
        state: makePublicStatePayload(completedRemoteRunning)
      };
      window.__qaFirebaseStore.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: completedTerminalId,
        registryGeneration: "completed-new-generation",
        status: "running",
        updatedAt: completedRemoteAt
      };
      state = normalizeImportedState(completedRemoteRunning);
      state.tournament.status = "finished";
      state.tournament.finishSyncPending = false;
      state.tournament.finishSyncTerminalUpdatedAt = completedRemoteAt - 120000;
      state.tournament.activeRegistryGeneration = "completed-old-generation";
      state.updatedAt = Date.now();
      firebaseTournamentId = completedTerminalId;
      localStorage.setItem("mini4wdTournamentId", completedTerminalId);
      localStorage.setItem("mini4wdActiveLiveId", completedTerminalId);
      localStorage.setItem("mini4wdActiveLiveSignature", staleCanonicalSignature);
      renderOperator();
      queueFirebaseSave();
      const completedForceBlocked = await forceLiveBroadcastSync("qa-completed-terminal-v278") === false;
      const completedPublicBlocked = await forcePublishPublicLiveV50("qa-completed-terminal-public-v278") === false;
      await new Promise(resolve => setTimeout(resolve, 950));
      const completedPrivateAfter = window.__qaFirebaseStore?.tournaments?.[completedTerminalId]?.state;
      const completedPublicAfter = window.__qaFirebaseStore?.publicLive?.[completedTerminalId];
      const completedTerminalGenericSyncBlocked = Boolean(
        completedForceBlocked
        && completedPublicBlocked
        && completedPrivateAfter?.tournament?.status === "running"
        && Number(completedPrivateAfter?.updatedAt) === completedRemoteAt
        && completedPublicAfter?.status === "running"
        && Number(completedPublicAfter?.updatedAt) === completedRemoteAt
      );

      snapshotRestoreId = "qa-snapshot-terminal-resurrection-v278";
      const snapshotRunningState = normalizeImportedState(remoteRunningState);
      snapshotRunningState.tournament.liveId = snapshotRestoreId;
      snapshotRunningState.tournament.liveSignature = staleCanonicalSignature;
      snapshotRunningState.tournament.status = "running";
      snapshotRunningState.tournament.activeRegistryGeneration = "snapshot-generation";
      snapshotRunningState.updatedAt = Date.now() - 120000;
      const snapshotTerminalState = normalizeImportedState(snapshotRunningState);
      snapshotTerminalState.tournament.status = "finished";
      snapshotTerminalState.tournament.endedAtISO = new Date().toISOString();
      snapshotTerminalState.tournament.endedAtDisplay = formatDateTimeLocal(new Date());
      snapshotTerminalState.updatedAt = Date.now() + 120000;
      window.__qaFirebaseStore.tournaments[snapshotRestoreId] = {
        state: JSON.parse(JSON.stringify(snapshotTerminalState)),
        updatedAt: snapshotTerminalState.updatedAt
      };
      window.__qaFirebaseStore.publicLive[snapshotRestoreId] = {
        id: snapshotRestoreId,
        registryGeneration: "snapshot-generation",
        status: "finished",
        live: false,
        updatedAt: snapshotTerminalState.updatedAt,
        state: makePublicStatePayload(snapshotTerminalState)
      };
      delete window.__qaFirebaseStore.activeTournaments["qa-venue"];
      const snapshotKey = "qa-snapshot-terminal-resurrection-key-v278";
      const snapshotId = "qa-snapshot-terminal-resurrection-entry-v278";
      saveSnapshotMapV278({
        [snapshotKey]: {
          id: snapshotId,
          key: snapshotKey,
          tournamentId: snapshotRestoreId,
          label: "QA stale running snapshot",
          createdAt: new Date().toISOString(),
          state: JSON.parse(JSON.stringify(snapshotRunningState))
        }
      }, snapshotKey);
      state = normalizeImportedState(snapshotRunningState);
      firebaseTournamentId = snapshotRestoreId;
      localStorage.setItem("mini4wdTournamentId", snapshotRestoreId);
      localStorage.setItem("mini4wdActiveLiveId", snapshotRestoreId);
      localStorage.setItem("mini4wdActiveLiveSignature", staleCanonicalSignature);
      await restoreSnapshot(snapshotId);
      const snapshotRemoteAfter = window.__qaFirebaseStore?.tournaments?.[snapshotRestoreId]?.state;
      const snapshotPublicAfter = window.__qaFirebaseStore?.publicLive?.[snapshotRestoreId];
      const snapshotRestoreCannotReviveTerminal = Boolean(
        state.tournament?.status === "finished"
        && snapshotRemoteAfter?.tournament?.status === "finished"
        && Number(snapshotRemoteAfter?.updatedAt) === Number(snapshotTerminalState.updatedAt)
        && snapshotPublicAfter?.status === "finished"
        && snapshotPublicAfter?.live === false
        && !window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]
      );

      state = normalizeImportedState(snapshotRunningState);
      firebaseTournamentId = snapshotRestoreId;
      localStorage.setItem("mini4wdTournamentId", snapshotRestoreId);
      localStorage.setItem("mini4wdActiveLiveId", snapshotRestoreId);
      localStorage.setItem("mini4wdActiveLiveSignature", staleCanonicalSignature);
      safeSetItem(OPERATOR_UNDO_STORAGE_KEY_V266, JSON.stringify({
        id: "qa-operator-undo-terminal-entry-v278",
        key: currentSnapshotKey(),
        tournamentId: snapshotRestoreId,
        label: "QA stale running undo",
        createdAt: new Date().toISOString(),
        activeRoundIndex: snapshotRunningState.activeRoundIndex || 0,
        state: JSON.parse(JSON.stringify(snapshotRunningState))
      }));
      await restoreOperatorUndoV266();
      const undoRemoteAfter = window.__qaFirebaseStore?.tournaments?.[snapshotRestoreId]?.state;
      const undoPublicAfter = window.__qaFirebaseStore?.publicLive?.[snapshotRestoreId];
      const operatorUndoCannotReviveTerminal = Boolean(
        state.tournament?.status === "finished"
        && undoRemoteAfter?.tournament?.status === "finished"
        && Number(undoRemoteAfter?.updatedAt) === Number(snapshotTerminalState.updatedAt)
        && undoPublicAfter?.status === "finished"
        && undoPublicAfter?.live === false
        && !window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]
      );

      mixedGenerationSnapshotId = "qa-snapshot-mixed-generation-v278";
      const tokenizedCurrentState = normalizeImportedState(remoteRunningState);
      tokenizedCurrentState.tournament.name = "QA tokenized current instance";
      tokenizedCurrentState.tournament.liveId = mixedGenerationSnapshotId;
      tokenizedCurrentState.tournament.liveSignature = staleCanonicalSignature;
      tokenizedCurrentState.tournament.status = "running";
      tokenizedCurrentState.tournament.activeRegistryGeneration = "snapshot-current-generation";
      tokenizedCurrentState.updatedAt = Date.now() + 180000;
      window.__qaFirebaseStore.tournaments[mixedGenerationSnapshotId] = {
        state: JSON.parse(JSON.stringify(tokenizedCurrentState)),
        updatedAt: tokenizedCurrentState.updatedAt
      };
      window.__qaFirebaseStore.publicLive[mixedGenerationSnapshotId] = {
        id: mixedGenerationSnapshotId,
        registryGeneration: "snapshot-current-generation",
        status: "running",
        live: true,
        updatedAt: tokenizedCurrentState.updatedAt,
        state: makePublicStatePayload(tokenizedCurrentState)
      };
      window.__qaFirebaseStore.activeTournaments["qa-venue"] = {
        venueId: "qa-venue",
        tournamentId: mixedGenerationSnapshotId,
        registryGeneration: "snapshot-current-generation",
        status: "running",
        updatedAt: tokenizedCurrentState.updatedAt
      };
      const legacySnapshotState = normalizeImportedState(tokenizedCurrentState);
      legacySnapshotState.tournament.name = "QA legacy stale snapshot";
      delete legacySnapshotState.tournament.activeRegistryGeneration;
      legacySnapshotState.updatedAt = Date.now() - 180000;
      const mixedSnapshotKey = "qa-snapshot-mixed-generation-key-v278";
      const mixedSnapshotEntryId = "qa-snapshot-mixed-generation-entry-v278";
      saveSnapshotMapV278({
        [mixedSnapshotKey]: {
          id: mixedSnapshotEntryId,
          key: mixedSnapshotKey,
          tournamentId: mixedGenerationSnapshotId,
          label: "QA legacy generation snapshot",
          createdAt: new Date().toISOString(),
          state: JSON.parse(JSON.stringify(legacySnapshotState))
        }
      }, mixedSnapshotKey);
      state = normalizeImportedState(tokenizedCurrentState);
      firebaseTournamentId = mixedGenerationSnapshotId;
      localStorage.setItem("mini4wdTournamentId", mixedGenerationSnapshotId);
      localStorage.setItem("mini4wdActiveLiveId", mixedGenerationSnapshotId);
      localStorage.setItem("mini4wdActiveLiveSignature", staleCanonicalSignature);
      await restoreSnapshot(mixedSnapshotEntryId);
      const mixedRemoteAfter = window.__qaFirebaseStore?.tournaments?.[mixedGenerationSnapshotId]?.state;
      const mixedPublicAfter = window.__qaFirebaseStore?.publicLive?.[mixedGenerationSnapshotId];
      const snapshotRestoreRejectsLegacyGenerationMix = Boolean(
        state.tournament?.name === "QA tokenized current instance"
        && state.tournament?.activeRegistryGeneration === "snapshot-current-generation"
        && mixedRemoteAfter?.tournament?.name === "QA tokenized current instance"
        && Number(mixedRemoteAfter?.updatedAt) === Number(tokenizedCurrentState.updatedAt)
        && mixedPublicAfter?.registryGeneration === "snapshot-current-generation"
        && window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]?.registryGeneration === "snapshot-current-generation"
      );
      safeSetItem(OPERATOR_UNDO_STORAGE_KEY_V266, JSON.stringify({
        id: "qa-undo-mixed-generation-entry-v278",
        key: currentSnapshotKey(),
        tournamentId: mixedGenerationSnapshotId,
        label: "QA legacy generation undo",
        createdAt: new Date().toISOString(),
        activeRoundIndex: legacySnapshotState.activeRoundIndex || 0,
        state: JSON.parse(JSON.stringify(legacySnapshotState))
      }));
      await restoreOperatorUndoV266();
      const mixedUndoRemoteAfter = window.__qaFirebaseStore?.tournaments?.[mixedGenerationSnapshotId]?.state;
      const mixedUndoPublicAfter = window.__qaFirebaseStore?.publicLive?.[mixedGenerationSnapshotId];
      const operatorUndoRejectsLegacyGenerationMix = Boolean(
        state.tournament?.name === "QA tokenized current instance"
        && state.tournament?.activeRegistryGeneration === "snapshot-current-generation"
        && mixedUndoRemoteAfter?.tournament?.name === "QA tokenized current instance"
        && Number(mixedUndoRemoteAfter?.updatedAt) === Number(tokenizedCurrentState.updatedAt)
        && mixedUndoPublicAfter?.registryGeneration === "snapshot-current-generation"
        && window.__qaFirebaseStore?.activeTournaments?.["qa-venue"]?.registryGeneration === "snapshot-current-generation"
      );

      exactVenueSnapshotId = "qa-snapshot-exact-claim-v278";
      exactVenueCompetitorId = "qa-snapshot-other-venue-competitor-v278";
      const exactGeneration = "snapshot-exact-generation";
      const exactRunningState = normalizeImportedState(remoteRunningState);
      exactRunningState.tournament.name = "QA exact venue snapshot";
      exactRunningState.tournament.venue = "QA Snapshot Exact Venue";
      exactRunningState.tournament.venueId = exactSnapshotVenueId;
      exactRunningState.tournament.liveId = exactVenueSnapshotId;
      exactRunningState.tournament.liveSignature = staleCanonicalSignature;
      exactRunningState.tournament.status = "running";
      exactRunningState.tournament.activeRegistryGeneration = exactGeneration;
      exactRunningState.updatedAt = Date.now() - 5000;
      const exactPublicState = makePublicStatePayload(exactRunningState);
      window.__qaFirebaseStore.tournaments[exactVenueSnapshotId] = {
        state: JSON.parse(JSON.stringify(exactRunningState)),
        updatedAt: exactRunningState.updatedAt
      };
      window.__qaFirebaseStore.publicLive[exactVenueSnapshotId] = {
        id: exactVenueSnapshotId,
        registryGeneration: exactGeneration,
        status: "running",
        live: true,
        updatedAt: exactRunningState.updatedAt,
        state: exactPublicState
      };
      window.__qaFirebaseStore.activeTournaments[exactSnapshotVenueId] = {
        venueId: exactSnapshotVenueId,
        tournamentId: exactVenueSnapshotId,
        registryGeneration: exactGeneration,
        status: "running",
        updatedAt: exactRunningState.updatedAt
      };

      const competitorState = normalizeImportedState(remoteRunningState);
      competitorState.tournament.name = "QA current venue competitor";
      competitorState.tournament.venue = "QA Current Venue";
      competitorState.tournament.venueId = currentDraftVenueId;
      competitorState.tournament.liveId = exactVenueCompetitorId;
      competitorState.tournament.status = "running";
      competitorState.tournament.activeRegistryGeneration = "snapshot-competitor-generation";
      competitorState.updatedAt = Date.now() - 4000;
      const competitorPublicState = makePublicStatePayload(competitorState);
      window.__qaFirebaseStore.tournaments[exactVenueCompetitorId] = {
        state: JSON.parse(JSON.stringify(competitorState)),
        updatedAt: competitorState.updatedAt
      };
      window.__qaFirebaseStore.publicLive[exactVenueCompetitorId] = {
        id: exactVenueCompetitorId,
        registryGeneration: "snapshot-competitor-generation",
        status: "running",
        live: true,
        updatedAt: competitorState.updatedAt,
        state: competitorPublicState
      };
      window.__qaFirebaseStore.activeTournaments[currentDraftVenueId] = {
        venueId: currentDraftVenueId,
        tournamentId: exactVenueCompetitorId,
        registryGeneration: "snapshot-competitor-generation",
        status: "running",
        updatedAt: competitorState.updatedAt
      };
      const exactSnapshotKey = "qa-snapshot-exact-venue-key-v278";
      const exactSnapshotEntryId = "qa-snapshot-exact-venue-entry-v278";
      saveSnapshotMapV278({
        [exactSnapshotKey]: {
          id: exactSnapshotEntryId,
          key: exactSnapshotKey,
          tournamentId: exactVenueSnapshotId,
          label: "QA exact venue running snapshot",
          createdAt: new Date().toISOString(),
          state: JSON.parse(JSON.stringify(exactRunningState))
        }
      }, exactSnapshotKey);
      dbVenueIdDraft = currentDraftVenueId;
      state = normalizeImportedState(competitorState);
      firebaseTournamentId = exactVenueCompetitorId;
      localStorage.setItem("mini4wdTournamentId", exactVenueCompetitorId);
      localStorage.setItem("mini4wdActiveLiveId", exactVenueCompetitorId);
      localStorage.setItem("mini4wdActiveLiveSignature", competitorState.tournament.liveSignature || exactVenueCompetitorId);
      const exactRegistryBefore = JSON.parse(JSON.stringify(window.__qaFirebaseStore.activeTournaments[exactSnapshotVenueId]));
      const exactRegistryStartedLegacy = Boolean(
        !exactRegistryBefore.protocolVersion
        && !exactRegistryBefore.uid
        && !exactRegistryBefore.fenceToken
        && !exactRegistryBefore.fenceSequence
      );
      window.__qaFirebaseTransactionLog = [];
      await restoreSnapshot(exactSnapshotEntryId);
      const exactClaimLog = [...window.__qaFirebaseTransactionLog];
      const exactRegistryAfter = window.__qaFirebaseStore?.activeTournaments?.[exactSnapshotVenueId];
      const exactLeaseAfter = window.__qaFirebaseStore?.operationLocks?.leases?.[exactSnapshotVenueId];
      const competitorRegistryAfter = window.__qaFirebaseStore?.activeTournaments?.[currentDraftVenueId];
      const snapshotRestoreClaimsExactVenue = Boolean(
        exactRegistryStartedLegacy
        && state.tournament?.status === "running"
        && state.tournament?.name === "QA exact venue snapshot"
        && state.tournament?.liveId === exactVenueSnapshotId
        && state.tournament?.venueId === exactSnapshotVenueId
        && exactRegistryAfter?.protocolVersion === 279
        && exactRegistryAfter?.tournamentId === exactVenueSnapshotId
        && exactRegistryAfter?.registryGeneration === exactGeneration
        && exactRegistryAfter?.uid === "qa-uid"
        && exactRegistryAfter?.fenceToken === exactLeaseAfter?.fenceToken
        && Number(exactRegistryAfter?.fenceSequence || 0) === Number(exactLeaseAfter?.claimSequence || 0)
        && Number(exactRegistryAfter?.fenceSequence || 0) > 0
        && competitorRegistryAfter?.tournamentId === exactVenueCompetitorId
        && competitorRegistryAfter?.registryGeneration === "snapshot-competitor-generation"
        && exactClaimLog.includes(`activeTournaments/${exactSnapshotVenueId}`)
      );
      const snapshotRestoreClaimsExactVenueDebug = {
        stateStatus: state.tournament?.status,
        stateName: state.tournament?.name,
        stateLiveId: state.tournament?.liveId,
        stateVenueId: state.tournament?.venueId,
        exactRegistryStartedLegacy,
        exactRegistryBefore,
        exactRegistryAfter,
        exactLeaseAfter,
        competitorRegistryAfter,
        exactClaimLog
      };
      const forceEndCanonicalId = buildAutoTournamentId();
      window.__qaFirebaseTransactionLog = [];
      await forceEndTournament();
      await new Promise(resolve => setTimeout(resolve, 25));
      const forceEndedPrivate = window.__qaFirebaseStore?.tournaments?.[exactVenueSnapshotId]?.state;
      const forceEndedPublic = window.__qaFirebaseStore?.publicLive?.[exactVenueSnapshotId];
      const forceEndUniqueIdClosedExactRemote = Boolean(
        exactVenueSnapshotId !== forceEndCanonicalId
        && forceEndedPrivate?.tournament?.status === "finished"
        && forceEndedPrivate?.tournament?.finishSyncPending !== true
        && forceEndedPublic?.status === "finished"
        && forceEndedPublic?.live === false
        && !window.__qaFirebaseStore?.activeTournaments?.[exactSnapshotVenueId]
        && state.tournament?.status === "draft"
        && firebaseTournamentId !== exactVenueSnapshotId
        && !window.__qaFirebaseStore?.tournaments?.[forceEndCanonicalId]
      );
      const forceEndUniqueIdDebug = {
        forceEndCanonicalId,
        exactVenueSnapshotId,
        privateStatus: forceEndedPrivate?.tournament?.status,
        privatePending: forceEndedPrivate?.tournament?.finishSyncPending,
        publicStatus: forceEndedPublic?.status,
        publicLive: forceEndedPublic?.live,
        active: window.__qaFirebaseStore?.activeTournaments?.[exactSnapshotVenueId] || null,
        localStatus: state.tournament?.status,
        localFirebaseId: firebaseTournamentId,
        transactionLog: [...window.__qaFirebaseTransactionLog]
      };
      return {
        firstResult,
        privatePendingWrittenBeforePublic,
        pendingAfterFailure,
        statusAfterFailure,
        statusAfterBlockedPrepare,
        syncErrorAfterFailure,
        remotePrivatePendingAfterFailure,
        remoteScanRecoveredPendingFinish,
        noHistoryBeforeTerminalPublic,
        historyPublishedAfterTerminalAcceptance,
        repairBridgeLeaseExpiredBeforeRetry,
        repairBridgePublisherClaimBeforeTerminalAndFinalize,
        finishPublisherClockRefetched,
        finishFuturePublisherClaimReplaced,
        repairBridgePublisherTokenCleared,
        repairBridgeTransactionLog,
        repairBridgeEvents,
        retryResult,
        statusAfterRetry,
        remotePrivateStatus: remotePrivate?.tournament?.status || "",
        remotePrivatePending: Boolean(remotePrivate?.tournament?.finishSyncPending),
        remotePublicStatus: remotePublic?.state?.tournament?.status || "",
        remotePublicLive: remotePublic?.live,
        recoveredLiveIdPreserved: remotePublic?.id === tournamentId && !canonicalRemote,
        renderAutosaveHonorsNewerRunning,
        pendingCancelHidden,
        pendingPublicFallbackBlocked,
        staleLocalRetryHonorsNewerRunning,
        staleTerminalCreatedNoFalseHistory,
        staleLocalRetryMadeNoTerminalWrites,
        completedTerminalGenericSyncBlocked,
        snapshotRestoreCannotReviveTerminal,
        operatorUndoCannotReviveTerminal,
        snapshotRestoreRejectsLegacyGenerationMix,
        operatorUndoRejectsLegacyGenerationMix,
        snapshotRestoreClaimsExactVenue,
        snapshotRestoreClaimsExactVenueDebug,
        forceEndUniqueIdClosedExactRemote,
        forceEndUniqueIdDebug,
        staleLocalRetryDebug,
        canonicalTournamentId
      };
    } finally {
      Date.now = finishOriginalDateNow;
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      if (tournamentId) {
        delete window.__qaFirebaseStore?.tournaments?.[tournamentId];
        delete window.__qaFirebaseStore?.publicLive?.[tournamentId];
      }
      if (canonicalTournamentId) {
        delete window.__qaFirebaseStore?.tournaments?.[canonicalTournamentId];
        delete window.__qaFirebaseStore?.publicLive?.[canonicalTournamentId];
      }
      if (staleConflictId) {
        delete window.__qaFirebaseStore?.tournaments?.[staleConflictId];
        delete window.__qaFirebaseStore?.publicLive?.[staleConflictId];
      }
      if (completedTerminalId) {
        delete window.__qaFirebaseStore?.tournaments?.[completedTerminalId];
        delete window.__qaFirebaseStore?.publicLive?.[completedTerminalId];
      }
      if (snapshotRestoreId) {
        delete window.__qaFirebaseStore?.tournaments?.[snapshotRestoreId];
        delete window.__qaFirebaseStore?.publicLive?.[snapshotRestoreId];
      }
      if (mixedGenerationSnapshotId) {
        delete window.__qaFirebaseStore?.tournaments?.[mixedGenerationSnapshotId];
        delete window.__qaFirebaseStore?.publicLive?.[mixedGenerationSnapshotId];
      }
      if (exactVenueSnapshotId) {
        delete window.__qaFirebaseStore?.tournaments?.[exactVenueSnapshotId];
        delete window.__qaFirebaseStore?.publicLive?.[exactVenueSnapshotId];
      }
      if (exactVenueCompetitorId) {
        delete window.__qaFirebaseStore?.tournaments?.[exactVenueCompetitorId];
        delete window.__qaFirebaseStore?.publicLive?.[exactVenueCompetitorId];
      }
      delete window.__qaFirebaseStore?.activeTournaments?.[exactSnapshotVenueId];
      delete window.__qaFirebaseStore?.activeTournaments?.[currentDraftVenueId];
      if (finishRecordId) {
        delete window.__qaFirebaseStore?.privateResultLogs?.["qa-venue"]?.[finishRecordId];
        delete window.__qaFirebaseStore?.publicHistory?.[finishRecordId];
      }
      if (staleFalseHistoryId) {
        delete window.__qaFirebaseStore?.privateResultLogs?.["qa-venue"]?.[staleFalseHistoryId];
        delete window.__qaFirebaseStore?.publicHistory?.[staleFalseHistoryId];
      }
      if (activeRegistryBackup === undefined) delete window.__qaFirebaseStore?.activeTournaments?.["qa-venue"];
      else window.__qaFirebaseStore.activeTournaments["qa-venue"] = activeRegistryBackup;
      window.__qaFirebaseStore.operationLocks = window.__qaFirebaseStore.operationLocks || {};
      window.__qaFirebaseStore.operationLocks.leases = window.__qaFirebaseStore.operationLocks.leases || {};
      if (operationLeaseBackup === undefined) delete window.__qaFirebaseStore.operationLocks.leases["qa-venue"];
      else window.__qaFirebaseStore.operationLocks.leases["qa-venue"] = operationLeaseBackup;
      if (finishServerClock) {
        window.__qaFirebaseStore[".info"] = {
          ...(window.__qaFirebaseStore[".info"] || {}),
          serverTimeOffset: finishServerClockOffsetBackup
        };
        await finishServerClock.refresh(true);
      }
      if (finishServerInfoBackup === undefined) delete window.__qaFirebaseStore[".info"];
      else window.__qaFirebaseStore[".info"] = JSON.parse(JSON.stringify(finishServerInfoBackup));
      state = normalizeImportedState(backupState);
      activeRoundIndex = backupActiveRoundIndex;
      state.activeRoundIndex = backupActiveRoundIndex;
      firebaseTournamentId = backupFirebaseTournamentId;
      dbVenueIdDraft = backupDbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      renderOperator();
    }
  });
  logs.push({ step: "finish-sync-failure-v278", info: { finishSyncFailureV278 } });
  if (finishSyncFailureV278.firstResult !== false || !finishSyncFailureV278.privatePendingWrittenBeforePublic || !finishSyncFailureV278.pendingAfterFailure || !finishSyncFailureV278.remotePrivatePendingAfterFailure || !finishSyncFailureV278.remoteScanRecoveredPendingFinish || !finishSyncFailureV278.noHistoryBeforeTerminalPublic || !finishSyncFailureV278.historyPublishedAfterTerminalAcceptance || !finishSyncFailureV278.repairBridgeLeaseExpiredBeforeRetry || !finishSyncFailureV278.repairBridgePublisherClaimBeforeTerminalAndFinalize || !finishSyncFailureV278.finishPublisherClockRefetched || !finishSyncFailureV278.finishFuturePublisherClaimReplaced || !finishSyncFailureV278.repairBridgePublisherTokenCleared || finishSyncFailureV278.statusAfterFailure !== "finished" || finishSyncFailureV278.statusAfterBlockedPrepare !== "finished") {
    failures.push(`finish sync failure advanced or lost retry state ${JSON.stringify(finishSyncFailureV278)}`);
  }
  if (!finishSyncFailureV278.syncErrorAfterFailure || finishSyncFailureV278.retryResult !== true || finishSyncFailureV278.statusAfterRetry !== "draft" || finishSyncFailureV278.remotePrivateStatus !== "finished" || finishSyncFailureV278.remotePrivatePending || finishSyncFailureV278.remotePublicStatus !== "finished" || finishSyncFailureV278.remotePublicLive !== false || !finishSyncFailureV278.recoveredLiveIdPreserved || !finishSyncFailureV278.renderAutosaveHonorsNewerRunning || !finishSyncFailureV278.pendingCancelHidden || !finishSyncFailureV278.staleLocalRetryHonorsNewerRunning || !finishSyncFailureV278.staleTerminalCreatedNoFalseHistory || !finishSyncFailureV278.staleLocalRetryMadeNoTerminalWrites || !finishSyncFailureV278.completedTerminalGenericSyncBlocked || !finishSyncFailureV278.snapshotRestoreCannotReviveTerminal || !finishSyncFailureV278.operatorUndoCannotReviveTerminal || !finishSyncFailureV278.snapshotRestoreRejectsLegacyGenerationMix || !finishSyncFailureV278.operatorUndoRejectsLegacyGenerationMix || !finishSyncFailureV278.snapshotRestoreClaimsExactVenue || !finishSyncFailureV278.forceEndUniqueIdClosedExactRemote) {
    failures.push(`finish sync retry did not converge ${JSON.stringify(finishSyncFailureV278)}`);
  }

  const localTerminalConflictConvergenceV278 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft,
      tournaments: clone(store.tournaments),
      publicLive: clone(store.publicLive),
      activeTournaments: clone(store.activeTournaments),
      operationLocks: clone(store.operationLocks),
      privateResultLogs: clone(store.privateResultLogs),
      publicHistory: clone(store.publicHistory)
    };
    const storageKeys = [STORAGE_KEY, LOCAL_RESULT_LOGS_KEY, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const venueId = "qa-venue";
    const makeFinished = (id, generation, terminalAt, recordId, pending = false) => {
      const next = makeInitialState(3);
      next.inputText = "Conflict A/QA\nConflict B/QA";
      next.tournament = {
        ...next.tournament,
        name: `QA terminal ${id}`,
        venue: "QA Venue",
        venueId,
        status: "finished",
        liveId: id,
        liveSignature: `${id}-signature`,
        activeRegistryGeneration: generation,
        startedAtISO: new Date(terminalAt - 60000).toISOString(),
        endedAtISO: new Date(terminalAt).toISOString(),
        endedAtDisplay: formatDateTimeLocal(new Date(terminalAt)),
        finishSyncPending: pending,
        finishSyncTerminalUpdatedAt: terminalAt,
        finishSyncPreviousUpdatedAt: terminalAt - 1000,
        finishSyncRecord: {
          id: recordId,
          venueId,
          venueName: "QA Venue",
          tournamentName: `QA false history ${recordId}`,
          rows: []
        }
      };
      next.updatedAt = terminalAt;
      return next;
    };
    const makeDivergentPublic = (id, generation, terminalAt) => ({
      id,
      registryGeneration: generation,
      status: "finished",
      live: false,
      updatedAt: terminalAt,
      state: {
        tournament: {
          status: "finished",
          activeRegistryGeneration: generation,
          endedAtISO: new Date(terminalAt).toISOString()
        },
        updatedAt: terminalAt
      }
    });
    const installExactOwnership = async (id, generation, sequence) => {
      store.activeTournaments[venueId] = {
        venueId,
        tournamentId: id,
        registryGeneration: generation,
        status: "running",
        updatedAt: Date.now()
      };
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      store.operationLocks.leases[venueId] = {
        scope: "venue",
        venueId,
        tournamentId: id,
        registryGeneration: generation,
        sessionId: window.__mini4wdOperatorSession?.sessionId || "",
        claimSequence: sequence,
        fenceSequenceHighWater: sequence,
        fenceToken: `qa-terminal-conflict-fence-${sequence}`,
        status: "running",
        leaseUntil: Date.now() + 60000,
        updatedAt: Date.now()
      };
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
    };
    const installLocal = next => {
      state = normalizeImportedState(next);
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = next.tournament.liveId;
      dbVenueIdDraft = "";
      localStorage.setItem("mini4wdTournamentId", next.tournament.liveId);
      localStorage.setItem("mini4wdActiveLiveId", next.tournament.liveId);
      localStorage.setItem("mini4wdActiveLiveSignature", next.tournament.liveSignature);
      localStorage.removeItem(LOCAL_RESULT_LOGS_KEY);
    };
    try {
      const directId = "qa-local-divergent-terminal-v278";
      const directGeneration = "qa-local-divergent-generation-v278";
      const directRecordId = "qa-local-divergent-history-v278";
      const directAt = Date.now() - 30000;
      const directLocal = makeFinished(directId, directGeneration, directAt, directRecordId, false);
      installLocal(directLocal);
      delete store.tournaments[directId];
      store.publicLive[directId] = makeDivergentPublic(directId, directGeneration, directAt + 5000);
      await installExactOwnership(directId, directGeneration, 701);
      window.__qaFirebaseTransactionLog = [];
      const directResult = await syncFinishedTournamentAndAdvanceV278("qa-local-divergent-terminal-v278");
      await new Promise(resolve => setTimeout(resolve, 0));
      const directPrivate = store.tournaments?.[directId]?.state || store.tournaments?.[directId];
      const directPublic = store.publicLive?.[directId];
      const directLease = store.operationLocks?.leases?.[venueId];
      const directConvergedWithoutFalseHistory = Boolean(
        directResult === true
        && state.tournament?.status === "draft"
        && directPrivate?.tournament?.finishSyncPending === false
        && directPrivate?.tournament?.terminalSyncConflictV278?.reason === "divergent-terminal-public"
        && terminalAttemptIdentityV278(directPublic) !== terminalAttemptIdentityV278(directPrivate)
        && !store.privateResultLogs?.[venueId]?.[directRecordId]
        && !store.publicHistory?.[directRecordId]
        && !store.activeTournaments?.[venueId]
        && directLease?.status === "released"
      );

      const retryId = "qa-local-retired-retry-v278";
      const retryGeneration = "qa-local-retired-generation-v278";
      const retryRecordId = "qa-local-retired-history-v278";
      const retryAt = directAt + 1000;
      const retryLocal = makeFinished(retryId, retryGeneration, retryAt, retryRecordId, true);
      const retryRemote = clone(retryLocal);
      retryRemote.tournament.finishSyncPending = false;
      retryRemote.tournament.finishSyncError = "conflict retired";
      retryRemote.tournament.terminalSyncConflictV278 = {
        kind: "finish",
        reason: "divergent-terminal-public",
        privateAttemptId: terminalAttemptIdentityV278(retryRemote),
        publicAttemptId: new Date(retryAt + 5000).toISOString(),
        detectedAt: new Date().toISOString()
      };
      installLocal(retryLocal);
      store.tournaments[retryId] = { state: clone(retryRemote), updatedAt: retryRemote.updatedAt };
      store.publicLive[retryId] = makeDivergentPublic(retryId, retryGeneration, retryAt + 5000);
      await installExactOwnership(retryId, retryGeneration, 702);
      window.__qaFirebaseTransactionLog = [];
      const retryResult = await syncFinishedTournamentAndAdvanceV278("qa-local-retired-retry-v278");
      await new Promise(resolve => setTimeout(resolve, 0));
      const retryTransactionLog = [...window.__qaFirebaseTransactionLog];
      const retiredRetryConvergedWithoutRepending = Boolean(
        retryResult === true
        && state.tournament?.status === "draft"
        && store.tournaments?.[retryId]?.state?.tournament?.finishSyncPending === false
        && !retryTransactionLog.includes(`tournaments/${retryId}`)
        && !retryTransactionLog.includes(`publicLive/${retryId}`)
        && !store.privateResultLogs?.[venueId]?.[retryRecordId]
        && !store.publicHistory?.[retryRecordId]
        && !store.activeTournaments?.[venueId]
        && store.operationLocks?.leases?.[venueId]?.status === "released"
      );

      const manualId = "qa-manual-retired-terminal-v278";
      const manualGeneration = "qa-manual-retired-generation-v278";
      const manualRecordId = "qa-manual-retired-history-v278";
      const manualAt = retryAt + 1000;
      const manualState = makeFinished(manualId, manualGeneration, manualAt, manualRecordId, false);
      manualState.tournament.terminalSyncConflictV278 = {
        kind: "finish",
        reason: "divergent-terminal-public",
        privateAttemptId: terminalAttemptIdentityV278(manualState),
        publicAttemptId: new Date(manualAt + 5000).toISOString(),
        detectedAt: new Date().toISOString()
      };
      installLocal(manualState);
      store.tournaments[manualId] = { state: clone(manualState), updatedAt: manualState.updatedAt };
      await installExactOwnership(manualId, manualGeneration, 703);
      await prepareNewTournamentFromFinished();
      await new Promise(resolve => setTimeout(resolve, 0));
      const manualRolloverSkippedConflictHistory = Boolean(
        state.tournament?.status === "draft"
        && !store.privateResultLogs?.[venueId]?.[manualRecordId]
        && !store.publicHistory?.[manualRecordId]
        && !store.activeTournaments?.[venueId]
        && store.operationLocks?.leases?.[venueId]?.status === "released"
      );
      return {
        directConvergedWithoutFalseHistory,
        retiredRetryConvergedWithoutRepending,
        manualRolloverSkippedConflictHistory,
        directResult,
        retryResult,
        directConflict: directPrivate?.tournament?.terminalSyncConflictV278 || null,
        directLease,
        retryTransactionLog
      };
    } finally {
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      store.tournaments = backup.tournaments;
      store.publicLive = backup.publicLive;
      store.activeTournaments = backup.activeTournaments;
      store.operationLocks = backup.operationLocks;
      store.privateResultLogs = backup.privateResultLogs;
      store.publicHistory = backup.publicHistory;
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      renderOperator();
    }
  });
  logs.push({ step: "local-terminal-conflict-convergence-v278", info: { localTerminalConflictConvergenceV278 } });
  if (!localTerminalConflictConvergenceV278.directConvergedWithoutFalseHistory || !localTerminalConflictConvergenceV278.retiredRetryConvergedWithoutRepending || !localTerminalConflictConvergenceV278.manualRolloverSkippedConflictHistory) {
    failures.push(`local terminal conflict did not converge safely ${JSON.stringify(localTerminalConflictConvergenceV278)}`);
  }

  const optionalKeyFallbackV278 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft,
      malformedTournament: clone(store.tournaments?.["qa-missing-venue-v278"]),
      malformedPublic: clone(store.publicLive?.["qa-missing-venue-v278"]),
      defaultActive: clone(store.activeTournaments?.default),
      exactLease: clone(store.operationLocks?.leases?.["qa-venue"])
    };
    const storageKeys = ["mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    try {
      state = makeInitialState(3);
      state.tournament.name = "QA Optional Key Fallback";
      state.tournament.venue = "QA Venue";
      state.tournament.venueId = "";
      state.tournament.liveId = "";
      state.tournament.status = "draft";
      dbVenueIdDraft = "";
      firebaseTournamentId = "";
      storageKeys.forEach(key => localStorage.removeItem(key));
      const freshAdminDraftUsesVenueName = currentVenueId() === "qa-venue";

      state.tournament.status = "running";
      state.tournament.startedAtISO = new Date().toISOString();
      const legacyRunningId = getWritableTournamentIdV278(state);
      const legacyRunningPublicId = makePublicLivePayload(exportState()).id;
      const legacyRunningBlankIdAvoidsDefault = Boolean(
        legacyRunningId
        && legacyRunningId !== "default"
        && legacyRunningPublicId === legacyRunningId
        && state.tournament.liveId === legacyRunningId
      );

      state.tournament.status = "finished";
      state.tournament.liveId = "";
      state.tournament.endedAtISO = new Date().toISOString();
      firebaseTournamentId = "";
      storageKeys.forEach(key => localStorage.removeItem(key));
      const legacyTerminalId = getWritableTournamentIdV278(state);
      const legacyTerminalPublicId = makePublicLivePayload(exportState()).id;
      const legacyTerminalBlankIdAvoidsDefault = Boolean(
        legacyTerminalId
        && legacyTerminalId !== "default"
        && legacyTerminalPublicId === legacyTerminalId
      );

      const malformedId = "qa-missing-venue-v278";
      const malformed = makeInitialState(3);
      malformed.tournament = {
        ...malformed.tournament,
        name: "QA malformed venue",
        venue: "",
        venueId: "",
        venueName: "",
        status: "running",
        liveId: malformedId,
        activeRegistryGeneration: "qa-missing-venue-generation-v278"
      };
      malformed.updatedAt = Date.now();
      store.tournaments[malformedId] = { state: clone(malformed), updatedAt: malformed.updatedAt };
      store.publicLive[malformedId] = {
        id: malformedId,
        registryGeneration: malformed.tournament.activeRegistryGeneration,
        status: "running",
        live: true,
        updatedAt: malformed.updatedAt,
        state: makePublicStatePayload(malformed)
      };
      store.activeTournaments.default = {
        venueId: "default",
        tournamentId: malformedId,
        registryGeneration: malformed.tournament.activeRegistryGeneration,
        status: "running",
        updatedAt: malformed.updatedAt
      };
      const malformedVerification = await readVerifiedRunningTournamentV278(initFirebase(), malformedId);
      const malformedVenueRejectedBeforeDefaultRegistry = Boolean(
        malformedVerification.valid === false
        && malformedVerification.reason === "missing-venue"
      );
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      store.operationLocks.leases["qa-venue"] = {
        scope: "venue",
        venueId: "qa-venue",
        tournamentId: "qa-new-overlap-target-v278",
        registryGeneration: "qa-new-overlap-generation-v278",
        sessionId: window.__mini4wdOperatorSession?.sessionId || "",
        claimSequence: 880,
        fenceSequenceHighWater: 880,
        fenceToken: "qa-new-overlap-fence-v278",
        status: "running",
        leaseUntil: Date.now() + 60000,
        updatedAt: Date.now()
      };
      await releaseClaimedOperationLeaseExactV278(
        "qa-venue",
        "qa-old-overlap-target-v278",
        "qa-old-overlap-generation-v278"
      );
      const overlapLease = store.operationLocks?.leases?.["qa-venue"];
      const staleCleanupPreservedNewExactLease = Boolean(
        overlapLease?.tournamentId === "qa-new-overlap-target-v278"
        && overlapLease?.registryGeneration === "qa-new-overlap-generation-v278"
        && overlapLease?.sessionId === (window.__mini4wdOperatorSession?.sessionId || "")
        && overlapLease?.status === "running"
      );
      return {
        freshAdminDraftUsesVenueName,
        legacyRunningBlankIdAvoidsDefault,
        legacyTerminalBlankIdAvoidsDefault,
        malformedVenueRejectedBeforeDefaultRegistry,
        staleCleanupPreservedNewExactLease,
        legacyRunningId,
        legacyRunningPublicId,
        legacyTerminalId,
        legacyTerminalPublicId,
        malformedReason: malformedVerification.reason
      };
    } finally {
      const restore = (collection, key, value) => value === undefined ? delete collection[key] : (collection[key] = value);
      restore(store.tournaments, "qa-missing-venue-v278", backup.malformedTournament);
      restore(store.publicLive, "qa-missing-venue-v278", backup.malformedPublic);
      restore(store.activeTournaments, "default", backup.defaultActive);
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      restore(store.operationLocks.leases, "qa-venue", backup.exactLease);
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "optional-key-fallback-v278", info: { optionalKeyFallbackV278 } });
  if (!optionalKeyFallbackV278.freshAdminDraftUsesVenueName || !optionalKeyFallbackV278.legacyRunningBlankIdAvoidsDefault || !optionalKeyFallbackV278.legacyTerminalBlankIdAvoidsDefault || !optionalKeyFallbackV278.malformedVenueRejectedBeforeDefaultRegistry || !optionalKeyFallbackV278.staleCleanupPreservedNewExactLease) {
    failures.push(`optional venue/live key fell through to default sentinel ${JSON.stringify(optionalKeyFallbackV278)}`);
  }

  const currentAutoCloseExactLeaseReleaseV278 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft,
      tournaments: clone(store.tournaments),
      publicLive: clone(store.publicLive),
      activeTournaments: clone(store.activeTournaments),
      operationLocks: clone(store.operationLocks),
      privateResultLogs: clone(store.privateResultLogs),
      publicHistory: clone(store.publicHistory)
    };
    const storageKeys = [STORAGE_KEY, LOCAL_SNAPSHOT_KEY, LOCAL_RESULT_LOGS_KEY, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const id = "qa-current-auto-close-lease-v278";
    const venueId = "qa-venue";
    const generation = "qa-current-auto-close-generation-v278";
    const fenceToken = "qa-current-auto-close-fence-v278";
    const fenceSequence = 991;
    try {
      const staleAt = Date.now() - (61 * 60 * 1000);
      const running = makeInitialState(3);
      running.inputText = "Auto Close A/QA\nAuto Close B/QA";
      running.settings = { ...running.settings, firebaseAutoSave: true };
      running.tournament = {
        ...running.tournament,
        name: "QA Current Auto Close Lease",
        venue: "QA Venue",
        venueId,
        status: "running",
        liveId: id,
        liveSignature: `${id}-signature`,
        activeRegistryGeneration: generation,
        liveWriteFenceV278: fenceToken,
        liveWriteFenceSequenceV278: fenceSequence,
        startedAtISO: new Date(staleAt - 60000).toISOString()
      };
      running.updatedAt = staleAt;
      state = normalizeImportedState(running);
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = id;
      dbVenueIdDraft = "";
      localStorage.setItem("mini4wdTournamentId", id);
      localStorage.setItem("mini4wdActiveLiveId", id);
      localStorage.setItem("mini4wdActiveLiveSignature", running.tournament.liveSignature);
      store.tournaments[id] = { state: clone(running), updatedAt: staleAt };
      store.publicLive[id] = makePublicLivePayload(running);
      store.activeTournaments[venueId] = {
        venueId,
        venueName: "QA Venue",
        tournamentId: id,
        registryGeneration: generation,
        tournamentName: running.tournament.name,
        status: "running",
        updatedAt: staleAt
      };
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      store.operationLocks.leases[venueId] = {
        scope: "venue",
        venueId,
        tournamentId: id,
        registryGeneration: generation,
        sessionId: window.__mini4wdOperatorSession?.sessionId || "",
        claimSequence: fenceSequence,
        fenceSequenceHighWater: fenceSequence,
        fenceToken,
        status: "running",
        leaseUntil: Date.now() + 60000,
        updatedAt: Date.now()
      };
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      const result = await window.closeCurrentTournamentV135("qa-current-auto-close-exact-lease-v278");
      await new Promise(resolve => setTimeout(resolve, 0));
      const privateState = store.tournaments?.[id]?.state || store.tournaments?.[id];
      const publicState = store.publicLive?.[id];
      const lease = store.operationLocks?.leases?.[venueId];
      return {
        result,
        privateStatus: privateState?.tournament?.status || "",
        privatePending: Boolean(privateState?.tournament?.finishSyncPending),
        publicStatus: publicState?.status || publicState?.state?.tournament?.status || "",
        activeRemoved: !store.activeTournaments?.[venueId],
        leaseReleased: Boolean(
          lease?.tournamentId === id
          && lease?.registryGeneration === generation
          && lease?.status === "released"
          && !lease?.sessionId
          && Number(lease?.leaseUntil || 0) === 0
        )
      };
    } finally {
      store.tournaments = backup.tournaments;
      store.publicLive = backup.publicLive;
      store.activeTournaments = backup.activeTournaments;
      store.operationLocks = backup.operationLocks;
      store.privateResultLogs = backup.privateResultLogs;
      store.publicHistory = backup.publicHistory;
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "current-auto-close-exact-lease-release-v278", info: { currentAutoCloseExactLeaseReleaseV278 } });
  if (currentAutoCloseExactLeaseReleaseV278.result !== true || currentAutoCloseExactLeaseReleaseV278.privateStatus !== "finished" || currentAutoCloseExactLeaseReleaseV278.privatePending || currentAutoCloseExactLeaseReleaseV278.publicStatus !== "finished" || !currentAutoCloseExactLeaseReleaseV278.activeRemoved || !currentAutoCloseExactLeaseReleaseV278.leaseReleased) {
    failures.push(`current auto-close left stale ownership ${JSON.stringify(currentAutoCloseExactLeaseReleaseV278)}`);
  }

  const manualFinishLeasePreflightV279 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft,
      tournaments: clone(store.tournaments),
      publicLive: clone(store.publicLive),
      activeTournaments: clone(store.activeTournaments),
      operationLocks: clone(store.operationLocks),
      privateResultLogs: clone(store.privateResultLogs),
      publicHistory: clone(store.publicHistory)
    };
    const storageKeys = [STORAGE_KEY, LOCAL_SNAPSHOT_KEY, LOCAL_RESULT_LOGS_KEY, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const sessionId = window.__mini4wdOperatorSession?.sessionId || "";
    const sessionLineageId = window.__mini4wdOperatorSession?.lineageId || "qa-lineage-v279";
    const now = () => window.__mini4wdFirebaseServerClockV279?.now?.() || Date.now();
    const originalConfirm = window.confirm;

    const makeRunning = ({ id, venueId, generation, fenceToken, fenceSequence, ready, updatedAt }) => {
      const next = makeInitialState(3);
      const winner = { id: `${id}-winner`, name: "Finish Winner", nickname: "Winner", team: "QA", lane: 1 };
      const runnerUp = { id: `${id}-runner-up`, name: "Finish Runner Up", nickname: "Runner Up", team: "QA", lane: 2 };
      next.inputText = "Finish Winner/QA\nFinish Runner Up/QA";
      next.settings = { ...next.settings, laneCount: 3, matchMode: "basic", firebaseAutoSave: true };
      next.tournament = {
        ...next.tournament,
        name: `QA Manual Finish ${id}`,
        venue: `QA Venue ${venueId}`,
        venueId,
        raceClass: "오픈",
        status: "running",
        liveId: id,
        liveSignature: `${id}-signature`,
        recordId: `${id}-history`,
        activeRegistryGeneration: generation,
        liveWriteFenceV278: fenceToken,
        liveWriteFenceSequenceV278: fenceSequence,
        startedAtISO: new Date(updatedAt - 60000).toISOString()
      };
      next.finalRace = ready ? {
        id: `${id}-final`,
        type: "final",
        groups: [{
          id: `${id}-final-group`,
          name: "결승",
          slots: [winner, runnerUp],
          advanceIds: [winner.id]
        }]
      } : null;
      next.broadcast = { mode: "final" };
      next.activeRoundIndex = 0;
      next.updatedAt = updatedAt;
      return normalizeImportedState(next);
    };

    const installRunning = async ({ id, venueId, generation, fenceToken, fenceSequence, localReady = true, remoteReady = true, remoteNewer = false, foreignSession = false }) => {
      const localUpdatedAt = now() - 5000;
      const remoteUpdatedAt = remoteNewer ? localUpdatedAt + 2000 : localUpdatedAt;
      const local = makeRunning({ id, venueId, generation, fenceToken, fenceSequence, ready: localReady, updatedAt: localUpdatedAt });
      const remote = makeRunning({ id, venueId, generation, fenceToken, fenceSequence, ready: remoteReady, updatedAt: remoteUpdatedAt });
      state = normalizeImportedState(local);
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = id;
      dbVenueIdDraft = "";
      localStorage.setItem("mini4wdTournamentId", id);
      localStorage.setItem("mini4wdActiveLiveId", id);
      localStorage.setItem("mini4wdActiveLiveSignature", local.tournament.liveSignature);
      persistCurrentState();
      store.tournaments[id] = tournamentRecordWithStateV278(null, clone(remote));
      store.publicLive[id] = makePublicLivePayload(remote);
      store.activeTournaments[venueId] = {
        protocolVersion: 279,
        venueId,
        venueName: remote.tournament.venue,
        uid: "qa-uid",
        tournamentId: id,
        registryGeneration: generation,
        tournamentName: remote.tournament.name,
        status: "running",
        fenceToken,
        fenceSequence,
        updatedAt: remoteUpdatedAt
      };
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      store.operationLocks.leases[venueId] = {
        protocolVersion: 279,
        scope: "venue",
        venueId,
        venueName: remote.tournament.venue,
        uid: "qa-uid",
        email: "qa-venue@example.com",
        sessionId: foreignSession ? `${sessionId}-foreign` : sessionId,
        sessionLineageId: foreignSession ? `${sessionLineageId}-foreign` : sessionLineageId,
        claimSequence: fenceSequence,
        fenceSequenceHighWater: fenceSequence,
        fenceToken,
        tournamentId: id,
        registryGeneration: generation,
        tournamentName: remote.tournament.name,
        status: "running",
        reason: "qa-manual-finish-preflight-v279",
        leaseUntil: now() + 60000,
        clientUpdatedAt: now(),
        updatedAt: now(),
        build: "qa-v279"
      };
      await refreshOperationLeaseV178();
      return { local, remote };
    };

    const historyFor = id => ({
      privateRecord: Object.values(store.privateResultLogs || {}).flatMap(records => Object.values(records || {})).find(record => record?.sourceTournamentId === id) || null,
      publicRecord: Object.values(store.publicHistory || {}).find(record => record?.sourceTournamentId === id) || null
    });

    try {
      const success = {
        id: "qa-manual-finish-renew-v279",
        venueId: "qa-manual-finish-renew-venue-v279",
        generation: "qa-manual-finish-renew-generation-v279",
        fenceToken: "qa-manual-finish-renew-fence-v279",
        fenceSequence: 1201
      };
      await installRunning(success);
      // Keep the cached copy fresh while expiring the authoritative value to
      // reproduce the boundary between the synchronous UI guard and the
      // awaited server-side finish preflight.
      store.operationLocks.leases[success.venueId].leaseUntil = now() - 1000;
      const successEvents = [];
      window.__qaFirebaseTransactionLog = [];
      window.__qaBeforeFirebaseTransaction = path => {
        if (![ `operationLocks/leases/${success.venueId}`, `tournaments/${success.id}`, `publicLive/${success.id}` ].includes(path)) return;
        const privateState = store.tournaments?.[success.id]?.state || store.tournaments?.[success.id];
        const lease = store.operationLocks?.leases?.[success.venueId];
        successEvents.push({
          path,
          privateStatus: privateState?.tournament?.status || "",
          privatePending: Boolean(privateState?.tournament?.finishSyncPending),
          leaseSessionId: lease?.sessionId || "",
          leaseUntil: Number(lease?.leaseUntil || 0)
        });
      };
      await finishTournamentAsyncV116();
      await new Promise(resolve => setTimeout(resolve, 25));
      window.__qaBeforeFirebaseTransaction = null;
      const successLog = [...window.__qaFirebaseTransactionLog];
      const leaseIndex = successLog.indexOf(`operationLocks/leases/${success.venueId}`);
      const privateIndices = successLog.reduce((indices, path, index) => path === `tournaments/${success.id}` ? [...indices, index] : indices, []);
      const terminalEntry = successEvents.filter(event => event.path === `tournaments/${success.id}`)[1] || null;
      const publicEntry = successEvents.find(event => event.path === `publicLive/${success.id}`) || null;
      const successPrivateRecord = store.tournaments?.[success.id];
      const successPrivate = successPrivateRecord?.state || successPrivateRecord;
      const successPublic = store.publicLive?.[success.id];
      const successLease = store.operationLocks?.leases?.[success.venueId];
      const successHistory = historyFor(success.id);
      const expiredSameSessionRenewedBeforeTerminal = Boolean(
        leaseIndex >= 0
        && privateIndices.length >= 2
        && leaseIndex < privateIndices[1]
        && terminalEntry?.privateStatus === "running"
        && terminalEntry?.leaseSessionId === sessionId
        && terminalEntry.leaseUntil > now()
        && publicEntry?.privateStatus === "finished"
        && publicEntry?.privatePending === true
      );
      const successConverged = Boolean(
        successPrivateRecord?.protocolVersion === 279
        && successPrivate?.tournament?.status === "finished"
        && successPrivate?.tournament?.finishSyncPending !== true
        && successPublic?.status === "finished"
        && successPublic?.live === false
        && !store.activeTournaments?.[success.venueId]
        && successLease?.status === "released"
        && !successLease?.sessionId
        && Number(successLease?.leaseUntil || 0) === 0
        && successHistory.privateRecord?.id === success.id
        && successHistory.publicRecord?.id === success.id
        && state.tournament?.status === "draft"
      );

      const foreign = {
        id: "qa-manual-finish-foreign-v279",
        venueId: "qa-manual-finish-foreign-venue-v279",
        generation: "qa-manual-finish-foreign-generation-v279",
        fenceToken: "qa-manual-finish-foreign-fence-v279",
        fenceSequence: 1202,
        foreignSession: true
      };
      await installRunning(foreign);
      window.__qaFirebaseTransactionLog = [];
      await finishTournamentAsyncV116();
      await new Promise(resolve => setTimeout(resolve, 10));
      const foreignLog = [...window.__qaFirebaseTransactionLog];
      const foreignPrivate = store.tournaments?.[foreign.id]?.state || store.tournaments?.[foreign.id];
      const foreignPublic = store.publicLive?.[foreign.id];
      const foreignLease = store.operationLocks?.leases?.[foreign.venueId];
      const foreignHistory = historyFor(foreign.id);
      const foreignLeaseAbortedWithoutTerminalWrites = Boolean(
        state.tournament?.status === "running"
        && !state.tournament?.endedAtISO
        && state.tournament?.finishSyncPending !== true
        && foreignPrivate?.tournament?.status === "running"
        && foreignPrivate?.tournament?.finishSyncPending !== true
        && foreignPublic?.status === "running"
        && foreignPublic?.live === true
        && store.activeTournaments?.[foreign.venueId]?.tournamentId === foreign.id
        && foreignLease?.sessionId === `${sessionId}-foreign`
        && Number(foreignLease?.leaseUntil || 0) > now()
        && !foreignHistory.privateRecord
        && !foreignHistory.publicRecord
        && !foreignLog.includes(`tournaments/${foreign.id}`)
        && !foreignLog.includes(`publicLive/${foreign.id}`)
      );

      const unready = {
        id: "qa-manual-finish-unready-v279",
        venueId: "qa-manual-finish-unready-venue-v279",
        generation: "qa-manual-finish-unready-generation-v279",
        fenceToken: "qa-manual-finish-unready-fence-v279",
        fenceSequence: 1203,
        localReady: true,
        remoteReady: false,
        remoteNewer: true
      };
      await installRunning(unready);
      store.operationLocks.leases[unready.venueId].leaseUntil = now() - 1000;
      window.__qaFirebaseTransactionLog = [];
      await finishTournamentAsyncV116();
      await new Promise(resolve => setTimeout(resolve, 10));
      const unreadyLog = [...window.__qaFirebaseTransactionLog];
      const unreadyPrivate = store.tournaments?.[unready.id]?.state || store.tournaments?.[unready.id];
      const unreadyPublic = store.publicLive?.[unready.id];
      const unreadyLease = store.operationLocks?.leases?.[unready.venueId];
      const unreadyHistory = historyFor(unready.id);
      const authoritativeUnreadyAbortedWithoutTerminalWrites = Boolean(
        unreadyLog.includes(`operationLocks/leases/${unready.venueId}`)
        && unreadyLog.filter(path => path === `tournaments/${unready.id}`).length === 1
        && !unreadyLog.includes(`publicLive/${unready.id}`)
        && state.tournament?.status === "running"
        && !state.finalRace
        && !state.tournament?.endedAtISO
        && state.tournament?.finishSyncPending !== true
        && unreadyPrivate?.tournament?.status === "running"
        && !unreadyPrivate?.finalRace
        && unreadyPublic?.status === "running"
        && unreadyPublic?.live === true
        && unreadyLease?.sessionId === sessionId
        && Number(unreadyLease?.leaseUntil || 0) > now()
        && !unreadyHistory.privateRecord
        && !unreadyHistory.publicRecord
      );

      const forceSuccess = {
        id: "qa-force-end-renew-v279",
        venueId: "qa-force-end-renew-venue-v279",
        generation: "qa-force-end-renew-generation-v279",
        fenceToken: "qa-force-end-renew-fence-v279",
        fenceSequence: 1301
      };
      await installRunning(forceSuccess);
      store.operationLocks.leases[forceSuccess.venueId].leaseUntil = now() - 1000;
      const forceSuccessEvents = [];
      window.__qaFirebaseTransactionLog = [];
      window.__qaBeforeFirebaseTransaction = path => {
        if (![ `operationLocks/leases/${forceSuccess.venueId}`, `tournaments/${forceSuccess.id}`, `publicLive/${forceSuccess.id}` ].includes(path)) return;
        const privateState = store.tournaments?.[forceSuccess.id]?.state || store.tournaments?.[forceSuccess.id];
        const lease = store.operationLocks?.leases?.[forceSuccess.venueId];
        forceSuccessEvents.push({
          path,
          privateStatus: privateState?.tournament?.status || "",
          privatePending: Boolean(privateState?.tournament?.finishSyncPending),
          leaseSessionId: lease?.sessionId || "",
          leaseUntil: Number(lease?.leaseUntil || 0),
          leaseReason: lease?.reason || ""
        });
      };
      await forceEndTournament();
      await new Promise(resolve => setTimeout(resolve, 25));
      window.__qaBeforeFirebaseTransaction = null;
      const forceSuccessLog = [...window.__qaFirebaseTransactionLog];
      const forceLeaseIndex = forceSuccessLog.indexOf(`operationLocks/leases/${forceSuccess.venueId}`);
      const forcePublicIndex = forceSuccessLog.indexOf(`publicLive/${forceSuccess.id}`);
      const forcePrivateIndices = forceSuccessLog.reduce((indices, path, index) => path === `tournaments/${forceSuccess.id}` ? [...indices, index] : indices, []);
      const forceTerminalPrivateIndex = Math.max(-1, ...forcePrivateIndices.filter(index => forcePublicIndex < 0 || index < forcePublicIndex));
      const forcePrePublicEvents = forceSuccessEvents.slice(0, forceSuccessEvents.findIndex(event => event.path === `publicLive/${forceSuccess.id}`));
      const forcePrePublicPrivateEvents = forcePrePublicEvents.filter(event => event.path === `tournaments/${forceSuccess.id}`);
      const forceTerminalEntry = forcePrePublicPrivateEvents[forcePrePublicPrivateEvents.length - 1] || null;
      const forcePublicEntry = forceSuccessEvents.find(event => event.path === `publicLive/${forceSuccess.id}`) || null;
      const forceSuccessPrivateRecord = store.tournaments?.[forceSuccess.id];
      const forceSuccessPrivate = forceSuccessPrivateRecord?.state || forceSuccessPrivateRecord;
      const forceSuccessPublic = store.publicLive?.[forceSuccess.id];
      const forceSuccessLease = store.operationLocks?.leases?.[forceSuccess.venueId];
      const forceEndExpiredLeaseReclaimedBeforeTerminal = Boolean(
        forceLeaseIndex >= 0
        && forceTerminalPrivateIndex > forceLeaseIndex
        && forceTerminalEntry?.privateStatus === "running"
        && forceTerminalEntry?.leaseSessionId === sessionId
        && forceTerminalEntry.leaseUntil > now()
        && forceTerminalEntry?.leaseReason === "force-end-preflight-v279"
        && forcePublicEntry?.privateStatus === "finished"
        && forcePublicEntry?.privatePending === true
      );
      const forceEndExpiredLeaseConverged = Boolean(
        forceSuccessPrivateRecord?.protocolVersion === 279
        && forceSuccessPrivate?.tournament?.status === "finished"
        && forceSuccessPrivate?.tournament?.finishSyncPending !== true
        && forceSuccessPublic?.status === "finished"
        && forceSuccessPublic?.live === false
        && !store.activeTournaments?.[forceSuccess.venueId]
        && forceSuccessLease?.status === "released"
        && !forceSuccessLease?.sessionId
        && Number(forceSuccessLease?.leaseUntil || 0) === 0
        && state.tournament?.status === "draft"
      );

      const forceForeign = {
        id: "qa-force-end-foreign-v279",
        venueId: "qa-force-end-foreign-venue-v279",
        generation: "qa-force-end-foreign-generation-v279",
        fenceToken: "qa-force-end-foreign-fence-v279",
        fenceSequence: 1302
      };
      await installRunning(forceForeign);
      let forceForeignConfirmCount = 0;
      window.confirm = () => {
        forceForeignConfirmCount += 1;
        if (forceForeignConfirmCount === 2) {
          const currentLease = store.operationLocks?.leases?.[forceForeign.venueId] || {};
          store.operationLocks.leases[forceForeign.venueId] = {
            ...currentLease,
            sessionId: `${sessionId}-foreign`,
            sessionLineageId: `${sessionLineageId}-foreign`,
            leaseUntil: now() + 60000,
            clientUpdatedAt: now(),
            updatedAt: now(),
            reason: "qa-force-end-confirm-foreign-v279"
          };
        }
        return true;
      };
      window.__qaFirebaseTransactionLog = [];
      const forceForeignResult = await forceEndTournament();
      window.confirm = originalConfirm;
      await new Promise(resolve => setTimeout(resolve, 10));
      const forceForeignLog = [...window.__qaFirebaseTransactionLog];
      const forceForeignPrivate = store.tournaments?.[forceForeign.id]?.state || store.tournaments?.[forceForeign.id];
      const forceForeignPublic = store.publicLive?.[forceForeign.id];
      const forceForeignLease = store.operationLocks?.leases?.[forceForeign.venueId];
      const forceForeignHistory = historyFor(forceForeign.id);
      const forceEndForeignLeaseAbortedWithoutTerminalWrites = Boolean(
        forceForeignResult === false
        && forceForeignConfirmCount === 2
        && forceForeignLog.includes(`operationLocks/leases/${forceForeign.venueId}`)
        && !forceForeignLog.includes(`tournaments/${forceForeign.id}`)
        && !forceForeignLog.includes(`publicLive/${forceForeign.id}`)
        && state.tournament?.status === "running"
        && !state.tournament?.endedAtISO
        && state.tournament?.finishSyncPending !== true
        && forceForeignPrivate?.tournament?.status === "running"
        && forceForeignPrivate?.tournament?.finishSyncPending !== true
        && forceForeignPublic?.status === "running"
        && forceForeignPublic?.live === true
        && store.activeTournaments?.[forceForeign.venueId]?.tournamentId === forceForeign.id
        && forceForeignLease?.sessionId === `${sessionId}-foreign`
        && Number(forceForeignLease?.leaseUntil || 0) > now()
        && !forceForeignHistory.privateRecord
        && !forceForeignHistory.publicRecord
      );

      const pendingFirst = {
        id: "qa-manual-finish-pending-first-retry-v279",
        venueId: "qa-manual-finish-pending-first-retry-venue-v279",
        generation: "qa-manual-finish-pending-first-retry-generation-v279",
        fenceToken: "qa-manual-finish-pending-first-retry-fence-v279",
        fenceSequence: 1303
      };
      await installRunning(pendingFirst);
      window.__qaRejectFirebaseTransactionPaths = [];
      window.__qaBeforeFirebaseTransaction = path => {
        if (
          path === `tournaments/${pendingFirst.id}`
          && state.tournament?.status === "finished"
        ) window.__qaRejectFirebaseTransactionPaths = [path];
      };
      window.__qaFirebaseTransactionLog = [];
      await finishTournamentAsyncV116();
      await new Promise(resolve => setTimeout(resolve, 10));
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      const pendingFirstPrivateBeforeRetry = store.tournaments?.[pendingFirst.id]?.state || store.tournaments?.[pendingFirst.id];
      const pendingFirstPublicBeforeRetry = store.publicLive?.[pendingFirst.id];
      const pendingFirstFailedBeforePrivateTerminal = Boolean(
        state.tournament?.status === "finished"
        && state.tournament?.finishSyncPending === true
        && Number(state.tournament?.finishSyncPreviousUpdatedAt || 0) === Number(pendingFirstPrivateBeforeRetry?.updatedAt || 0)
        && pendingFirstPrivateBeforeRetry?.tournament?.status === "running"
        && pendingFirstPublicBeforeRetry?.status === "running"
        && pendingFirstPublicBeforeRetry?.live === true
        && store.activeTournaments?.[pendingFirst.venueId]?.tournamentId === pendingFirst.id
      );
      store.operationLocks.leases[pendingFirst.venueId].leaseUntil = now() - 1000;
      const pendingFirstLeaseExpiredBeforeRetry = Number(store.operationLocks.leases[pendingFirst.venueId].leaseUntil || 0) < now();
      const pendingRetryEvents = [];
      window.__qaFirebaseTransactionLog = [];
      window.__qaBeforeFirebaseTransaction = path => {
        if (![ `operationLocks/leases/${pendingFirst.venueId}`, `tournaments/${pendingFirst.id}`, `publicLive/${pendingFirst.id}` ].includes(path)) return;
        const privateState = store.tournaments?.[pendingFirst.id]?.state || store.tournaments?.[pendingFirst.id];
        const lease = store.operationLocks?.leases?.[pendingFirst.venueId];
        pendingRetryEvents.push({
          path,
          privateStatus: privateState?.tournament?.status || "",
          privatePending: Boolean(privateState?.tournament?.finishSyncPending),
          leaseSessionId: lease?.sessionId || "",
          leaseUntil: Number(lease?.leaseUntil || 0),
          leaseReason: lease?.reason || ""
        });
      };
      const pendingFirstRetryResult = await window.retryFinishSyncV278();
      await new Promise(resolve => setTimeout(resolve, 25));
      window.__qaBeforeFirebaseTransaction = null;
      const pendingRetryLog = [...window.__qaFirebaseTransactionLog];
      const pendingRetryLeaseIndex = pendingRetryLog.indexOf(`operationLocks/leases/${pendingFirst.venueId}`);
      const pendingRetryPublicIndex = pendingRetryLog.indexOf(`publicLive/${pendingFirst.id}`);
      const pendingRetryPrivateIndices = pendingRetryLog.reduce((indices, path, index) => path === `tournaments/${pendingFirst.id}` ? [...indices, index] : indices, []);
      const pendingRetryTerminalIndex = Math.max(-1, ...pendingRetryPrivateIndices.filter(index => pendingRetryPublicIndex < 0 || index < pendingRetryPublicIndex));
      const pendingRetryPublicEventIndex = pendingRetryEvents.findIndex(event => event.path === `publicLive/${pendingFirst.id}`);
      const pendingRetryPrePublicEvents = pendingRetryPublicEventIndex < 0 ? pendingRetryEvents : pendingRetryEvents.slice(0, pendingRetryPublicEventIndex);
      const pendingRetryPrivateEvents = pendingRetryPrePublicEvents.filter(event => event.path === `tournaments/${pendingFirst.id}`);
      const pendingRetryTerminalEntry = pendingRetryPrivateEvents[pendingRetryPrivateEvents.length - 1] || null;
      const pendingFirstPrivateAfterRetry = store.tournaments?.[pendingFirst.id]?.state || store.tournaments?.[pendingFirst.id];
      const pendingFirstPublicAfterRetry = store.publicLive?.[pendingFirst.id];
      const pendingFirstLeaseAfterRetry = store.operationLocks?.leases?.[pendingFirst.venueId];
      const pendingFirstHistory = historyFor(pendingFirst.id);
      const pendingFirstRetryLeaseClaimedBeforeTerminal = Boolean(
        pendingRetryLeaseIndex >= 0
        && pendingRetryTerminalIndex > pendingRetryLeaseIndex
        && pendingRetryTerminalEntry?.privateStatus === "running"
        && pendingRetryTerminalEntry?.leaseSessionId === sessionId
        && pendingRetryTerminalEntry.leaseUntil > now()
        && pendingRetryTerminalEntry?.leaseReason === "finish-retry-preflight-v279"
      );
      const pendingFirstRetryTerminalConverged = Boolean(
        pendingFirstRetryResult === true
        && pendingFirstPrivateAfterRetry?.tournament?.status === "finished"
        && pendingFirstPrivateAfterRetry?.tournament?.finishSyncPending !== true
        && pendingFirstPublicAfterRetry?.status === "finished"
        && pendingFirstPublicAfterRetry?.live === false
        && !store.activeTournaments?.[pendingFirst.venueId]
        && pendingFirstLeaseAfterRetry?.status === "released"
        && !pendingFirstLeaseAfterRetry?.sessionId
        && Number(pendingFirstLeaseAfterRetry?.leaseUntil || 0) === 0
        && pendingFirstHistory.privateRecord?.id === pendingFirst.id
        && pendingFirstHistory.publicRecord?.id === pendingFirst.id
        && state.tournament?.status === "draft"
      );
      const pendingFirstRetrySafelyRestoredRunning = Boolean(
        pendingFirstRetryResult === false
        && state.tournament?.status === "running"
        && state.tournament?.finishSyncPending !== true
        && pendingFirstPrivateAfterRetry?.tournament?.status === "running"
        && pendingFirstPublicAfterRetry?.status === "running"
        && pendingFirstPublicAfterRetry?.live === true
        && store.activeTournaments?.[pendingFirst.venueId]?.tournamentId === pendingFirst.id
        && !pendingFirstHistory.privateRecord
        && !pendingFirstHistory.publicRecord
      );

      return {
        expiredSameSessionRenewedBeforeTerminal,
        successConverged,
        foreignLeaseAbortedWithoutTerminalWrites,
        authoritativeUnreadyAbortedWithoutTerminalWrites,
        forceEndExpiredLeaseReclaimedBeforeTerminal,
        forceEndExpiredLeaseConverged,
        forceEndForeignLeaseAbortedWithoutTerminalWrites,
        pendingFirstFailedBeforePrivateTerminal,
        pendingFirstLeaseExpiredBeforeRetry,
        pendingFirstRetryLeaseClaimedBeforeTerminal,
        pendingFirstRetryTerminalConverged,
        pendingFirstRetrySafelyRestoredRunning,
        successDebug: { successLog, successEvents, privateStatus: successPrivate?.tournament?.status, publicStatus: successPublic?.status, lease: successLease },
        foreignDebug: { foreignLog, localStatus: state.tournament?.status, privateStatus: foreignPrivate?.tournament?.status, publicStatus: foreignPublic?.status },
        unreadyDebug: { unreadyLog, privateStatus: unreadyPrivate?.tournament?.status, publicStatus: unreadyPublic?.status },
        forceSuccessDebug: { forceSuccessLog, forceSuccessEvents, privateStatus: forceSuccessPrivate?.tournament?.status, publicStatus: forceSuccessPublic?.status, lease: forceSuccessLease },
        forceForeignDebug: { forceForeignResult, forceForeignConfirmCount, forceForeignLog, localStatus: state.tournament?.status, privateStatus: forceForeignPrivate?.tournament?.status, publicStatus: forceForeignPublic?.status, lease: forceForeignLease },
        pendingFirstDebug: {
          pendingRetryLog,
          pendingRetryEvents,
          retryResult: pendingFirstRetryResult,
          localStatus: state.tournament?.status,
          privateBeforeStatus: pendingFirstPrivateBeforeRetry?.tournament?.status,
          privateAfterStatus: pendingFirstPrivateAfterRetry?.tournament?.status,
          privateAfterPending: Boolean(pendingFirstPrivateAfterRetry?.tournament?.finishSyncPending),
          publicAfterStatus: pendingFirstPublicAfterRetry?.status,
          activeAfter: store.activeTournaments?.[pendingFirst.venueId] || null,
          history: pendingFirstHistory,
          leaseAfter: pendingFirstLeaseAfterRetry
        }
      };
    } finally {
      window.confirm = originalConfirm;
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      store.tournaments = backup.tournaments;
      store.publicLive = backup.publicLive;
      store.activeTournaments = backup.activeTournaments;
      store.operationLocks = backup.operationLocks;
      store.privateResultLogs = backup.privateResultLogs;
      store.publicHistory = backup.publicHistory;
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "manual-finish-lease-preflight-v279", info: { manualFinishLeasePreflightV279 } });
  if (!manualFinishLeasePreflightV279.expiredSameSessionRenewedBeforeTerminal || !manualFinishLeasePreflightV279.successConverged || !manualFinishLeasePreflightV279.foreignLeaseAbortedWithoutTerminalWrites || !manualFinishLeasePreflightV279.authoritativeUnreadyAbortedWithoutTerminalWrites || !manualFinishLeasePreflightV279.forceEndExpiredLeaseReclaimedBeforeTerminal || !manualFinishLeasePreflightV279.forceEndExpiredLeaseConverged || !manualFinishLeasePreflightV279.forceEndForeignLeaseAbortedWithoutTerminalWrites || !manualFinishLeasePreflightV279.pendingFirstFailedBeforePrivateTerminal || !manualFinishLeasePreflightV279.pendingFirstLeaseExpiredBeforeRetry || !manualFinishLeasePreflightV279.pendingFirstRetryLeaseClaimedBeforeTerminal || !manualFinishLeasePreflightV279.pendingFirstRetryTerminalConverged) {
    failures.push(`manual finish lease preflight v279 failed ${JSON.stringify(manualFinishLeasePreflightV279)}`);
  }

  const startCrashRecoveryV279 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      store: clone(store),
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft
    };
    const storageKeys = [STORAGE_KEY, LOCAL_SNAPSHOT_KEY, LOCAL_RESULT_LOGS_KEY, OPERATOR_UNDO_STORAGE_KEY_V266, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const sessionId = window.__mini4wdOperatorSession?.sessionId || "";
    const serverNow = () => window.__mini4wdFirebaseServerClockV279?.now?.() || Date.now();
    const restoreStore = snapshot => {
      Object.keys(store).forEach(key => delete store[key]);
      Object.assign(store, clone(snapshot));
    };
    const installDraft = venueId => {
      const next = makeInitialState(3);
      next.inputText = ["Start A/QA", "Start B/QA", "Start C/QA", "Start D/QA", "Start E/QA", "Start F/QA"].join("\n");
      next.settings = { ...next.settings, laneCount: 3, matchMode: "basic", firebaseAutoSave: false };
      next.tournament = {
        ...next.tournament,
        name: `QA Start Crash ${venueId}`,
        venue: `QA Venue ${venueId}`,
        venueId,
        raceClass: "오픈",
        status: "draft",
        liveId: "",
        liveSignature: "",
        activeRegistryGeneration: "",
        startedAtISO: "",
        startedAtDisplay: ""
      };
      state = normalizeImportedState(next);
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = "";
      dbVenueIdDraft = "";
      localStorage.removeItem("mini4wdTournamentId");
      localStorage.removeItem("mini4wdActiveLiveId");
      localStorage.removeItem("mini4wdActiveLiveSignature");
      persistCurrentState();
    };
    const seedCrashOwner = ({ venueId, tournamentId, generation, fenceToken, fenceSequence, fresh }) => {
      const grace = Math.max(1000, Number(ACTIVE_REGISTRY_START_GRACE_MS_V278 || 120000));
      const activeUpdatedAt = fresh ? serverNow() - 1000 : serverNow() - grace - 5000;
      const leaseUntil = fresh ? serverNow() + 60000 : serverNow() - grace - 5000;
      store.tournaments = store.tournaments || {};
      store.publicLive = store.publicLive || {};
      store.activeTournaments = store.activeTournaments || {};
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      delete store.tournaments[tournamentId];
      delete store.publicLive[tournamentId];
      store.activeTournaments[venueId] = {
        protocolVersion: 279,
        venueId,
        venueName: `QA Venue ${venueId}`,
        uid: "qa-foreign-same-venue-uid",
        email: "qa-foreign@example.com",
        tournamentId,
        registryGeneration: generation,
        tournamentName: `QA Crashed Start ${tournamentId}`,
        raceClass: "오픈",
        status: "running",
        fenceToken,
        fenceSequence,
        updatedAt: activeUpdatedAt
      };
      store.operationLocks.leases[venueId] = {
        protocolVersion: 279,
        scope: "venue",
        venueId,
        venueName: `QA Venue ${venueId}`,
        uid: "qa-foreign-same-venue-uid",
        email: "qa-foreign@example.com",
        sessionId: "qa-foreign-start-session-v279",
        sessionLineageId: "qa-foreign-start-lineage-v279",
        claimSequence: fenceSequence,
        fenceSequenceHighWater: fenceSequence,
        fenceToken,
        tournamentId,
        registryGeneration: generation,
        tournamentName: `QA Crashed Start ${tournamentId}`,
        status: "starting",
        reason: "qa-crashed-start-v279",
        leaseUntil,
        clientUpdatedAt: activeUpdatedAt,
        updatedAt: activeUpdatedAt,
        build: "qa-v279"
      };
      return { activeUpdatedAt, leaseUntil, grace };
    };

    try {
      const stale = {
        venueId: "qa-start-crash-stale-venue-v279",
        tournamentId: "qa-start-crash-orphan-v279",
        generation: "qa-start-crash-orphan-generation-v279",
        fenceToken: "qa-start-crash-orphan-fence-v279",
        fenceSequence: 1301,
        fresh: false
      };
      installDraft(stale.venueId);
      const staleTiming = seedCrashOwner(stale);
      window.__qaFirebaseTransactionLog = [];
      const staleStartResult = await window.startTournamentAsync();
      // startAllFirstStages() schedules LIVE fallback work that can still read
      // the mutable global state after the start promise resolves. Let those
      // retries settle before swapping in the negative fresh-owner fixture.
      await new Promise(resolve => setTimeout(resolve, 1800));
      const staleLog = [...window.__qaFirebaseTransactionLog];
      const staleCleanupIndex = staleLog.indexOf(`activeTournaments/${stale.venueId}`);
      const newLeaseClaimIndex = staleLog.indexOf(`operationLocks/leases/${stale.venueId}`);
      const startedId = String(state.tournament?.liveId || "");
      const startedPrivateRecord = store.tournaments?.[startedId];
      const startedPrivate = startedPrivateRecord?.state || startedPrivateRecord;
      const startedPublic = store.publicLive?.[startedId];
      const startedActive = store.activeTournaments?.[stale.venueId];
      const startedLease = store.operationLocks?.leases?.[stale.venueId];
      const staleCleanupBeforeNewLeaseClaim = Boolean(
        staleTiming.activeUpdatedAt < serverNow() - staleTiming.grace
        && staleTiming.leaseUntil < serverNow()
        && staleCleanupIndex >= 0
        && newLeaseClaimIndex > staleCleanupIndex
      );
      const staleStartConverged = Boolean(
        staleStartResult === true
        && startedId
        && startedId !== stale.tournamentId
        && state.tournament?.status === "running"
        && startedPrivateRecord?.protocolVersion === 279
        && startedPrivate?.remoteWriteProtocolV279 === 279
        && startedPrivate?.tournament?.remoteWriteProtocolV279 === 279
        && startedPrivate?.tournament?.status === "running"
        && startedPublic?.protocolVersion === 279
        && startedPublic?.status === "running"
        && startedPublic?.live === true
        && startedActive?.protocolVersion === 279
        && startedActive?.tournamentId === startedId
        && startedActive?.registryGeneration === startedPrivate?.tournament?.activeRegistryGeneration
        && startedActive?.fenceToken === startedLease?.fenceToken
        && Number(startedActive?.fenceSequence || 0) === Number(startedLease?.claimSequence || 0)
        && startedLease?.sessionId === sessionId
        && startedLease?.tournamentId === startedId
        && startedLease?.registryGeneration === startedPrivate?.tournament?.activeRegistryGeneration
        && !store.tournaments?.[stale.tournamentId]
        && !store.publicLive?.[stale.tournamentId]
      );
      const successDebug = {
        staleStartResult,
        staleLog,
        startedId,
        localStatus: state.tournament?.status,
        privateStatus: startedPrivate?.tournament?.status,
        publicStatus: startedPublic?.status,
        activeTournamentId: startedActive?.tournamentId,
        leaseTournamentId: startedLease?.tournamentId,
        leaseSessionId: startedLease?.sessionId
      };

      restoreStore(backup.store);
      const fresh = {
        venueId: "qa-start-crash-fresh-venue-v279",
        tournamentId: "qa-start-crash-fresh-owner-v279",
        generation: "qa-start-crash-fresh-generation-v279",
        fenceToken: "qa-start-crash-fresh-fence-v279",
        fenceSequence: 1302,
        fresh: true
      };
      installDraft(fresh.venueId);
      const freshTiming = seedCrashOwner(fresh);
      const privateKeysBefore = Object.keys(store.tournaments || {}).sort();
      const publicKeysBefore = Object.keys(store.publicLive || {}).sort();
      window.__qaFirebaseTransactionLog = [];
      const freshStartResult = await window.startTournamentAsync();
      await new Promise(resolve => setTimeout(resolve, 25));
      const freshLog = [...window.__qaFirebaseTransactionLog];
      const freshActive = store.activeTournaments?.[fresh.venueId];
      const freshLease = store.operationLocks?.leases?.[fresh.venueId];
      const freshOwnerPreservedAndStartAborted = Boolean(
        freshStartResult === false
        && freshTiming.activeUpdatedAt > serverNow() - freshTiming.grace
        && freshTiming.leaseUntil > serverNow()
        && state.tournament?.status === "draft"
        && freshActive?.tournamentId === fresh.tournamentId
        && freshActive?.registryGeneration === fresh.generation
        && freshActive?.uid === "qa-foreign-same-venue-uid"
        && freshLease?.tournamentId === fresh.tournamentId
        && freshLease?.registryGeneration === fresh.generation
        && freshLease?.sessionId === "qa-foreign-start-session-v279"
        && freshLease?.leaseUntil === freshTiming.leaseUntil
        && JSON.stringify(Object.keys(store.tournaments || {}).sort()) === JSON.stringify(privateKeysBefore)
        && JSON.stringify(Object.keys(store.publicLive || {}).sort()) === JSON.stringify(publicKeysBefore)
        && !store.tournaments?.[fresh.tournamentId]
        && !store.publicLive?.[fresh.tournamentId]
        && freshLog.includes(`operationLocks/leases/${fresh.venueId}`)
        && !freshLog.some(path => path.startsWith("tournaments/"))
        && !freshLog.some(path => path.startsWith("publicLive/"))
      );
      const negativeDebug = {
        freshStartResult,
        freshLog,
        localStatus: state.tournament?.status,
        activeTournamentId: freshActive?.tournamentId,
        leaseTournamentId: freshLease?.tournamentId,
        leaseSessionId: freshLease?.sessionId,
        privateKeyCountBefore: privateKeysBefore.length,
        privateKeyCountAfter: Object.keys(store.tournaments || {}).length,
        publicKeyCountBefore: publicKeysBefore.length,
        publicKeyCountAfter: Object.keys(store.publicLive || {}).length
      };

      return {
        staleCleanupBeforeNewLeaseClaim,
        staleStartConverged,
        freshOwnerPreservedAndStartAborted,
        successDebug,
        negativeDebug
      };
    } finally {
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      restoreStore(backup.store);
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "start-crash-recovery-v279", info: { startCrashRecoveryV279 } });
  if (!startCrashRecoveryV279.staleCleanupBeforeNewLeaseClaim || !startCrashRecoveryV279.staleStartConverged || !startCrashRecoveryV279.freshOwnerPreservedAndStartAborted) {
    failures.push(`start crash recovery v279 failed ${JSON.stringify(startCrashRecoveryV279)}`);
  }

  const resultRecordKeyCollisionV279 = await page.evaluate(async () => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const backup = {
      store: clone(store),
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      dbVenueIdDraft
    };
    const storageKeys = [STORAGE_KEY, LOCAL_SNAPSHOT_KEY, LOCAL_RESULT_LOGS_KEY, "mini4wdTournamentId", "mini4wdActiveLiveId", "mini4wdActiveLiveSignature"];
    const storageBackup = Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]));
    const legacyMinuteId = "tournament-20260822-1234";
    const sourceAId = "qa-result-source-a-live-v279";
    const sourceBId = "qa-result-source-b-live-v279";
    const venueAId = "qa-result-source-a-venue-v279";
    const venueBId = "qa-result-source-b-venue-v279";
    const generationA = "qa-result-source-a-generation-v279";
    const generationB = "qa-result-source-b-generation-v279";
    const fenceTokenB = "qa-result-source-b-fence-v279";
    const fenceSequenceB = 1402;
    const terminalAt = (window.__mini4wdFirebaseServerClockV279?.now?.() || Date.now()) - 1000;
    const sessionId = window.__mini4wdOperatorSession?.sessionId || "";

    const makeTerminalSource = ({ liveId, venueId, generation, suffix, fenceToken, fenceSequence }) => {
      const next = makeInitialState(3);
      next.inputText = `Result ${suffix} A/QA\nResult ${suffix} B/QA`;
      next.settings = { ...next.settings, laneCount: 3, matchMode: "basic", firebaseAutoSave: false };
      next.remoteWriteProtocolV279 = 279;
      next.tournament = {
        ...next.tournament,
        remoteWriteProtocolV279: 279,
        id: legacyMinuteId,
        recordId: "",
        name: `QA Result ${suffix}`,
        venue: `QA Result Venue ${suffix}`,
        venueId,
        raceClass: "오픈",
        status: "finished",
        liveId,
        liveSignature: `${liveId}-signature`,
        activeRegistryGeneration: generation,
        liveWriteFenceV278: fenceToken,
        liveWriteFenceSequenceV278: fenceSequence,
        startedAtISO: new Date(terminalAt - 60000).toISOString(),
        endedAtISO: new Date(terminalAt).toISOString(),
        endedAtDisplay: formatDateTimeLocal(new Date(terminalAt)),
        liveStopped: true,
        finishSyncPending: false,
        finishSyncPreviousUpdatedAt: terminalAt - 1000,
        finishSyncPreviousEndedAtISO: "",
        finishSyncPreviousEndedAtDisplay: "",
        finishSyncPreviousLiveStopped: false,
        finishSyncPreviousFirebaseAutoSave: true,
        finishSyncTerminalUpdatedAt: terminalAt
      };
      next.activeRoundIndex = 0;
      next.updatedAt = terminalAt;
      return normalizeImportedState(next);
    };

    try {
      const sourceA = makeTerminalSource({
        liveId: sourceAId,
        venueId: venueAId,
        generation: generationA,
        suffix: "A",
        fenceToken: "qa-result-source-a-fence-v279",
        fenceSequence: 1401
      });
      const sourceB = makeTerminalSource({
        liveId: sourceBId,
        venueId: venueBId,
        generation: generationB,
        suffix: "B",
        fenceToken: fenceTokenB,
        fenceSequence: fenceSequenceB
      });
      const recordA = makeTournamentRecordFromStateV278(sourceA);
      const recordBFromState = makeTournamentRecordFromStateV278(sourceB);

      state = normalizeImportedState(sourceB);
      activeRoundIndex = 0;
      state.activeRoundIndex = 0;
      firebaseTournamentId = sourceBId;
      dbVenueIdDraft = "";
      localStorage.setItem("mini4wdTournamentId", sourceBId);
      localStorage.setItem("mini4wdActiveLiveId", sourceBId);
      localStorage.setItem("mini4wdActiveLiveSignature", sourceB.tournament.liveSignature);
      const recordB = makeTournamentRecord();
      const staleImportedRecordB = { ...recordB, id: legacyMinuteId };
      state.tournament.finishSyncRecord = clone(staleImportedRecordB);
      persistCurrentState();

      store.publicHistory = store.publicHistory || {};
      const legacySourceASeed = {
        ...makePublicRecord(recordA),
        id: legacyMinuteId,
        legacyRecordKeyV279: true
      };
      store.publicHistory[legacyMinuteId] = clone(legacySourceASeed);
      const legacySourceABefore = JSON.stringify(store.publicHistory[legacyMinuteId]);
      store.tournaments = store.tournaments || {};
      store.publicLive = store.publicLive || {};
      delete store.tournaments[sourceBId];
      delete store.publicLive[sourceBId];
      store.activeTournaments = store.activeTournaments || {};
      store.activeTournaments[venueBId] = {
        protocolVersion: 279,
        venueId: venueBId,
        venueName: sourceB.tournament.venue,
        uid: "qa-uid",
        email: "qa-venue@example.com",
        tournamentId: sourceBId,
        registryGeneration: generationB,
        tournamentName: sourceB.tournament.name,
        raceClass: "오픈",
        status: "running",
        fenceToken: fenceTokenB,
        fenceSequence: fenceSequenceB,
        updatedAt: terminalAt - 1000
      };
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      store.operationLocks.leases[venueBId] = {
        protocolVersion: 279,
        scope: "venue",
        venueId: venueBId,
        venueName: sourceB.tournament.venue,
        uid: "qa-uid",
        email: "qa-venue@example.com",
        sessionId,
        sessionLineageId: "qa-result-source-b-lineage-v279",
        claimSequence: fenceSequenceB,
        fenceSequenceHighWater: fenceSequenceB,
        fenceToken: fenceTokenB,
        tournamentId: sourceBId,
        registryGeneration: generationB,
        tournamentName: sourceB.tournament.name,
        status: "running",
        reason: "qa-result-key-collision-v279",
        leaseUntil: terminalAt + 60000,
        clientUpdatedAt: terminalAt,
        updatedAt: terminalAt,
        build: "qa-v279"
      };
      await refreshOperationLeaseV178();
      window.__qaFirebaseTransactionLog = [];
      const syncResult = await syncFinishedTournamentAndAdvanceV278("qa-result-key-collision-v279");
      await new Promise(resolve => setTimeout(resolve, 25));

      const remotePrivateRecord = store.tournaments?.[sourceBId];
      const remotePrivate = remotePrivateRecord?.state || remotePrivateRecord;
      const remotePublic = store.publicLive?.[sourceBId];
      const privateHistoryB = store.privateResultLogs?.[venueBId]?.[sourceBId];
      const publicHistoryB = store.publicHistory?.[sourceBId];
      const finalLease = store.operationLocks?.leases?.[venueBId];
      const buildersUseExactDistinctLiveIds = Boolean(
        sourceA.tournament.id === legacyMinuteId
        && sourceB.tournament.id === legacyMinuteId
        && sourceA.tournament.liveId !== sourceB.tournament.liveId
        && sourceA.tournament.activeRegistryGeneration !== sourceB.tournament.activeRegistryGeneration
        && sourceA.tournament.venueId !== sourceB.tournament.venueId
        && recordA?.id === sourceAId
        && recordA?.sourceTournamentId === sourceAId
        && recordBFromState?.id === sourceBId
        && recordBFromState?.sourceTournamentId === sourceBId
        && recordB?.id === sourceBId
        && recordB?.sourceTournamentId === sourceBId
        && recordA.id !== recordB.id
      );
      const legacySourceAPreserved = Boolean(
        JSON.stringify(store.publicHistory?.[legacyMinuteId]) === legacySourceABefore
        && store.publicHistory?.[legacyMinuteId]?.sourceTournamentId === sourceAId
        && store.publicHistory?.[legacyMinuteId]?.legacyRecordKeyV279 === true
      );
      const sourceBPublishedAtExactKey = Boolean(
        syncResult === true
        && privateHistoryB?.id === sourceBId
        && privateHistoryB?.sourceTournamentId === sourceBId
        && privateHistoryB?.registryGeneration === generationB
        && publicHistoryB?.id === sourceBId
        && publicHistoryB?.sourceTournamentId === sourceBId
        && publicHistoryB?.registryGeneration === generationB
        && store.publicHistory?.[legacyMinuteId]?.sourceTournamentId !== sourceBId
      );
      const strictStaleRecordIdNormalizedToSourceKey = Boolean(
        staleImportedRecordB.id === legacyMinuteId
        && staleImportedRecordB.sourceTournamentId === sourceBId
        && privateHistoryB?.id === sourceBId
        && publicHistoryB?.id === sourceBId
        && JSON.stringify(store.publicHistory?.[legacyMinuteId]) === legacySourceABefore
      );
      const sourceBFinishConverged = Boolean(
        remotePrivateRecord?.protocolVersion === 279
        && remotePrivate?.tournament?.status === "finished"
        && remotePrivate?.tournament?.finishSyncPending !== true
        && !remotePrivate?.tournament?.finishSyncPublisherToken
        && remotePublic?.protocolVersion === 279
        && remotePublic?.status === "finished"
        && remotePublic?.live === false
        && !store.activeTournaments?.[venueBId]
        && finalLease?.status === "released"
        && !finalLease?.sessionId
        && Number(finalLease?.leaseUntil || 0) === 0
        && state.tournament?.status === "draft"
      );

      return {
        buildersUseExactDistinctLiveIds,
        legacySourceAPreserved,
        sourceBPublishedAtExactKey,
        strictStaleRecordIdNormalizedToSourceKey,
        sourceBFinishConverged,
        debug: {
          legacyMinuteId,
          recordAId: recordA?.id,
          recordBFromStateId: recordBFromState?.id,
          recordBId: recordB?.id,
          staleImportedRecordBId: staleImportedRecordB.id,
          syncResult,
          remotePrivateStatus: remotePrivate?.tournament?.status,
          remotePrivatePending: Boolean(remotePrivate?.tournament?.finishSyncPending),
          remotePublicStatus: remotePublic?.status,
          publicHistoryKeys: [legacyMinuteId, sourceBId].filter(key => Boolean(store.publicHistory?.[key])),
          transactionLog: [...window.__qaFirebaseTransactionLog]
        }
      };
    } finally {
      window.__qaBeforeFirebaseTransaction = null;
      window.__qaRejectFirebaseTransactionPaths = [];
      Object.keys(store).forEach(key => delete store[key]);
      Object.assign(store, clone(backup.store));
      state = normalizeImportedState(backup.state);
      activeRoundIndex = backup.activeRoundIndex;
      state.activeRoundIndex = backup.activeRoundIndex;
      firebaseTournamentId = backup.firebaseTournamentId;
      dbVenueIdDraft = backup.dbVenueIdDraft;
      storageKeys.forEach(key => {
        const value = storageBackup[key];
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "result-record-key-collision-v279", info: { resultRecordKeyCollisionV279 } });
  if (!resultRecordKeyCollisionV279.buildersUseExactDistinctLiveIds || !resultRecordKeyCollisionV279.legacySourceAPreserved || !resultRecordKeyCollisionV279.sourceBPublishedAtExactKey || !resultRecordKeyCollisionV279.strictStaleRecordIdNormalizedToSourceKey || !resultRecordKeyCollisionV279.sourceBFinishConverged) {
    failures.push(`result record key collision v279 failed ${JSON.stringify(resultRecordKeyCollisionV279)}`);
  }

  await page.evaluate(() => {
    window.setTournamentField("name", "QA Operator Rehearsal");
    window.setTournamentField("venue", "QA Venue");
    window.setMatchMode("points5Tree");
  });
  await page.waitForTimeout(300);
  logs.push({ step: "points5-mode", info: await assertNoUiBreakage(page, "points5-mode", failures) });

  const forcedGroupManualInputStart = await page.evaluate(async () => {
    renderOperator();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const input = document.querySelector(".forced-group-count-input-v265");
    if (input) {
      input.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const beforeScroll = Math.round(window.scrollY);
    const beforeNode = input;
    const beforeRenderState = document.querySelector(".operator-shell-v211")?.innerHTML || "";
    if (input) {
      try { input.focus({ preventScroll: true }); }
      catch (error) { input.focus(); }
      await new Promise(resolve => requestAnimationFrame(resolve));
      window.scrollTo(0, beforeScroll);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    window.__forcedGroupManualInputStartV265 = { beforeScroll, beforeNode, beforeRenderState };
    return { exists: !!input, beforeScroll };
  });
  if (forcedGroupManualInputStart.exists) {
    await page.keyboard.type("2a");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("03");
    await page.keyboard.press("Enter");
  }
  const forcedGroupManualInput = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const before = window.__forcedGroupManualInputStartV265 || {};
    const afterInput = document.querySelector(".forced-group-count-input-v265");
    const afterRenderState = document.querySelector(".operator-shell-v211")?.innerHTML || "";
    const forcedCount = getForcedGroupCount();
    const invalidBefore = state.settings.forcedGroupCount;
    const invalidInputBefore = afterInput?.value || "";
    if (afterInput) afterInput.value = "0";
    state.settings.forcedGroupCount = "0";
    const invalidError = validateStart(parseParticipants(), "예선");
    state.settings.forcedGroupCount = invalidBefore;
    if (afterInput) afterInput.value = invalidInputBefore;
    const result = {
      exists: !!afterInput,
      sameNode: before.beforeNode === afterInput,
      value: afterInput?.value || "",
      stateValue: state.settings.forcedGroupCount,
      forcedCount,
      type: afterInput?.type || "",
      oninput: afterInput?.getAttribute("oninput") || "",
      beforeScroll: before.beforeScroll || 0,
      afterScroll: Math.round(window.scrollY),
      rerendered: (before.beforeRenderState || "") !== afterRenderState,
      invalidError
    };
    state.settings.forcedGroupCount = "";
    if (afterInput) afterInput.value = "";
    return result;
  });
  logs.push({ step: "forced-group-manual-input", info: { forcedGroupManualInput } });
  if (!forcedGroupManualInput.exists || !forcedGroupManualInput.sameNode || forcedGroupManualInput.rerendered) {
    failures.push(`forced group manual input rerendered or lost focus target ${JSON.stringify(forcedGroupManualInput)}`);
  }
  if (forcedGroupManualInput.value !== "3" || forcedGroupManualInput.stateValue !== "3") {
    failures.push(`forced group manual input did not sanitize and commit cleanly ${JSON.stringify(forcedGroupManualInput)}`);
  }
  if (Math.abs(forcedGroupManualInput.afterScroll - forcedGroupManualInput.beforeScroll) > 2) {
    failures.push(`forced group manual input changed scroll position ${JSON.stringify(forcedGroupManualInput)}`);
  }
  if (!String(forcedGroupManualInput.invalidError || "").includes("1 이상의 숫자")) {
    failures.push(`forced group invalid input did not validate ${JSON.stringify(forcedGroupManualInput)}`);
  }

  await page.evaluate(() => window.startQualifierRound(0));
  await page.waitForTimeout(500);
  logs.push({ step: "start-point-round", info: await assertNoUiBreakage(page, "start-point-round", failures) });

  const liveConnectV267 = await page.evaluate(async () => {
    const id = getCurrentTournamentId();
    if (window.__qaFirebaseStore?.publicLive) delete window.__qaFirebaseStore.publicLive[id];
    const published = typeof forcePublishPublicLiveV50 === "function"
      ? await forcePublishPublicLiveV50("qa-live-connect-v267")
      : false;
    location.hash = `view=mobile-live&t=${encodeURIComponent(id)}`;
    if (typeof bootV33 === "function") await bootV33();
    await new Promise(resolve => setTimeout(resolve, 120));
    const before = {
      surface: document.documentElement.getAttribute("data-ui-surface") || "",
      publicLiveExists: !!window.__qaFirebaseStore?.publicLive?.[id],
      hasMobileView: !!document.querySelector(".mobile-view")
    };
    await new Promise(resolve => setTimeout(resolve, 450));
    const text = String(document.body.innerText || document.body.textContent || "").replace(/\s+/g, " ").trim();
    const pollTitle = "QA Live Poll Updated";
    const liveRecord = window.__qaFirebaseStore?.publicLive?.[id];
    if (liveRecord?.state?.tournament) {
      liveRecord.state.tournament.name = pollTitle;
      liveRecord.state.updatedAt = Date.now() + 10000;
      liveRecord.updatedAt = liveRecord.state.updatedAt;
      liveRecord.tournamentName = pollTitle;
    }
    await new Promise(resolve => setTimeout(resolve, 3200));
    const pollText = String(document.body.innerText || document.body.textContent || "").replace(/\s+/g, " ").trim();
    return {
      id,
      before,
      published,
      surface: document.documentElement.getAttribute("data-ui-surface") || "",
      publicLiveExists: !!window.__qaFirebaseStore?.publicLive?.[id],
      hasMobileView: !!document.querySelector(".mobile-view"),
      hasLiveLobby: !!document.querySelector(".live-lobby-shell-v89"),
      hasCurrentGroups: document.querySelectorAll(".mobile-view .group, .mobile-view .slot").length,
      textSample: text.slice(0, 260),
      pollTitle,
      pollUpdated: pollText.includes(pollTitle),
      pollTextSample: pollText.slice(0, 260)
    };
  });
  logs.push({ step: "live-connect-v267", info: { liveConnectV267 } });
  if (!liveConnectV267.published || !liveConnectV267.publicLiveExists || liveConnectV267.surface !== "mobile-live" || !liveConnectV267.hasMobileView || liveConnectV267.hasLiveLobby || liveConnectV267.hasCurrentGroups < 1 || !liveConnectV267.pollUpdated) {
    failures.push(`live connect v267 failed ${JSON.stringify(liveConnectV267)}`);
  }
  await showOperatorPage(page);

  const liveRoundFallbackV269 = await page.evaluate(async () => {
    const backupState = exportState();
    const backupActiveRoundIndex = activeRoundIndex;
    const backupBroadcast = state.broadcast ? { ...state.broadcast } : null;
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const store = window.__qaFirebaseStore;
    const venueId = "qa-venue";
    const id = `qa-live-round-fallback-v269-${Date.now()}`;
    const fixtureBackup = {
      tournament: clone(store.tournaments?.[id]),
      publicLive: clone(store.publicLive?.[id]),
      active: clone(store.activeTournaments?.[venueId]),
      lease: clone(store.operationLocks?.leases?.[venueId])
    };
    const originalSync = forceLiveBroadcastSync;
    state.inputText = ["Alpha/QA", "Beta/QA", "Gamma/QA", "Delta/QA", "Echo/QA", "Foxtrot/QA"].join("\n");
    const parsed = parseParticipants();
    const winner = { ...parsed[0], lane: 1 };
    const finalistSlots = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.tournament.status = "running";
    state.tournament.name = "QA Live Round Fallback";
    state.tournament.venue = "QA Venue";
    state.tournament.venueId = venueId;
    state.tournament.liveId = id;
    state.tournament.liveSignature = `${id}-signature`;
    state.tournament.activeRegistryGeneration = "qa-live-round-fallback-generation-v269";
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-live-round-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: index === 0 ? winner : null,
      stagePlan: [],
      stages: index === 0
        ? [{ id: "qa-live-final-decision", name: "포인트 상위 3명 결정전", type: "pointFinal", pointFinalRule: "top-score", groups: [{ id: "qa-live-final-group", name: "1조", slots: finalistSlots, advanceIds: [winner.id] }] }]
        : [{ id: `qa-live-next-${index}`, name: "본선", type: "normal", groups: [{ id: `qa-live-next-group-${index}`, name: "1조", slots: parsed.slice(index, index + 3).map((player, laneIndex) => ({ ...player, lane: laneIndex + 1 })), advanceIds: [] }] }]
    }));
    state.finalRace = null;
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    state.updatedAt = Date.now();
    firebaseTournamentId = id;
    localStorage.setItem("mini4wdTournamentId", id);
    localStorage.setItem("mini4wdActiveLiveId", id);
    localStorage.setItem("mini4wdActiveLiveSignature", state.tournament.liveSignature);
    const privateSeed = exportState();
    store.tournaments[id] = { state: clone(privateSeed), updatedAt: privateSeed.updatedAt };
    store.activeTournaments[venueId] = {
      venueId,
      venueName: "QA Venue",
      tournamentId: id,
      registryGeneration: state.tournament.activeRegistryGeneration,
      tournamentName: state.tournament.name,
      status: "running",
      updatedAt: state.updatedAt
    };
    const activeStartedLegacy = Boolean(
      !store.activeTournaments[venueId].protocolVersion
      && !store.activeTournaments[venueId].uid
      && !store.activeTournaments[venueId].fenceToken
      && !store.activeTournaments[venueId].fenceSequence
    );
    delete store.publicLive[id];
    let result = null;
    try {
      await window.releaseOperationLeaseV178(true, venueId);
      const leaseClaimed = await window.claimOperationLeaseV178("qa-live-round-fallback-v269", true, {
        venueId,
        venueName: "QA Venue",
        tournamentId: id,
        tournamentName: state.tournament.name,
        registryGeneration: state.tournament.activeRegistryGeneration,
        status: "running"
      });
      forceLiveBroadcastSync = () => Promise.resolve(false);
      const activated = activateNextRoundAfterFinalist(0, true);
      renderOperator();
      await new Promise(resolve => setTimeout(resolve, 1300));
      const live = store.publicLive?.[id];
      const active = store.activeTournaments?.[venueId];
      const lease = store.operationLocks?.leases?.[venueId];
      result = {
        activated,
        leaseClaimed,
        activeStartedLegacy,
        activeConvergedV279: Boolean(
          active?.protocolVersion === 279
          && active?.uid === "qa-uid"
          && active?.tournamentId === id
          && active?.registryGeneration === state.tournament.activeRegistryGeneration
          && active?.fenceToken === lease?.fenceToken
          && Number(active?.fenceSequence || 0) === Number(lease?.claimSequence || 0)
          && Number(active?.fenceSequence || 0) > 0
        ),
        active,
        lease,
        id,
        localActiveRoundIndex: activeRoundIndex,
        localBroadcast: state.broadcast,
        publicExists: !!live,
        publicActiveRoundIndex: live?.state?.activeRoundIndex,
        publicBroadcast: live?.state?.broadcast,
        publicStageName: live?.state?.qualifierRounds?.[live?.state?.broadcast?.roundIndex || 0]?.stages?.[live?.state?.broadcast?.stageIndex || 0]?.name || "",
        syncReason: live?.syncReason || ""
      };
    } finally {
      forceLiveBroadcastSync = originalSync;
      const restore = (collection, key, value) => value === undefined ? delete collection[key] : (collection[key] = value);
      restore(store.tournaments, id, fixtureBackup.tournament);
      restore(store.publicLive, id, fixtureBackup.publicLive);
      restore(store.activeTournaments, venueId, fixtureBackup.active);
      store.operationLocks = store.operationLocks || {};
      store.operationLocks.leases = store.operationLocks.leases || {};
      restore(store.operationLocks.leases, venueId, fixtureBackup.lease);
      state = normalizeImportedState(backupState);
      activeRoundIndex = backupActiveRoundIndex;
      state.activeRoundIndex = backupActiveRoundIndex;
      if (backupBroadcast) state.broadcast = backupBroadcast;
      persistCurrentState();
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      renderOperator();
    }
    return result;
  });
  logs.push({ step: "live-round-fallback-v269", info: { liveRoundFallbackV269 } });
  if (!liveRoundFallbackV269.activated || !liveRoundFallbackV269.leaseClaimed || !liveRoundFallbackV269.activeStartedLegacy || !liveRoundFallbackV269.activeConvergedV279 || !liveRoundFallbackV269.publicExists || liveRoundFallbackV269.publicActiveRoundIndex !== 1 || liveRoundFallbackV269.publicBroadcast?.roundIndex !== 1) {
    failures.push(`live round fallback v269 failed ${JSON.stringify(liveRoundFallbackV269)}`);
  }
  await showOperatorPage(page);
  // The preceding fallback schedules settled LIVE retries through 1600ms.
  // Keep this fixture from racing those claims on the same exact venue.
  await page.waitForTimeout(1800);

  const liveLeaseRetryV270 = await page.evaluate(async () => {
    const backupState = exportState();
    const backupActiveRoundIndex = activeRoundIndex;
    const backupBroadcast = state.broadcast ? { ...state.broadcast } : null;
    const alerts = [];
    const originalAlert = window.alert;
    let firebaseFixtureBackup = null;
    window.alert = message => alerts.push(String(message || ""));
    try {
      state.inputText = ["LeaseA/QA", "LeaseB/QA", "LeaseC/QA", "LeaseD/QA", "LeaseE/QA", "LeaseF/QA"].join("\n");
      const parsed = parseParticipants();
      state.settings.matchMode = "points3";
      state.settings.laneCount = 3;
      state.tournament.status = "running";
      state.tournament.name = "QA Live Lease Retry";
      state.tournament.venue = "QA Venue";
      state.qualifierRounds = [0, 1, 2].map(index => ({
        id: `qa-live-lease-${index + 1}`,
        index: index + 1,
        title: `${index + 1}차 라운드`,
        finalist: index === 0 ? parsed[0] : null,
        stagePlan: [],
        stages: [{ id: `qa-live-lease-stage-${index}`, name: index === 1 ? "준결승" : "본선", type: "normal", groups: [{ id: `qa-live-lease-group-${index}`, name: "1조", slots: parsed.slice(index, index + 3).map((player, laneIndex) => ({ ...player, lane: laneIndex + 1 })), advanceIds: [] }] }]
      }));
      activeRoundIndex = 1;
      state.activeRoundIndex = 1;
      state.broadcast = { mode: "stage", roundIndex: 1, stageIndex: 0 };
      state.updatedAt = Date.now();
      const id = getCurrentTournamentId();
      const venueId = normalizeKey(currentVenueId() || currentVenueName() || "default");
      const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      firebaseFixtureBackup = {
        id,
        venueId,
        tournament: clone(window.__qaFirebaseStore?.tournaments?.[id]),
        publicLive: clone(window.__qaFirebaseStore?.publicLive?.[id]),
        active: clone(window.__qaFirebaseStore?.activeTournaments?.[venueId]),
        lease: clone(window.__qaFirebaseStore?.operationLocks?.leases?.[venueId])
      };
      state.tournament.liveId = id;
      state.tournament.venueId = venueId;
      state.tournament.activeRegistryGeneration = state.tournament.activeRegistryGeneration || "qa-live-lease-generation-v278";
      const currentLease = window.__qaFirebaseStore?.operationLocks?.leases?.[venueId];
      if (currentLease?.fenceToken) {
        state.tournament.liveWriteFenceV278 = currentLease.fenceToken;
        state.tournament.liveWriteFenceSequenceV278 = Number(currentLease.claimSequence || 0);
      }
      const seededPrivateState = exportState();
      window.__qaFirebaseStore.tournaments[id] = { state: JSON.parse(JSON.stringify(seededPrivateState)), updatedAt: seededPrivateState.updatedAt };
      window.__qaFirebaseStore.activeTournaments[venueId] = {
        venueId,
        venueName: currentVenueName(),
        tournamentId: id,
        registryGeneration: state.tournament.activeRegistryGeneration,
        tournamentName: state.tournament.name,
        status: "running",
        updatedAt: state.updatedAt
      };
      if (window.__qaFirebaseStore?.publicLive) delete window.__qaFirebaseStore.publicLive[id];
      if (typeof window.releaseOperationLeaseV178 === "function") {
        await window.releaseOperationLeaseV178(true, venueId);
      }
      await new Promise(resolve => setTimeout(resolve, 120));
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      const beforeCanPublish = typeof window.__mini4wdCanPublishLiveNowV270 === "function" ? window.__mini4wdCanPublishLiveNowV270("qa-before") : null;
      const syncResult = await Promise.race([
        Promise.resolve(syncOperatorLiveStateV269("operator-render-v270-qa")),
        new Promise(resolve => setTimeout(() => resolve("qa-sync-timeout-v278"), 6000))
      ]);
      await new Promise(resolve => setTimeout(resolve, 1100));
      const live = window.__qaFirebaseStore?.publicLive?.[id];
      const lease = window.__qaFirebaseStore?.operationLocks?.leases?.[venueId];
      return {
        id,
        beforeCanPublish,
        syncResult,
        syncTimedOut: syncResult === "qa-sync-timeout-v278",
        alertCount: alerts.length,
        alerts,
        leaseExists: !!lease,
        leaseSessionId: lease?.sessionId || "",
        publicExists: !!live,
        publicActiveRoundIndex: live?.state?.activeRoundIndex,
        publicBroadcast: live?.state?.broadcast,
        syncReason: live?.syncReason || "",
        canPublishAfter: typeof window.__mini4wdCanPublishLiveNowV270 === "function" ? window.__mini4wdCanPublishLiveNowV270("qa-after") : null
      };
    } finally {
      window.alert = originalAlert;
      state = normalizeImportedState(backupState);
      activeRoundIndex = backupActiveRoundIndex;
      state.activeRoundIndex = backupActiveRoundIndex;
      if (backupBroadcast) state.broadcast = backupBroadcast;
      if (firebaseFixtureBackup) {
        const store = window.__qaFirebaseStore;
        const restore = (collection, key, value) => {
          if (value === undefined) delete collection[key];
          else collection[key] = value;
        };
        restore(store.tournaments, firebaseFixtureBackup.id, firebaseFixtureBackup.tournament);
        restore(store.publicLive, firebaseFixtureBackup.id, firebaseFixtureBackup.publicLive);
        restore(store.activeTournaments, firebaseFixtureBackup.venueId, firebaseFixtureBackup.active);
        store.operationLocks = store.operationLocks || {};
        store.operationLocks.leases = store.operationLocks.leases || {};
        restore(store.operationLocks.leases, firebaseFixtureBackup.venueId, firebaseFixtureBackup.lease);
        if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      }
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "live-lease-retry-v270", info: { liveLeaseRetryV270 } });
  if (liveLeaseRetryV270.syncTimedOut || liveLeaseRetryV270.alertCount !== 0 || !liveLeaseRetryV270.leaseExists || !liveLeaseRetryV270.publicExists || liveLeaseRetryV270.publicActiveRoundIndex !== 1 || liveLeaseRetryV270.publicBroadcast?.roundIndex !== 1 || liveLeaseRetryV270.canPublishAfter !== true) {
    failures.push(`live lease retry v270 failed ${JSON.stringify(liveLeaseRetryV270)}`);
  }
  await showOperatorPage(page);

  const reloadMutationSetupV278 = await page.evaluate(async () => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const pendingRuntime = window.__mini4wdPendingMutationRuntimeV278;
    if (!pendingRuntime) return { supported: false };
    const sessionValue = key => {
      try { return sessionStorage.getItem(key); } catch (error) { return null; }
    };
    const original = {
      state: exportState(),
      activeRoundIndex,
      firebaseTournamentId,
      store: clone(window.__qaFirebaseStore),
      localIds: {
        tournamentId: localStorage.getItem("mini4wdTournamentId"),
        activeId: localStorage.getItem("mini4wdActiveLiveId"),
        signature: localStorage.getItem("mini4wdActiveLiveSignature")
      },
      session: {
        pending: sessionValue(pendingRuntime.pendingKey),
        ack: sessionValue(pendingRuntime.ackKey),
        revision: sessionValue("mini4wdLiveMutationRevisionV278")
      }
    };
    sessionStorage.setItem("__qaReloadRestoreV278", JSON.stringify(original));
    sessionStorage.removeItem(pendingRuntime.pendingKey);
    sessionStorage.removeItem(pendingRuntime.ackKey);
    sessionStorage.removeItem("mini4wdLiveMutationRevisionV278");

    const id = `qa-reload-mutation-v278-${Date.now()}`;
    const venueId = "qa-venue";
    const generation = `qa-reload-generation-${Date.now()}`;
    const playerId = "qa-reload-player-1";
    const next = makeInitialState(3);
    next.inputText = "Reload Racer A/QA\nReload Racer B/QA";
    next.settings = { ...next.settings, laneCount: 3, matchMode: "points3", firebaseAutoSave: true };
    next.tournament = {
      ...next.tournament,
      name: "QA Reload Mutation",
      venue: "QA Venue",
      venueId,
      status: "running",
      liveId: id,
      liveSignature: `${id}-signature`,
      activeRegistryGeneration: generation,
      lockedParticipants: next.inputText,
      startedAtISO: new Date().toISOString()
    };
    next.qualifierRounds = [{
      id: "qa-reload-round",
      index: 1,
      title: "1차 라운드",
      stagePlan: ["포인트 1차전"],
      finalist: null,
      stages: [{
        id: "qa-reload-stage",
        name: "포인트 1차전",
        type: "points",
        pointOptions: [0, 3, 5, 9],
        groups: [{
          id: "qa-reload-group",
          name: "1조",
          slots: [
            { id: playerId, name: "Reload Racer A", nickname: "Reload A", team: "QA", lane: 1 },
            { id: "qa-reload-player-2", name: "Reload Racer B", nickname: "Reload B", team: "QA", lane: 2 }
          ],
          advanceIds: [],
          points: {}
        }]
      }]
    }];
    next.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    next.activeRoundIndex = 0;
    next.updatedAt = Date.now();
    state = normalizeImportedState(next);
    activeRoundIndex = 0;
    firebaseTournamentId = id;
    localStorage.setItem("mini4wdTournamentId", id);
    localStorage.setItem("mini4wdActiveLiveId", id);
    localStorage.setItem("mini4wdActiveLiveSignature", state.tournament.liveSignature);
    persistCurrentState();

    const store = window.__qaFirebaseStore;
    store.tournaments[id] = { state: clone(exportState()), updatedAt: state.updatedAt };
    store.activeTournaments[venueId] = {
      venueId,
      venueName: "QA Venue",
      tournamentId: id,
      registryGeneration: generation,
      tournamentName: state.tournament.name,
      status: "running",
      updatedAt: state.updatedAt
    };
    const activeStartedLegacy = Boolean(
      !store.activeTournaments[venueId].protocolVersion
      && !store.activeTournaments[venueId].uid
      && !store.activeTournaments[venueId].fenceToken
      && !store.activeTournaments[venueId].fenceSequence
    );
    delete store.publicLive[id];
    await window.releaseOperationLeaseV178(true, venueId);
    const claimed = await window.claimOperationLeaseV178("qa-reload-base-v278", true, {
      venueId,
      venueName: "QA Venue",
      tournamentId: id,
      tournamentName: state.tournament.name,
      registryGeneration: generation,
      status: "running"
    });
    const baseSynced = claimed && await forceLiveBroadcastSync("qa-reload-base-v278");
    const basePrivate = store.tournaments[id]?.state || store.tournaments[id];
    const baseUpdatedAt = Number(basePrivate?.updatedAt || 0);
    const baseLease = store.operationLocks?.leases?.[venueId];
    const baseActive = store.activeTournaments?.[venueId];
    const baseActiveConvergedV279 = Boolean(
      baseActive?.protocolVersion === 279
      && baseActive?.uid === "qa-uid"
      && baseActive?.tournamentId === id
      && baseActive?.registryGeneration === generation
      && baseActive?.fenceToken === baseLease?.fenceToken
      && Number(baseActive?.fenceSequence || 0) === Number(baseLease?.claimSequence || 0)
      && Number(baseActive?.fenceSequence || 0) > 0
    );
    const oldLeaseSessionId = baseLease?.sessionId || "";
    const group = state.qualifierRounds[0].stages[0].groups[0];
    group.points[playerId] = 9;
    window.__qaRejectFirebaseTransactionPaths = [`tournaments/${id}`];
    saveLiveState();
    const pending = JSON.parse(sessionStorage.getItem(pendingRuntime.pendingKey) || "null");
    sessionStorage.setItem("__qaFirebaseStoreReloadV278", JSON.stringify(store));
    return {
      supported: true,
      id,
      venueId,
      generation,
      playerId,
      claimed,
      activeStartedLegacy,
      baseActiveConvergedV279,
      baseSynced,
      baseUpdatedAt,
      oldLeaseSessionId,
      pendingCreated: Boolean(pending?.eligible && pending?.state?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points?.[playerId] === 9)
    };
  });

  let reloadMutationReplayV278 = { ...reloadMutationSetupV278, replayed: false };
  if (reloadMutationSetupV278.supported && reloadMutationSetupV278.claimed && reloadMutationSetupV278.baseSynced) {
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(({ id, playerId }) => {
      const privateState = window.__qaFirebaseStore?.tournaments?.[id]?.state || window.__qaFirebaseStore?.tournaments?.[id];
      const publicState = window.__qaFirebaseStore?.publicLive?.[id]?.state;
      const privatePoints = privateState?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points || {};
      const publicPoints = publicState?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points || {};
      const pendingKey = window.__mini4wdPendingMutationRuntimeV278?.pendingKey || "";
      return privatePoints[playerId] === 9
        && Object.values(publicPoints).includes(9)
        && pendingKey
        && !sessionStorage.getItem(pendingKey);
    }, { id: reloadMutationSetupV278.id, playerId: reloadMutationSetupV278.playerId }, { timeout: 12000 });
    reloadMutationReplayV278 = await page.evaluate(setup => {
      const privateRecord = window.__qaFirebaseStore?.tournaments?.[setup.id];
      const privateState = privateRecord?.state || privateRecord;
      const publicState = window.__qaFirebaseStore?.publicLive?.[setup.id]?.state;
      const lease = window.__qaFirebaseStore?.operationLocks?.leases?.[setup.venueId];
      const active = window.__qaFirebaseStore?.activeTournaments?.[setup.venueId];
      const pendingKey = window.__mini4wdPendingMutationRuntimeV278?.pendingKey || "";
      return {
        ...setup,
        privateScore: privateState?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points?.[setup.playerId],
        publicScores: Object.values(publicState?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points || {}),
        localScore: state?.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.points?.[setup.playerId],
        envelopeProtocolVersion: Number(privateRecord?.protocolVersion || 0),
        stateProtocolVersion: Number(privateState?.remoteWriteProtocolV279 || 0),
        tournamentProtocolVersion: Number(privateState?.tournament?.remoteWriteProtocolV279 || 0),
        remoteUpdatedAt: Number(privateState?.updatedAt || 0),
        envelopeUpdatedAt: Number(privateRecord?.updatedAt || 0),
        newLeaseSessionId: lease?.sessionId || "",
        replayActiveConvergedV279: Boolean(
          active?.protocolVersion === 279
          && active?.uid === "qa-uid"
          && active?.tournamentId === setup.id
          && active?.registryGeneration === setup.generation
          && active?.fenceToken === lease?.fenceToken
          && Number(active?.fenceSequence || 0) === Number(lease?.claimSequence || 0)
          && Number(active?.fenceSequence || 0) > 0
        ),
        pendingCleared: Boolean(pendingKey && !sessionStorage.getItem(pendingKey)),
        conflictBackupAbsent: !localStorage.getItem(`mini4wdUnsyncedLiveConflictV278:${normalizeKey(setup.id)}`),
        replayed: true
      };
    }, reloadMutationSetupV278);
  }
  logs.push({ step: "reload-pending-mutation-v278", info: { reloadMutationReplayV278 } });
  if (
    !reloadMutationReplayV278.supported
    || !reloadMutationReplayV278.claimed
    || !reloadMutationReplayV278.activeStartedLegacy
    || !reloadMutationReplayV278.baseActiveConvergedV279
    || !reloadMutationReplayV278.baseSynced
    || !reloadMutationReplayV278.pendingCreated
    || !reloadMutationReplayV278.replayed
    || reloadMutationReplayV278.privateScore !== 9
    || !reloadMutationReplayV278.publicScores?.includes(9)
    || reloadMutationReplayV278.localScore !== 9
    || reloadMutationReplayV278.envelopeProtocolVersion !== 279
    || reloadMutationReplayV278.stateProtocolVersion !== 279
    || reloadMutationReplayV278.tournamentProtocolVersion !== 279
    || reloadMutationReplayV278.remoteUpdatedAt <= reloadMutationReplayV278.baseUpdatedAt
    || reloadMutationReplayV278.envelopeUpdatedAt !== reloadMutationReplayV278.remoteUpdatedAt
    || !reloadMutationReplayV278.newLeaseSessionId
    || reloadMutationReplayV278.newLeaseSessionId === reloadMutationReplayV278.oldLeaseSessionId
    || !reloadMutationReplayV278.replayActiveConvergedV279
    || !reloadMutationReplayV278.pendingCleared
    || !reloadMutationReplayV278.conflictBackupAbsent
  ) {
    failures.push(`reload pending mutation replay failed ${JSON.stringify(reloadMutationReplayV278)}`);
  }

  await page.evaluate(async () => {
    const original = JSON.parse(sessionStorage.getItem("__qaReloadRestoreV278") || "null");
    if (!original) return;
    const store = window.__qaFirebaseStore;
    Object.keys(store).forEach(key => delete store[key]);
    Object.assign(store, original.store || {});
    state = normalizeImportedState(original.state);
    activeRoundIndex = Number(original.activeRoundIndex || 0);
    state.activeRoundIndex = activeRoundIndex;
    firebaseTournamentId = original.firebaseTournamentId || "";
    const restoreLocal = (key, value) => value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    restoreLocal("mini4wdTournamentId", original.localIds?.tournamentId);
    restoreLocal("mini4wdActiveLiveId", original.localIds?.activeId);
    restoreLocal("mini4wdActiveLiveSignature", original.localIds?.signature);
    const runtime = window.__mini4wdPendingMutationRuntimeV278;
    const restoreSession = (key, value) => value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value);
    if (runtime) {
      restoreSession(runtime.pendingKey, original.session?.pending);
      restoreSession(runtime.ackKey, original.session?.ack);
    }
    restoreSession("mini4wdLiveMutationRevisionV278", original.session?.revision);
    sessionStorage.removeItem("__qaFirebaseStoreReloadV278");
    sessionStorage.removeItem("__qaReloadRestoreV278");
    window.__qaRejectFirebaseTransactionPaths = [];
    const venueId = normalizeKey(currentVenueId() || currentVenueName() || "default");
    if (state.tournament?.status === "running") {
      const id = getWritableTournamentIdV278(state);
      state.tournament.venueId = venueId;
      state.tournament.activeRegistryGeneration = state.tournament.activeRegistryGeneration || `qa-post-reload-generation-${Date.now()}`;
      delete state.tournament.liveWriteFenceV278;
      delete state.tournament.liveWriteFenceSequenceV278;
      state.updatedAt = Date.now();
      const privateState = exportState();
      store.tournaments[id] = { state: JSON.parse(JSON.stringify(privateState)), updatedAt: privateState.updatedAt };
      store.activeTournaments[venueId] = {
        venueId,
        venueName: state.tournament.venue || currentVenueName(),
        tournamentId: id,
        registryGeneration: state.tournament.activeRegistryGeneration,
        tournamentName: state.tournament.name,
        status: "running",
        updatedAt: state.updatedAt
      };
      store.publicLive[id] = makePublicLivePayload(privateState);
      await window.releaseOperationLeaseV178(true, venueId);
      await window.claimOperationLeaseV178("qa-post-reload-restore-v278", true, {
        venueId,
        venueName: state.tournament.venue || currentVenueName(),
        tournamentId: id,
        tournamentName: state.tournament.name,
        registryGeneration: state.tournament.activeRegistryGeneration,
        status: "running"
      });
    }
    persistCurrentState();
    if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
    renderOperator();
  });
  await showOperatorPage(page);

  let operatorMobileUndoV266 = { skipped: true, viewport };
  const isMobileUndoViewport = await page.evaluate(() => document.body.classList.contains("ui-mode-mobile") && !!document.querySelector(".operator-mobile-dock-v233"));
  if (isMobileUndoViewport) {
    const undoSnapshot = async () => page.evaluate(() => {
      const round = state.qualifierRounds[activeRoundIndex];
      const stage = round?.stages?.[round.stages.length - 1];
      const undo = document.querySelector(".operator-undo-float-v266");
      const undoRect = undo?.getBoundingClientRect();
      return {
        activeRoundIndex,
        stageCount: round?.stages?.length || 0,
        stageName: stage?.name || "",
        pointSelections: [...document.querySelectorAll(".point-buttons button.primary")].length,
        undoExists: !!undo,
        undoVisible: !!undoRect && undoRect.width > 0 && undoRect.height > 0,
        undoText: String(undo?.innerText || undo?.textContent || "").replace(/\s+/g, " ").trim(),
        undoBottom: undoRect ? Math.round(undoRect.bottom) : 0,
        dockTop: Math.round(document.querySelector(".operator-mobile-dock-v233")?.getBoundingClientRect().top || 0)
      };
    });
    await page.evaluate(() => {
      const round = state.qualifierRounds[activeRoundIndex];
      const stage = round?.stages?.[round.stages.length - 1];
      if (stage?.type !== "points") return;
      stage.groups.forEach(group => {
        group.points = group.points || {};
        (group.slots || []).filter(player => player && !player.isEmptyLane && !isPlayerWithdrawn(player.id)).forEach(player => {
          group.points[player.id] = 0;
        });
      });
      clearOperatorUndoSnapshotV266();
      renderOperator();
    });
    const beforeNext = await undoSnapshot();
    await page.locator(".operator-mobile-dock-v233 > button").first().click();
    await page.waitForTimeout(350);
    const afterNext = await undoSnapshot();
    if (await page.locator(".operator-undo-float-v266").count()) {
      await page.locator(".operator-undo-float-v266").click();
      await page.waitForTimeout(350);
    }
    const afterNextUndo = await undoSnapshot();
    await page.evaluate(() => {
      const round = state.qualifierRounds[activeRoundIndex];
      const stage = round?.stages?.[round.stages.length - 1];
      const group = stage?.groups?.[0];
      const player = (group?.slots || []).find(item => item && !item.isEmptyLane && !isPlayerWithdrawn(item.id));
      if (stage?.type === "points" && group && player) delete group.points[player.id];
      clearOperatorUndoSnapshotV266();
      renderOperator();
    });
    const beforeScore = await undoSnapshot();
    const firstPointButton = page.locator(".point-buttons").first().locator("button").first();
    await firstPointButton.click();
    await page.waitForTimeout(250);
    const afterScore = await undoSnapshot();
    if (await page.locator(".operator-undo-float-v266").count()) {
      await page.locator(".operator-undo-float-v266").click();
      await page.waitForTimeout(350);
    }
    const afterScoreUndo = await undoSnapshot();
    operatorMobileUndoV266 = { skipped: false, beforeNext, afterNext, afterNextUndo, beforeScore, afterScore, afterScoreUndo };
  }
  logs.push({ step: "operator-mobile-undo-v266", info: { operatorMobileUndoV266 } });
  if (!operatorMobileUndoV266.skipped) {
    if (operatorMobileUndoV266.afterNext.stageCount !== operatorMobileUndoV266.beforeNext.stageCount + 1 || !operatorMobileUndoV266.afterNext.undoVisible || operatorMobileUndoV266.afterNext.undoBottom >= operatorMobileUndoV266.afterNext.dockTop) {
      failures.push(`mobile undo did not appear above dock after next-game action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterNextUndo.stageCount !== operatorMobileUndoV266.beforeNext.stageCount || operatorMobileUndoV266.afterNextUndo.undoExists) {
      failures.push(`mobile undo did not restore next-game action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterScore.pointSelections <= operatorMobileUndoV266.beforeScore.pointSelections || !operatorMobileUndoV266.afterScore.undoVisible) {
      failures.push(`mobile undo did not appear after score action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterScoreUndo.pointSelections !== operatorMobileUndoV266.beforeScore.pointSelections || operatorMobileUndoV266.afterScoreUndo.undoExists) {
      failures.push(`mobile undo did not restore score action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
  }

  const pointButtons = await page.locator(".point-buttons button").count();
  if (pointButtons < 4) failures.push(`point buttons too few: ${pointButtons}`);
  const pointGroups = await page.locator(".point-buttons").count();
  for (let index = 0; index < Math.min(pointGroups, 8); index += 1) {
    await page.locator(".point-buttons").nth(index).locator("button").nth(index % 4).click();
    await page.waitForTimeout(120);
  }
  logs.push({ step: "point-scores", info: await assertNoUiBreakage(page, "point-scores", failures) });
  const selectedPointButtons = await page.locator(".point-buttons button.primary").count();
  if (selectedPointButtons < 1) failures.push("point score clicks did not leave a selected score");

  const operatorMutationLeaseV279 = await page.evaluate(async () => {
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const players = [
      { id: "qa-advance-a", name: "Advance A", team: "QA", lane: 1 },
      { id: "qa-advance-b", name: "Advance B", team: "QA", lane: 2 },
      { id: "qa-advance-c", name: "Advance C", team: "QA", lane: 3 }
    ];
    state.settings.matchMode = "basic";
    state.settings.laneCount = 3;
    state.tournament.status = "running";
    state.tournament.name = "QA Advance Selection";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds[0] = {
      id: "qa-advance-round",
      index: 0,
      title: "1차 라운드",
      finalist: null,
      stagePlan: [],
      stages: [{
        id: "qa-advance-stage",
        name: "본선",
        type: "normal",
        groups: [{ id: "qa-advance-group", name: "1조", slots: players, advanceIds: [] }]
      }]
    };
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    const venueId = "qa-venue";
    const id = `qa-operator-mutations-v278-${Date.now()}`;
    const generation = `qa-operator-mutations-generation-v278-${Date.now()}`;
    state.tournament.venueId = venueId;
    state.tournament.liveId = id;
    state.tournament.liveSignature = `${id}-signature`;
    state.tournament.activeRegistryGeneration = generation;
    state.updatedAt = Date.now();
    firebaseTournamentId = id;
    localStorage.setItem("mini4wdTournamentId", id);
    localStorage.setItem("mini4wdActiveLiveId", id);
    localStorage.setItem("mini4wdActiveLiveSignature", state.tournament.liveSignature);
    const store = window.__qaFirebaseStore;
    const privateState = exportState();
    store.tournaments[id] = { state: clone(privateState), updatedAt: privateState.updatedAt };
    store.activeTournaments[venueId] = {
      venueId,
      venueName: "QA Venue",
      tournamentId: id,
      registryGeneration: generation,
      tournamentName: state.tournament.name,
      status: "running",
      updatedAt: state.updatedAt
    };
    const activeStartedLegacy = Boolean(
      !store.activeTournaments[venueId].protocolVersion
      && !store.activeTournaments[venueId].uid
      && !store.activeTournaments[venueId].fenceToken
      && !store.activeTournaments[venueId].fenceSequence
    );
    store.publicLive[id] = makePublicLivePayload(privateState);
    await window.releaseOperationLeaseV178(true, venueId);
    const claimed = await window.claimOperationLeaseV178("qa-operator-mutations-v278", true, {
      venueId,
      venueName: "QA Venue",
      tournamentId: id,
      tournamentName: state.tournament.name,
      registryGeneration: generation,
      status: "running"
    });
    state.tournament.operationLock = {
      uid: "qa-stale-legacy-owner-v281",
      email: "stale-legacy-owner@example.invalid",
      lockedAt: new Date().toISOString(),
      expiresAt: Date.now() + (6 * 60 * 60 * 1000)
    };
    window.__qaOperationLeaseAlertsV281 = [];
    window.__qaOriginalOperationLeaseAlertV281 = window.alert;
    window.alert = message => window.__qaOperationLeaseAlertsV281.push(String(message || ""));
    const lease = store.operationLocks?.leases?.[venueId];
    const active = store.activeTournaments?.[venueId];
    persistCurrentState();
    renderOperator();
    return {
      claimed,
      activeStartedLegacy,
      activeConvergedV279: Boolean(
        active?.protocolVersion === 279
        && active?.uid === "qa-uid"
        && active?.tournamentId === id
        && active?.registryGeneration === generation
        && active?.fenceToken === lease?.fenceToken
        && Number(active?.fenceSequence || 0) === Number(lease?.claimSequence || 0)
        && Number(active?.fenceSequence || 0) > 0
      ),
      active,
      lease
    };
  });
  const operatorMutationLeaseClaimedV278 = Boolean(
    operatorMutationLeaseV279.claimed
    && operatorMutationLeaseV279.activeStartedLegacy
    && operatorMutationLeaseV279.activeConvergedV279
  );
  if (!operatorMutationLeaseClaimedV278) failures.push(`operator mutation fixture could not claim and converge exact v279 lease ${JSON.stringify(operatorMutationLeaseV279)}`);
  await page.waitForTimeout(300);
  const advanceBefore = await page.evaluate(() => {
    const group = state.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
    return { advanceIds: [...(group?.advanceIds || [])] };
  });
  await page.locator("button[onclick*='qa-advance-a']").first().click();
  await page.waitForTimeout(500);
  const advanceAfter = await page.evaluate(() => {
    const group = state.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0];
    const slot = [...document.querySelectorAll("button[onclick*='toggleAdvance']")]
      .find(button => String(button.getAttribute("onclick") || "").includes("qa-advance-a"));
    let storedSelected = false;
    try {
      const stored = JSON.parse(localStorage.getItem("mini4wdTournamentLiveState") || "{}");
      storedSelected = (stored.qualifierRounds?.[0]?.stages?.[0]?.groups?.[0]?.advanceIds || []).includes("qa-advance-a");
    } catch (error) {}
    const alerts = [...(window.__qaOperationLeaseAlertsV281 || [])];
    if (typeof window.__qaOriginalOperationLeaseAlertV281 === "function") {
      window.alert = window.__qaOriginalOperationLeaseAlertV281;
    }
    delete window.__qaOperationLeaseAlertsV281;
    delete window.__qaOriginalOperationLeaseAlertV281;
    const result = {
      advanceIds: [...(group?.advanceIds || [])],
      slotSelected: !!slot?.classList.contains("selected"),
      storedSelected,
      alerts,
      legacyOperationLockPresent: Boolean(state.tournament?.operationLock),
      legacyOperationControlCount: document.querySelectorAll("button[onclick*='acquireOperationLock'], button[onclick*='releaseOperationLock']").length,
      serverOperationPanelCount: document.querySelectorAll(".session-lease-panel-v178").length
    };
    state.tournament.operationLock = null;
    persistCurrentState();
    renderOperator();
    return result;
  });
  logs.push({ step: "operation-lease-single-authority-v281", info: { leaseClaimed: operatorMutationLeaseClaimedV278, lease: operatorMutationLeaseV279, before: advanceBefore, after: advanceAfter } });
  if (advanceBefore.advanceIds.includes("qa-advance-a")) failures.push("advance selection started preselected");
  if (!advanceAfter.advanceIds.includes("qa-advance-a")) failures.push(`advance click did not update advanceIds ${JSON.stringify(advanceAfter)}`);
  if (!advanceAfter.slotSelected) failures.push(`advance click did not leave selected UI ${JSON.stringify(advanceAfter)}`);
  if (!advanceAfter.storedSelected) failures.push(`advance click did not persist local state ${JSON.stringify(advanceAfter)}`);
  if (advanceAfter.alerts.length) failures.push(`stale legacy operation lock blocked the authoritative server lease ${JSON.stringify(advanceAfter.alerts)}`);
  if (advanceAfter.legacyOperationLockPresent) failures.push("stale legacy operation lock was not retired after the server lease became authoritative");
  if (advanceAfter.legacyOperationControlCount !== 0 || advanceAfter.serverOperationPanelCount !== 1) {
    failures.push(`operator ownership UI is duplicated or missing ${JSON.stringify(advanceAfter)}`);
  }

  await page.evaluate(() => {
    const players = [
      { id: "qa-point-final-a", name: "A", team: "QA", lane: 1 },
      { id: "qa-point-final-b", name: "B", team: "QA", lane: 2 },
      { id: "qa-point-final-c", name: "C", team: "QA", lane: 3 }
    ];
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.tournament.status = "running";
    state.tournament.name = "QA Point Final Trim";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds[0] = {
      id: "qa-point-final-round",
      index: 0,
      title: "1차 라운드",
      finalist: null,
      stagePlan: [],
      stages: [{
        id: "qa-point-final-stage",
        name: "포인트 상위 3명 결정전",
        type: "pointFinal",
        pointFinalRule: "top-score",
        meta: { sameTeam: 2 },
        groups: [{ id: "qa-point-final-group", name: "1조", slots: players, advanceIds: [] }]
      }]
    };
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
  });
  await page.waitForTimeout(300);
  const pointFinalTrim = await page.evaluate(() => {
    const card = document.querySelector(".point-final-stage-v239");
    const text = String(card?.innerText || card?.textContent || "");
    return {
      exists: !!card,
      headCount: card ? card.querySelectorAll(".operator-stage-head-v227").length : 0,
      hasPointFinalTitle: text.includes("포인트 상위 3명 결정전"),
      hasSameTeamCopy: text.includes("같은 팀"),
      text: text.slice(0, 180)
    };
  });
  logs.push({ step: "point-final-trim", info: { pointFinalTrim } });
  if (!pointFinalTrim.exists) failures.push(`point final trim card missing ${JSON.stringify(pointFinalTrim)}`);
  if (pointFinalTrim.headCount !== 0) failures.push(`point final header still visible ${JSON.stringify(pointFinalTrim)}`);
  if (pointFinalTrim.hasPointFinalTitle || pointFinalTrim.hasSameTeamCopy) failures.push(`point final removed copy still visible ${JSON.stringify(pointFinalTrim)}`);

  const pointFinalNextRound = await page.evaluate(async () => {
    state.inputText = ["A/QA", "B/QA", "C/QA", "D/QA", "E/QA", "F/QA"].join("\n");
    const parsed = parseParticipants();
    const pointFinalists = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.settings.excludeFinalists = true;
    state.tournament.status = "running";
    state.tournament.name = "QA Point Final Next";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-point-next-round-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].stages = [{
      id: "qa-point-next-final-stage",
      name: "포인트 상위 결정전",
      type: "pointFinal",
      pointFinalRule: "top-score",
      groups: [{ id: "qa-point-next-final-group", name: "1조", slots: pointFinalists, advanceIds: [pointFinalists[0].id] }]
    }];
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
    const primary = [...document.querySelectorAll("button")]
      .find(button => {
        const onclick = String(button.getAttribute("onclick") || "");
        const rect = button.getBoundingClientRect();
        return onclick.includes("goToNextRoundAfterFinalist(0)") && rect.width > 0 && rect.height > 0;
      });
    const before = {
      buttonText: String(primary?.innerText || primary?.textContent || "").replace(/\s+/g, " ").trim(),
      onClick: String(primary?.getAttribute("onclick") || ""),
      activeRoundIndex,
      finalist: state.qualifierRounds[0].finalist?.id || "",
      nextStageCount: state.qualifierRounds[1].stages.length
    };
    if (primary) primary.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      before,
      after: {
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        finalist: state.qualifierRounds[0].finalist?.id || "",
        nextStageCount: state.qualifierRounds[1].stages.length,
        broadcastRoundIndex: state.broadcast?.roundIndex,
        broadcastStageIndex: state.broadcast?.stageIndex,
        nextStagePlayerIds: (state.qualifierRounds[1].stages[0]?.groups || [])
          .flatMap(group => group.slots || [])
          .filter(player => !player.isEmptyLane)
          .map(player => player.id)
      }
    };
  });
  const legacyPointFinalNextRound = await page.evaluate(async () => {
    state.inputText = ["Legacy A/QA", "Legacy B/QA", "Legacy C/QA", "Legacy D/QA", "Legacy E/QA", "Legacy F/QA"].join("\n");
    const parsed = parseParticipants();
    const pointFinalists = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.settings.excludeFinalists = true;
    state.tournament.status = "running";
    state.tournament.name = "QA Legacy Point Final Next";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-legacy-point-next-round-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].stages = [{
      id: "qa-legacy-point-next-final-stage",
      name: "포인트 상위 3명 결정전",
      groups: [{ id: "qa-legacy-point-next-final-group", name: "1조", slots: pointFinalists, advanceIds: [pointFinalists[0].id] }]
    }];
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
    const primary = [...document.querySelectorAll("button")]
      .find(button => {
        const onclick = String(button.getAttribute("onclick") || "");
        const rect = button.getBoundingClientRect();
        return onclick.includes("goToNextRoundAfterFinalist(0)") && rect.width > 0 && rect.height > 0;
      });
    const before = {
      buttonText: String(primary?.innerText || primary?.textContent || "").replace(/\s+/g, " ").trim(),
      onClick: String(primary?.getAttribute("onclick") || ""),
      stageType: state.qualifierRounds[0].stages[0].type || "",
      finalist: state.qualifierRounds[0].finalist?.id || "",
      nextStageCount: state.qualifierRounds[1].stages.length
    };
    if (primary) primary.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rows = getStageResultRows();
    const selectedRow = rows.find(row => row["단계"] === "포인트 상위 3명 결정전" && row["선수명"] === pointFinalists[0].name);
    return {
      before,
      after: {
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        finalist: state.qualifierRounds[0].finalist?.id || "",
        nextStageCount: state.qualifierRounds[1].stages.length,
        broadcastRoundIndex: state.broadcast?.roundIndex,
        broadcastStageIndex: state.broadcast?.stageIndex,
        selectedResult: selectedRow?.["결과"] || "",
        nextStagePlayerIds: (state.qualifierRounds[1].stages[0]?.groups || [])
          .flatMap(group => group.slots || [])
          .filter(player => !player.isEmptyLane)
          .map(player => player.id)
      }
    };
  });
  const pointFinalRoundTwoAdvance = await page.evaluate(async () => {
    const round = state.qualifierRounds[1];
    const stage = round?.stages?.[0];
    const group = stage?.groups?.find(item => (item.slots || []).some(slot => !slot.isEmptyLane));
    const player = group?.slots?.find(slot => !slot.isEmptyLane);
    const button = player ? [...document.querySelectorAll("button.operator-slot-v227")]
      .find(item => String(item.getAttribute("onclick") || "").includes(`'${player.id}'`)) : null;
    const before = {
      activeRoundIndex,
      stateActiveRoundIndex: state.activeRoundIndex,
      stageType: stage?.type || "",
      groupId: group?.id || "",
      playerId: player?.id || "",
      onClick: String(button?.getAttribute("onclick") || ""),
      advanceIds: [...(group?.advanceIds || [])]
    };
    if (button) button.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const freshButton = player ? [...document.querySelectorAll("button.operator-slot-v227")]
      .find(item => String(item.getAttribute("onclick") || "").includes(`'${player.id}'`)) : null;
    const freshStyle = freshButton ? getComputedStyle(freshButton) : null;
    return {
      before,
      after: {
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        advanceIds: [...(group?.advanceIds || [])],
        selectedClass: !!freshButton?.classList.contains("selected"),
        selectedBackground: freshStyle?.backgroundColor || "",
        selectedBorder: freshStyle?.borderTopColor || "",
        selectedShadow: freshStyle?.boxShadow || "",
        freshText: String(freshButton?.innerText || freshButton?.textContent || "").replace(/\s+/g, " ").trim(),
        storedSelected: (() => {
          try {
            const stored = JSON.parse(localStorage.getItem("mini4wdTournamentLiveState") || "{}");
            return (stored.qualifierRounds?.[1]?.stages?.[0]?.groups || [])
              .some(storedGroup => (storedGroup.advanceIds || []).includes(player?.id));
          } catch (error) {
            return false;
          }
        })()
      }
    };
  });
  const pointFinalConfirmedDock = await page.evaluate(async () => {
    state.inputText = ["A/QA", "B/QA", "C/QA", "D/QA", "E/QA", "F/QA"].join("\n");
    const parsed = parseParticipants();
    const pointFinalists = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.settings.excludeFinalists = true;
    state.tournament.status = "running";
    state.tournament.name = "QA Point Final Confirmed Dock";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-point-confirmed-dock-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].stages = [{
      id: "qa-point-confirmed-dock-stage",
      name: "포인트 상위 결정전",
      type: "pointFinal",
      pointFinalRule: "top-score",
      groups: [{ id: "qa-point-confirmed-dock-group", name: "1조", slots: pointFinalists, advanceIds: [pointFinalists[0].id] }]
    }];
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
    const dockBefore = document.querySelector(".operator-mobile-dock-v233 > button");
    const confirmButton = [...document.querySelectorAll("button")]
      .find(button => String(button.getAttribute("onclick") || "").includes("confirmRoundFinalist(0)") && button.getBoundingClientRect().width > 0);
    const before = {
      dockText: String(dockBefore?.innerText || dockBefore?.textContent || "").replace(/\s+/g, " ").trim(),
      dockOnClick: String(dockBefore?.getAttribute("onclick") || ""),
      confirmText: String(confirmButton?.innerText || confirmButton?.textContent || "").replace(/\s+/g, " ").trim(),
      confirmOnClick: String(confirmButton?.getAttribute("onclick") || "")
    };
    if (confirmButton) confirmButton.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dockAfter = document.querySelector(".operator-mobile-dock-v233 > button");
    const rect = dockAfter?.getBoundingClientRect();
    let textOverflow = false;
    try {
      const range = document.createRange();
      range.selectNodeContents(dockAfter);
      const textRects = [...range.getClientRects()].filter(item => item.width > 0 && item.height > 0);
      if (rect && textRects.length) {
        textOverflow = Math.min(...textRects.map(item => item.left)) < rect.left - 1
          || Math.max(...textRects.map(item => item.right)) > rect.right + 1;
      }
      range.detach();
    } catch (error) {}
    return {
      before,
      after: {
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        finalist: state.qualifierRounds[0].finalist?.id || "",
        nextStageCount: state.qualifierRounds[1].stages.length,
        dockText: String(dockAfter?.innerText || dockAfter?.textContent || "").replace(/\s+/g, " ").trim(),
        dockOnClick: String(dockAfter?.getAttribute("onclick") || ""),
        dockWidth: rect ? Math.round(rect.width) : 0,
        textOverflow
      }
    };
  });
  const pointFinalReadyDockClick = await page.evaluate(async () => {
    state.inputText = ["A/QA", "B/QA", "C/QA", "D/QA", "E/QA", "F/QA"].join("\n");
    const parsed = parseParticipants();
    const pointFinalists = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.settings.excludeFinalists = true;
    state.tournament.status = "running";
    state.tournament.name = "QA Point Final Ready Dock";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-point-ready-dock-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].finalist = pointFinalists[0];
    state.qualifierRounds[0].stages = [{
      id: "qa-point-ready-dock-stage",
      name: "포인트 상위 결정전",
      type: "pointFinal",
      pointFinalRule: "top-score",
      groups: [{ id: "qa-point-ready-dock-group", name: "1조", slots: pointFinalists, advanceIds: [pointFinalists[0].id] }]
    }];
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
    const dockBefore = document.querySelector(".operator-mobile-dock-v233 > button");
    const before = {
      dockText: String(dockBefore?.innerText || dockBefore?.textContent || "").replace(/\s+/g, " ").trim(),
      dockOnClick: String(dockBefore?.getAttribute("onclick") || "")
    };
    if (dockBefore) dockBefore.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dockAfter = document.querySelector(".operator-mobile-dock-v233 > button");
    return {
      before,
      after: {
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        nextStageCount: state.qualifierRounds[1].stages.length,
        dockText: String(dockAfter?.innerText || dockAfter?.textContent || "").replace(/\s+/g, " ").trim(),
        broadcastRoundIndex: state.broadcast?.roundIndex
      }
    };
  });
  const pointFinalNoFinalistV275 = await page.evaluate(async () => {
    state.inputText = ["NF A/QA", "NF B/QA", "NF C/QA", "NF D/QA", "NF E/QA", "NF F/QA"].join("\n");
    const parsed = parseParticipants();
    const pointFinalists = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.settings.excludeFinalists = true;
    state.tournament.status = "running";
    state.tournament.name = "QA Point Final No Finalist";
    state.tournament.venue = "QA Venue";
    state.tournament.withdrawnPlayerIds = pointFinalists.map(player => player.id);
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-point-no-finalist-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      noFinalist: false,
      finalistStatus: "",
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].stages = [{
      id: "qa-point-no-finalist-stage",
      name: "포인트 상위 결정전",
      type: "pointFinal",
      pointFinalRule: "top-score",
      groups: [{ id: "qa-point-no-finalist-group", name: "1조", slots: pointFinalists, advanceIds: [pointFinalists[0].id] }]
    }];
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
    renderOperator();
    const dockBefore = document.querySelector(".operator-mobile-dock-v233 > button");
    const noFinalistButton = [...document.querySelectorAll("button")]
      .find(button => String(button.getAttribute("onclick") || "").includes("confirmNoFinalistV275(0)") && button.getBoundingClientRect().width > 0);
    const before = {
      dockText: String(dockBefore?.innerText || dockBefore?.textContent || "").replace(/\s+/g, " ").trim(),
      dockOnClick: String(dockBefore?.getAttribute("onclick") || ""),
      noFinalistText: String(noFinalistButton?.innerText || noFinalistButton?.textContent || "").replace(/\s+/g, " ").trim(),
      noFinalistOnClick: String(noFinalistButton?.getAttribute("onclick") || "")
    };
    if (dockBefore) dockBefore.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nextPlayers = (state.qualifierRounds[1].stages[0]?.groups || [])
      .flatMap(group => group.slots || [])
      .filter(player => !player.isEmptyLane)
      .map(player => player.id);
    return {
      before,
      after: {
        roundNoFinalist: !!state.qualifierRounds[0].noFinalist,
        finalist: state.qualifierRounds[0].finalist?.id || "",
        activeRoundIndex,
        stateActiveRoundIndex: state.activeRoundIndex,
        broadcastRoundIndex: state.broadcast?.roundIndex,
        nextStageCount: state.qualifierRounds[1].stages.length,
        nextPlayers,
        withdrawnIds: state.tournament.withdrawnPlayerIds.slice(),
        roundStatus: getRoundStatus(state.qualifierRounds[0])
      }
    };
  });
  const finalRaceNoFinalistV275 = await page.evaluate(() => {
    state.inputText = ["F A/QA", "F B/QA", "F C/QA", "F D/QA"].join("\n");
    const parsed = parseParticipants();
    state.settings.matchMode = "points3";
    state.settings.laneCount = 5;
    state.tournament.status = "running";
    state.tournament.name = "QA Partial Final";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-partial-final-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      noFinalist: false,
      finalistStatus: "",
      stagePlan: [],
      stages: []
    }));
    state.qualifierRounds[0].finalist = parsed[0];
    state.qualifierRounds[1].noFinalist = true;
    state.qualifierRounds[1].finalistStatus = "none";
    state.qualifierRounds[2].finalist = parsed[1];
    activeRoundIndex = 2;
    state.activeRoundIndex = 2;
    renderOperator();
    createFinalRace();
    const groups = getFinalGroups();
    const actualFinalists = groups.flatMap(group => group.slots || []).filter(player => !player.isEmptyLane);
    const twoFinalists = {
      finalExists: !!state.finalRace,
      groupSize: state.finalRace?.groupSize || 0,
      settingLaneCount: state.settings.laneCount,
      actualFinalistCount: actualFinalists.length,
      finalistIds: actualFinalists.map(player => player.id)
    };
    state.finalRace = null;
    state.qualifierRounds.forEach(round => {
      round.finalist = null;
      round.noFinalist = true;
      round.finalistStatus = "none";
    });
    renderOperator();
    createFinalRace();
    const unavailableError = String(document.getElementById("error")?.textContent || "");
    return {
      twoFinalists,
      zeroFinalists: {
        finalExists: !!state.finalRace,
        error: unavailableError,
        dockText: String(document.querySelector(".operator-mobile-dock-v233 > button")?.innerText || "").replace(/\s+/g, " ").trim()
      }
    };
  });
  const crowNoFinalistV275 = await page.evaluate(() => {
    state.inputText = ["C A/QA", "C B/QA", "C C/QA", "C D/QA", "C E/QA", "C F/QA", "C G/QA", "C H/QA", "C I/QA"].join("\n");
    const parsed = parseParticipants();
    state.settings.matchMode = "crow";
    state.settings.laneCount = 3;
    state.tournament.status = "running";
    state.tournament.name = "QA Crow No Finalist";
    state.tournament.venue = "QA Venue";
    state.finalRace = null;
    state.qualifierRounds = [0, 1, 2].map(index => ({
      id: `qa-crow-no-finalist-${index + 1}`,
      index: index + 1,
      title: `${index + 1}차 라운드`,
      finalist: null,
      crowFinalists: [],
      noFinalist: false,
      finalistStatus: "",
      stagePlan: [],
      stages: []
    }));
    [0, 1].forEach(roundIndex => {
      const crowFinalists = parsed.slice(roundIndex * 3, roundIndex * 3 + 3).map((player, index) => ({
        ...player,
        crowRank: index + 1,
        sourceRoundIndex: roundIndex + 1
      }));
      state.qualifierRounds[roundIndex].crowFinalists = crowFinalists;
      state.qualifierRounds[roundIndex].finalist = crowFinalists[0];
    });
    state.qualifierRounds[2].noFinalist = true;
    state.qualifierRounds[2].finalistStatus = "none";
    state.qualifierRounds[2].noFinalistReason = "all-withdrawn";
    activeRoundIndex = 2;
    state.activeRoundIndex = 2;
    renderOperator();
    const dockBefore = document.querySelector(".operator-mobile-dock-v233 > button");
    const before = {
      dockText: String(dockBefore?.innerText || dockBefore?.textContent || "").replace(/\s+/g, " ").trim(),
      dockOnClick: String(dockBefore?.getAttribute("onclick") || "")
    };
    createFinalRace();
    const error = String(document.getElementById("error")?.textContent || "");
    return {
      before,
      after: {
        finalExists: !!state.finalRace,
        error,
        qualifiedCount: getCrowQualifiedCountV275(),
        allComplete: areCrowRoundsCompleteV275()
      }
    };
  });
  logs.push({ step: "point-final-next-round", info: { pointFinalNextRound } });
  logs.push({ step: "legacy-point-final-next-round", info: { legacyPointFinalNextRound } });
  logs.push({ step: "point-final-round-two-advance", info: { pointFinalRoundTwoAdvance } });
  logs.push({ step: "point-final-confirmed-dock", info: { pointFinalConfirmedDock } });
  logs.push({ step: "point-final-ready-dock-click", info: { pointFinalReadyDockClick } });
  logs.push({ step: "point-final-no-finalist-v275", info: { pointFinalNoFinalistV275 } });
  logs.push({ step: "final-race-no-finalist-v275", info: { finalRaceNoFinalistV275 } });
  logs.push({ step: "crow-no-finalist-v275", info: { crowNoFinalistV275 } });
  if (!pointFinalNextRound.before.onClick.includes("goToNextRoundAfterFinalist(0)")) {
    failures.push(`point final next-round primary missing ${JSON.stringify(pointFinalNextRound)}`);
  }
  if (!pointFinalNextRound.after.finalist || pointFinalNextRound.after.activeRoundIndex !== 1 || pointFinalNextRound.after.stateActiveRoundIndex !== 1 || pointFinalNextRound.after.broadcastRoundIndex !== 1 || pointFinalNextRound.after.nextStageCount < 1) {
    failures.push(`point final next-round button did not confirm and advance ${JSON.stringify(pointFinalNextRound)}`);
  }
  if (pointFinalNextRound.after.nextStagePlayerIds.includes(pointFinalNextRound.after.finalist)) {
    failures.push(`point final next-round did not exclude finalist ${JSON.stringify(pointFinalNextRound)}`);
  }
  if (legacyPointFinalNextRound.before.stageType || !legacyPointFinalNextRound.before.onClick.includes("goToNextRoundAfterFinalist(0)") || legacyPointFinalNextRound.before.buttonText !== "진출 확정") {
    failures.push(`legacy point final primary did not normalize to confirm-and-next ${JSON.stringify(legacyPointFinalNextRound)}`);
  }
  if (!legacyPointFinalNextRound.after.finalist || legacyPointFinalNextRound.after.activeRoundIndex !== 1 || legacyPointFinalNextRound.after.stateActiveRoundIndex !== 1 || legacyPointFinalNextRound.after.broadcastRoundIndex !== 1 || legacyPointFinalNextRound.after.nextStageCount < 1 || legacyPointFinalNextRound.after.selectedResult !== "최종결승진출") {
    failures.push(`legacy point final next-round did not confirm as finalist and advance ${JSON.stringify(legacyPointFinalNextRound)}`);
  }
  if (legacyPointFinalNextRound.after.nextStagePlayerIds.includes(legacyPointFinalNextRound.after.finalist)) {
    failures.push(`legacy point final next-round did not exclude finalist ${JSON.stringify(legacyPointFinalNextRound)}`);
  }
  if (pointFinalConfirmedDock.before.dockText !== "진출 확정" || !pointFinalConfirmedDock.before.confirmOnClick.includes("confirmRoundFinalist(0)")) {
    failures.push(`point final confirm path setup mismatch ${JSON.stringify(pointFinalConfirmedDock)}`);
  }
  if (!pointFinalConfirmedDock.after.finalist || pointFinalConfirmedDock.after.activeRoundIndex !== 1 || pointFinalConfirmedDock.after.stateActiveRoundIndex !== 1 || pointFinalConfirmedDock.after.nextStageCount < 1 || pointFinalConfirmedDock.after.textOverflow) {
    failures.push(`point final confirm path did not advance cleanly ${JSON.stringify(pointFinalConfirmedDock)}`);
  }
  if (pointFinalReadyDockClick.before.dockText !== "다음 라운드" || !pointFinalReadyDockClick.before.dockOnClick.includes("goToNextRoundAfterFinalist(0)")) {
    failures.push(`point final ready dock label/click mismatch ${JSON.stringify(pointFinalReadyDockClick)}`);
  }
  if (pointFinalReadyDockClick.after.activeRoundIndex !== 1 || pointFinalReadyDockClick.after.stateActiveRoundIndex !== 1 || pointFinalReadyDockClick.after.nextStageCount < 1 || pointFinalReadyDockClick.after.broadcastRoundIndex !== 1) {
    failures.push(`point final ready dock click did not advance ${JSON.stringify(pointFinalReadyDockClick)}`);
  }
  if (!pointFinalNoFinalistV275.before.dockOnClick.includes("confirmNoFinalistV275(0") || !pointFinalNoFinalistV275.before.noFinalistOnClick.includes("confirmNoFinalistV275(0")) {
    failures.push(`point final no-finalist controls missing ${JSON.stringify(pointFinalNoFinalistV275)}`);
  }
  if (!pointFinalNoFinalistV275.after.roundNoFinalist || pointFinalNoFinalistV275.after.finalist || pointFinalNoFinalistV275.after.activeRoundIndex !== 1 || pointFinalNoFinalistV275.after.nextStageCount < 1) {
    failures.push(`point final no-finalist did not complete and advance ${JSON.stringify(pointFinalNoFinalistV275)}`);
  }
  if (pointFinalNoFinalistV275.after.nextPlayers.some(id => pointFinalNoFinalistV275.after.withdrawnIds.includes(id))) {
    failures.push(`point final no-finalist next round kept withdrawn players ${JSON.stringify(pointFinalNoFinalistV275)}`);
  }
  if (!finalRaceNoFinalistV275.twoFinalists.finalExists || finalRaceNoFinalistV275.twoFinalists.groupSize !== 2 || finalRaceNoFinalistV275.twoFinalists.settingLaneCount !== 5 || finalRaceNoFinalistV275.twoFinalists.actualFinalistCount !== 2) {
    failures.push(`partial final race creation failed ${JSON.stringify(finalRaceNoFinalistV275)}`);
  }
  if (finalRaceNoFinalistV275.zeroFinalists.finalExists || !finalRaceNoFinalistV275.zeroFinalists.error.includes("최종 결승 진출자가 없습니다") || finalRaceNoFinalistV275.zeroFinalists.dockText !== "결승 미성립") {
    failures.push(`zero-finalist unavailable state failed ${JSON.stringify(finalRaceNoFinalistV275)}`);
  }
  if (crowNoFinalistV275.before.dockText !== "9강 미성립" || !crowNoFinalistV275.before.dockOnClick.includes("showCrowSemiUnavailableV275")) {
    failures.push(`crow no-finalist dock unavailable state failed ${JSON.stringify(crowNoFinalistV275)}`);
  }
  if (crowNoFinalistV275.after.finalExists || crowNoFinalistV275.after.qualifiedCount !== 6 || !crowNoFinalistV275.after.allComplete || !crowNoFinalistV275.after.error.includes("9강 준결 진출자가 6명")) {
    failures.push(`crow no-finalist unavailable action failed ${JSON.stringify(crowNoFinalistV275)}`);
  }
  const pointFinalRoundTwoSelectedVisual = pointFinalRoundTwoAdvance.after.selectedBackground
    && pointFinalRoundTwoAdvance.after.selectedBackground !== "rgb(255, 255, 255)";
  if (!pointFinalRoundTwoAdvance.before.playerId || !pointFinalRoundTwoAdvance.before.onClick.includes("toggleAdvance(1, 0") || !pointFinalRoundTwoAdvance.after.advanceIds.includes(pointFinalRoundTwoAdvance.before.playerId) || !pointFinalRoundTwoAdvance.after.selectedClass || !pointFinalRoundTwoSelectedVisual) {
    failures.push(`point final round-two advance click did not select winner ${JSON.stringify(pointFinalRoundTwoAdvance)}`);
  }

  const finalistRows = await page.evaluate(() => {
    const park = { id: "qa-park", name: "박태진", team: "Brilliant", lane: 1 };
    const rival = id => ({ id, name: `상대${id}`, team: "QA", lane: 2 });
    state.tournament.name = "QA Result Rows";
    state.tournament.venue = "QA Venue";
    state.tournament.raceClass = "오픈";
    state.qualifierRounds[2] = {
      id: "qa-round-3",
      index: 2,
      title: "3차 라운드",
      finalist: { id: park.id, name: park.name, team: park.team },
      stagePlan: [],
      stages: [
        {
          id: "qa-stage-3-semi-a",
          name: "준결승",
          type: "normal",
          groups: [{ id: "qa-group-3", name: "3조", slots: [{ ...park, lane: 2 }, { ...rival("A"), lane: 3 }], advanceIds: [park.id] }]
        },
        {
          id: "qa-stage-3-semi-b",
          name: "준결승",
          type: "normal",
          groups: [{ id: "qa-group-1", name: "1조", slots: [{ ...rival("B"), lane: 1 }, { ...park, lane: 3 }], advanceIds: [park.id] }]
        },
        {
          id: "qa-stage-3-final",
          name: "라운드 결승",
          type: "normal",
          groups: [{ id: "qa-group-final", name: "1조", slots: [{ ...rival("C"), lane: 1 }, { ...rival("D"), lane: 2 }, { ...park, lane: 3 }], advanceIds: [park.id] }]
        }
      ]
    };
    return getStageResultRows()
      .filter(row => row.차수 === "3차 라운드" && row.선수명 === "박태진")
      .map(row => ({ step: row.단계, group: row.조, result: row.결과 }));
  });
  const finalistResults = finalistRows.map(row => row.result);
  if (JSON.stringify(finalistResults) !== JSON.stringify(["진출", "진출", "최종결승진출"])) {
    failures.push(`finalist row regression ${JSON.stringify(finalistRows)}`);
  }

  await page.evaluate(() => {
    state.settings.matchMode = "basic";
    state.tournament.status = "ready";
    state.finalRace = null;
    state.qualifierRounds = makeQualifierRounds(state.settings.laneCount, state.settings.matchMode);
    activeRoundIndex = 0;
    state.activeRoundIndex = 0;
    state.broadcast = { mode: "none", roundIndex: null, stageIndex: null };
    renderOperator();
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    if (typeof window.scrollOperatorSectionV147 === "function") window.scrollOperatorSectionV147("operatorOpsAreaV183");
  });
  await page.waitForTimeout(350);
  const opsPanel = await page.evaluate(() => {
    const element = document.getElementById("operatorOpsAreaV183");
    const rect = element?.getBoundingClientRect();
    return {
      exists: !!element,
      isDetails: element?.tagName === "DETAILS",
      height: rect ? Math.round(rect.height) : 0
    };
  });
  if (!opsPanel.exists || opsPanel.isDetails || opsPanel.height <= 0) failures.push(`operator ops dock target is not a visible static panel ${JSON.stringify(opsPanel)}`);
  const opsInfo = await assertNoUiBreakage(page, "ops-open", failures);
  const leaseLayout = await page.evaluate(() => {
    const head = document.querySelector(".session-lease-head-v178");
    const title = head?.querySelector("strong");
    const actions = head?.querySelector(".session-actions-v178");
    const panel = document.querySelector(".session-lease-panel-v178");
    const titleRect = title?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return {
      exists: !!head,
      titleWidth: titleRect ? Math.round(titleRect.width) : 0,
      titleHeight: titleRect ? Math.round(titleRect.height) : 0,
      panelWidth: panelRect ? Math.round(panelRect.width) : 0,
      actionsBelowTitle: !!(titleRect && actionsRect && actionsRect.top >= titleRect.bottom - 2),
      actionColumns: actions ? getComputedStyle(actions).gridTemplateColumns.split(" ").length : 0
    };
  });
  logs.push({ step: "ops-open", info: { ...opsInfo, leaseLayout } });
  if (!leaseLayout.exists) failures.push("operation lease panel missing");
  if (viewport.width <= 760 && leaseLayout.titleWidth < Math.min(140, leaseLayout.panelWidth * 0.45)) {
    failures.push(`operation lease title squeezed ${JSON.stringify(leaseLayout)}`);
  }
  if (!leaseLayout.actionsBelowTitle) failures.push(`operation lease actions overlap title row ${JSON.stringify(leaseLayout)}`);

  await page.evaluate(() => {
    const players = Array.from({ length: 24 }, (_, index) => {
      const venue = ["QA Venue", "Athens", "Gimhae"][index % 3];
      const venueId = venue.toLowerCase().replace(/\s+/g, "-");
      return {
        id: `qa-roster-${index}`,
        realName: `Racer${String(index).padStart(2, "0")}`,
        nickname: `Nick${String(index).padStart(2, "0")}`,
        team: ["ATHENS", "UDG", "RC"][index % 3],
        contact: index % 4 === 0 ? "" : `010${String(63000000 + index).padStart(8, "0")}`,
        memo: index % 5 === 0 ? "memo" : "",
        favorite: index % 4 === 0,
        active: index % 6 !== 0,
        venueId,
        venueName: venue,
        createdAt: new Date(Date.now() - index * 86400000).toISOString()
      };
    });
    const venues = {};
    players.forEach(player => {
      venues[player.venueId] = venues[player.venueId] || { players: {} };
      venues[player.venueId].players[player.id] = player;
    });
    if (window.__qaFirebaseStore) window.__qaFirebaseStore.venues = venues;
    if (typeof window.saveRoster === "function") window.saveRoster(players);
  });

  if (viewport.width <= 760) {
    await showOperatorPage(page);
    if (await clickOperatorMobileRoute(page, "선수", failures)) {
      await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "player-management", null, { timeout: 10000 });
      logs.push({ step: "mobile-route-db-click", info: await assertNoUiBreakage(page, "mobile-route-db-click", failures) });
    }

    await showOperatorPage(page);
    if (await clickOperatorMobileRoute(page, "기록", failures)) {
      await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "dashboard", null, { timeout: 10000 });
      logs.push({ step: "mobile-route-dashboard-click", info: await assertNoUiBreakage(page, "mobile-route-dashboard-click", failures) });
    }

    await showOperatorPage(page);
    const livePopupPromise = page.waitForEvent("popup", { timeout: 3000 }).catch(() => null);
    const liveRouteBeforeV267 = await page.evaluate(() => ({
      status: state?.tournament?.status || "",
      id: typeof getCurrentTournamentId === "function" ? getCurrentTournamentId() : ""
    }));
    if (await clickOperatorMobileRoute(page, "라이브", failures)) {
      const livePopup = await livePopupPromise;
      const liveUrl = livePopup ? livePopup.url() : "";
      logs.push({ step: "mobile-route-live-click", info: { popup: !!livePopup, url: liveUrl, before: liveRouteBeforeV267 } });
      const expectedLiveRoute = liveRouteBeforeV267.status === "running" ? "#view=mobile-live&t=" : "#view=live-lobby";
      if (!livePopup || !liveUrl.includes(expectedLiveRoute)) failures.push(`mobile live route did not open expected route ${expectedLiveRoute}: ${liveUrl}`);
      if (livePopup) await livePopup.close().catch(() => {});
    }

    await showOperatorPage(page);
    if (await clickOperatorMobileRoute(page, "관리", failures)) {
      await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "admin-accounts", null, { timeout: 10000 });
      logs.push({ step: "mobile-route-admin-click", info: await assertNoUiBreakage(page, "mobile-route-admin-click", failures) });
    }
  }

  await page.evaluate(() => { location.hash = "view=db"; });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  logs.push({ step: "db-route", info: await assertNoUiBreakage(page, "db-route", failures) });
  const dbSurface = logs[logs.length - 1].info.surface;
  if (dbSurface !== "player-management") failures.push(`db surface ${dbSurface} !== player-management`);

  await page.evaluate(() => { location.hash = "view=dashboard"; });
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  logs.push({ step: "dashboard-route", info: await assertNoUiBreakage(page, "dashboard-route", failures) });
  const dashboardSurface = logs[logs.length - 1].info.surface;
  if (dashboardSurface !== "dashboard") failures.push(`dashboard surface ${dashboardSurface} !== dashboard`);

  const forcedGroupFirstStageV276 = await page.evaluate(() => {
    state.inputText = Array.from({ length: 15 }, (_, index) => `FG${index + 1}/QA`).join("\n");
    state.settings.laneCount = 5;
    state.settings.matchMode = "basic";
    state.settings.forcedGroupCount = "5";
    state.settings.nextGroupSize = "";
    state.qualifierRounds = makeQualifierRounds(5, "basic");
    const players = parseParticipants();
    const plan = makeStagePlan(players.length, state.settings.laneCount);
    const stage = generateStage(players, 1, 1, plan[0]);
    const laterStage = generateStage(players, 1, 2, plan[1] || "다음 단계");
    return {
      playerCount: players.length,
      laneCount: state.settings.laneCount,
      forcedGroupCount: state.settings.forcedGroupCount,
      firstStageName: plan[0],
      firstStageGroupCount: stage.groups.length,
      firstStageGroupSizes: stage.groups.map(group => group.slots.filter(slot => !slot.isEmptyLane).length),
      laterStageGroupCount: laterStage.groups.length
    };
  });
  logs.push({ step: "forced-group-first-stage-v276", info: { forcedGroupFirstStageV276 } });
  if (forcedGroupFirstStageV276.playerCount !== 15 || forcedGroupFirstStageV276.laneCount !== 5 || forcedGroupFirstStageV276.forcedGroupCount !== "5") {
    failures.push(`forced group first-stage setup failed ${JSON.stringify(forcedGroupFirstStageV276)}`);
  }
  if (forcedGroupFirstStageV276.firstStageGroupCount !== 5 || forcedGroupFirstStageV276.firstStageGroupSizes.some(size => size !== 3)) {
    failures.push(`forced group first-stage did not produce 5 balanced groups ${JSON.stringify(forcedGroupFirstStageV276)}`);
  }
  if (forcedGroupFirstStageV276.laterStageGroupCount === 5) {
    failures.push(`forced group leaked into non-first stage ${JSON.stringify(forcedGroupFirstStageV276)}`);
  }

  if (String(logs[0].info.build) !== String(meta.version) || String(logs[0].info.release) !== String(meta.version)) {
    failures.push(`build/release mismatch ${logs[0].info.build}/${logs[0].info.release} expected ${meta.version}`);
  }
  await page.close();
  return { viewport, ok: failures.length === 0, failures, logs };
}

async function main() {
  const meta = readBuildMeta();
  const server = await startServer();
  const executablePath = browserPath();
  if (!executablePath) throw new Error("No Chrome or Edge executable was found. Set MINI4WD_BROWSER_PATH.");
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const viewports = process.env.MINI4WD_QA_OPERATOR_DESKTOP_ONLY === "1" ? [
    { width: 1365, height: 900 }
  ] : [
    { width: 1365, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 720 }
  ];
  const results = [];
  for (const viewport of viewports) results.push(await runViewport(browser, meta, viewport));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  const failed = results.filter(result => !result.ok);
  const report = { version: meta.version, label: meta.label, checked: results.length, failed: failed.length, results };
  const printableReport = process.env.MINI4WD_QA_OPERATOR_SUMMARY === "1"
    ? {
        ...report,
        results: results.map(result => ({ viewport: result.viewport, ok: result.ok, failures: result.failures }))
      }
    : report;
  console.log(JSON.stringify(printableReport, null, 2));
  if (failed.length) process.exit(1);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
