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
        const current = getAt(this.path);
        const next = updateFn(clone(current));
        setAt(this.path, next);
        notifyFirebaseListeners(this.path);
        return Promise.resolve({ committed: true, snapshot: snapshot(next) });
      }
    };
    return api;
  }
  const fakeUser = { uid: "qa-uid", email: "qa-venue@example.com" };
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
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator", null, { timeout: 10000 });

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
    scrollOperatorSectionV147: typeof window.scrollOperatorSectionV147
  }));
  Object.entries(functionTypes).forEach(([name, type]) => {
    if (type !== "function") failures.push(`global function missing: ${name} (${type})`);
  });

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
    location.hash = `view=mobile-live&t=${encodeURIComponent(id)}`;
    if (typeof bootV33 === "function") await bootV33();
    await new Promise(resolve => setTimeout(resolve, 120));
    const before = {
      surface: document.documentElement.getAttribute("data-ui-surface") || "",
      publicLiveExists: !!window.__qaFirebaseStore?.publicLive?.[id],
      hasMobileView: !!document.querySelector(".mobile-view")
    };
    const published = typeof forcePublishPublicLiveV50 === "function" ? forcePublishPublicLiveV50("qa-live-connect-v267") : false;
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
    state.inputText = ["Alpha/QA", "Beta/QA", "Gamma/QA", "Delta/QA", "Echo/QA", "Foxtrot/QA"].join("\n");
    const parsed = parseParticipants();
    const winner = { ...parsed[0], lane: 1 };
    const finalistSlots = parsed.slice(0, 3).map((player, index) => ({ ...player, lane: index + 1 }));
    state.settings.matchMode = "points3";
    state.settings.laneCount = 3;
    state.tournament.status = "running";
    state.tournament.name = "QA Live Round Fallback";
    state.tournament.venue = "QA Venue";
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
    const id = getCurrentTournamentId();
    if (window.__qaFirebaseStore?.publicLive) delete window.__qaFirebaseStore.publicLive[id];
    const originalSync = forceLiveBroadcastSync;
    forceLiveBroadcastSync = () => Promise.resolve(false);
    const activated = activateNextRoundAfterFinalist(0, true);
    renderOperator();
    await new Promise(resolve => setTimeout(resolve, 1300));
    forceLiveBroadcastSync = originalSync;
    const live = window.__qaFirebaseStore?.publicLive?.[id];
    const result = {
      activated,
      id,
      localActiveRoundIndex: activeRoundIndex,
      localBroadcast: state.broadcast,
      publicExists: !!live,
      publicActiveRoundIndex: live?.state?.activeRoundIndex,
      publicBroadcast: live?.state?.broadcast,
      publicStageName: live?.state?.qualifierRounds?.[live?.state?.broadcast?.roundIndex || 0]?.stages?.[live?.state?.broadcast?.stageIndex || 0]?.name || "",
      syncReason: live?.syncReason || ""
    };
    state = normalizeImportedState(backupState);
    activeRoundIndex = backupActiveRoundIndex;
    state.activeRoundIndex = backupActiveRoundIndex;
    if (backupBroadcast) state.broadcast = backupBroadcast;
    persistCurrentState();
    renderOperator();
    return result;
  });
  logs.push({ step: "live-round-fallback-v269", info: { liveRoundFallbackV269 } });
  if (!liveRoundFallbackV269.activated || !liveRoundFallbackV269.publicExists || liveRoundFallbackV269.publicActiveRoundIndex !== 1 || liveRoundFallbackV269.publicBroadcast?.roundIndex !== 1) {
    failures.push(`live round fallback v269 failed ${JSON.stringify(liveRoundFallbackV269)}`);
  }
  await showOperatorPage(page);

  const liveLeaseRetryV270 = await page.evaluate(async () => {
    const backupState = exportState();
    const backupActiveRoundIndex = activeRoundIndex;
    const backupBroadcast = state.broadcast ? { ...state.broadcast } : null;
    const alerts = [];
    const originalAlert = window.alert;
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
      if (window.__qaFirebaseStore?.publicLive) delete window.__qaFirebaseStore.publicLive[id];
      if (typeof releaseOperationLock === "function") releaseOperationLock(true);
      await new Promise(resolve => setTimeout(resolve, 120));
      if (typeof refreshOperationLeaseV178 === "function") await refreshOperationLeaseV178();
      const beforeCanPublish = typeof window.__mini4wdCanPublishLiveNowV270 === "function" ? window.__mini4wdCanPublishLiveNowV270("qa-before") : null;
      const syncResult = await syncOperatorLiveStateV269("operator-render-v270-qa");
      await new Promise(resolve => setTimeout(resolve, 1100));
      const venueId = normalizeKey(currentVenueId() || currentVenueName() || "default");
      const live = window.__qaFirebaseStore?.publicLive?.[id];
      const lease = window.__qaFirebaseStore?.operationLocks?.leases?.[venueId];
      return {
        id,
        beforeCanPublish,
        syncResult,
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
      persistCurrentState();
      renderOperator();
    }
  });
  logs.push({ step: "live-lease-retry-v270", info: { liveLeaseRetryV270 } });
  if (liveLeaseRetryV270.alertCount !== 0 || !liveLeaseRetryV270.leaseExists || !liveLeaseRetryV270.publicExists || liveLeaseRetryV270.publicActiveRoundIndex !== 1 || liveLeaseRetryV270.publicBroadcast?.roundIndex !== 1 || liveLeaseRetryV270.canPublishAfter !== true) {
    failures.push(`live lease retry v270 failed ${JSON.stringify(liveLeaseRetryV270)}`);
  }
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
    const beforeNext = await undoSnapshot();
    await page.locator(".operator-mobile-dock-v233 > button").first().click();
    await page.waitForTimeout(350);
    const afterNext = await undoSnapshot();
    if (await page.locator(".operator-undo-float-v266").count()) {
      await page.locator(".operator-undo-float-v266").click();
      await page.waitForTimeout(350);
    }
    const afterNextUndo = await undoSnapshot();
    const firstPointButton = page.locator(".point-buttons").first().locator("button").first();
    await firstPointButton.click();
    await page.waitForTimeout(250);
    const afterScore = await undoSnapshot();
    if (await page.locator(".operator-undo-float-v266").count()) {
      await page.locator(".operator-undo-float-v266").click();
      await page.waitForTimeout(350);
    }
    const afterScoreUndo = await undoSnapshot();
    operatorMobileUndoV266 = { skipped: false, beforeNext, afterNext, afterNextUndo, afterScore, afterScoreUndo };
  }
  logs.push({ step: "operator-mobile-undo-v266", info: { operatorMobileUndoV266 } });
  if (!operatorMobileUndoV266.skipped) {
    if (operatorMobileUndoV266.afterNext.stageCount !== operatorMobileUndoV266.beforeNext.stageCount + 1 || !operatorMobileUndoV266.afterNext.undoVisible || operatorMobileUndoV266.afterNext.undoBottom >= operatorMobileUndoV266.afterNext.dockTop) {
      failures.push(`mobile undo did not appear above dock after next-game action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterNextUndo.stageCount !== operatorMobileUndoV266.beforeNext.stageCount || operatorMobileUndoV266.afterNextUndo.undoExists) {
      failures.push(`mobile undo did not restore next-game action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterScore.pointSelections <= operatorMobileUndoV266.afterNextUndo.pointSelections || !operatorMobileUndoV266.afterScore.undoVisible) {
      failures.push(`mobile undo did not appear after score action ${JSON.stringify(operatorMobileUndoV266)}`);
    }
    if (operatorMobileUndoV266.afterScoreUndo.pointSelections !== operatorMobileUndoV266.afterNextUndo.pointSelections || operatorMobileUndoV266.afterScoreUndo.undoExists) {
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

  await page.evaluate(() => {
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
    renderOperator();
  });
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
    return {
      advanceIds: [...(group?.advanceIds || [])],
      slotSelected: !!slot?.classList.contains("selected"),
      storedSelected
    };
  });
  logs.push({ step: "advance-selection", info: { before: advanceBefore, after: advanceAfter } });
  if (advanceBefore.advanceIds.includes("qa-advance-a")) failures.push("advance selection started preselected");
  if (!advanceAfter.advanceIds.includes("qa-advance-a")) failures.push(`advance click did not update advanceIds ${JSON.stringify(advanceAfter)}`);
  if (!advanceAfter.slotSelected) failures.push(`advance click did not leave selected UI ${JSON.stringify(advanceAfter)}`);
  if (!advanceAfter.storedSelected) failures.push(`advance click did not persist local state ${JSON.stringify(advanceAfter)}`);

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
  logs.push({ step: "point-final-next-round", info: { pointFinalNextRound } });
  logs.push({ step: "legacy-point-final-next-round", info: { legacyPointFinalNextRound } });
  logs.push({ step: "point-final-round-two-advance", info: { pointFinalRoundTwoAdvance } });
  logs.push({ step: "point-final-confirmed-dock", info: { pointFinalConfirmedDock } });
  logs.push({ step: "point-final-ready-dock-click", info: { pointFinalReadyDockClick } });
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
