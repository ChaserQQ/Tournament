const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  console.error("Playwright is required for result matrix QA.");
  console.error("Install it locally or run with NODE_PATH pointing at a Playwright node_modules directory.");
  console.error(error.message);
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MINI4WD_QA_RESULT_PORT || 4177);

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
        role: "venue",
        venueId: "qa-venue",
        venueName: "QA Venue",
        approved: true,
        permissions: { operate: true, dashboard: true }
      }
    },
    publicVenues: {
      "qa-venue": { venueId: "qa-venue", venueName: "QA Venue", approved: true, updatedAt: Date.now() }
    },
    publicVenueDirectory: {},
    publicLive: {},
    publicHistory: {},
    activeTournaments: {},
    operationLocks: {},
    tournaments: {},
    privateResultLogs: {},
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

async function runMatrix(page, expectedVersion) {
  return page.evaluate(version => {
    const failures = [];
    const summaries = [];
    const assert = (condition, message) => { if (!condition) failures.push(message); };
    const player = (id, name, team = "QA") => ({ id, name, team });
    const slot = (base, lane) => ({ ...base, lane });
    const group = (id, name, slots, advanceIds = [], extra = {}) => ({ id, name, slots, advanceIds, ...extra });
    const stage = (id, name, type, groups, extra = {}) => ({ id, name, type, groups, meta: { attempts: 1, score: 0, sameTeam: 0, groupSize: 3 }, ...extra });
    const round = (id, index, title, stages, finalist = null, extra = {}) => ({ id, index, title, stagePlan: stages.map(item => item.name), stages, finalist, ...extra });

    function resetCase(mode, laneCount, rounds, finalRace = null) {
      state.settings.matchMode = mode;
      state.settings.laneCount = laneCount;
      state.tournament = {
        id: `qa-${mode}`,
        recordId: `qa-${mode}`,
        name: `QA ${mode}`,
        venue: "QA Venue",
        raceClass: "오픈",
        status: "running",
        startedAtISO: "2026-06-15T00:00:00.000Z",
        startedAtDisplay: "2026-06-15 09:00",
        endedAtISO: "",
        endedAtDisplay: "",
        withdrawnPlayerIds: []
      };
      state.qualifierRounds = rounds;
      state.finalRace = finalRace;
      state.broadcast = { mode: finalRace ? "final" : "stage", roundIndex: 0, stageIndex: 0 };
      state.activeRoundIndex = 0;
    }

    function rowsAndStats(caseName) {
      const rows = getStageResultRows();
      const stats = analyzeRecords([{ id: caseName, mode: state.settings.matchMode, laneCount: state.settings.laneCount, rows }]);
      return { rows, stats };
    }

    function rowResult(rows, 차수, 단계, 조, 선수명) {
      const item = rows.find(row => row.차수 === 차수 && row.단계 === 단계 && row.조 === 조 && row.선수명 === 선수명);
      return item ? item.결과 : "";
    }

    function countResult(rows, result) {
      return rows.filter(row => row.결과 === result).length;
    }

    function statByName(stats, name) {
      return (stats.players || []).find(item => item.name === name) || null;
    }

    function addSummary(name, rows, stats) {
      summaries.push({
        name,
        rowCount: rows.length,
        resultCounts: rows.reduce((map, row) => {
          map[row.결과] = (map[row.결과] || 0) + 1;
          return map;
        }, {}),
        leaders: (stats.mostWins || []).slice(0, 4).map(item => ({ name: item.name, wins: item.wins, championships: item.championships, finals: item.finals }))
      });
    }

    function runBasicCase() {
      const a = player("basic-a", "기본A");
      const b = player("basic-b", "기본B");
      const c = player("basic-c", "기본C");
      const d = player("basic-d", "기본D");
      const e = player("basic-e", "기본E");
      const f = player("basic-f", "기본F");
      const rounds = [
        round("basic-r1", 1, "1차 라운드", [
          stage("basic-r1-s1", "준결승", "normal", [
            group("basic-r1-g1", "1조", [slot(a, 1), slot(b, 2)], [a.id]),
            group("basic-r1-g2", "2조", [slot(c, 1), slot(d, 2)], [c.id])
          ]),
          stage("basic-r1-s2", "라운드 결승", "normal", [
            group("basic-r1-final", "1조", [slot(a, 1), slot(c, 2), slot(e, 3)], [a.id])
          ])
        ], slot(a, 1)),
        round("basic-r2", 2, "2차 라운드", [
          stage("basic-r2-s1", "라운드 결승", "normal", [
            group("basic-r2-final", "1조", [slot(b, 1), slot(d, 2), slot(f, 3)], [b.id])
          ])
        ], slot(b, 1)),
        round("basic-r3", 3, "3차 라운드", [
          stage("basic-r3-s1", "라운드 결승", "normal", [
            group("basic-r3-final", "1조", [slot(c, 1), slot(d, 2), slot(e, 3)], [c.id])
          ])
        ], slot(c, 1))
      ];
      const finalRace = {
        id: "basic-final",
        name: "최종 결승",
        groupSize: 3,
        group: group("basic-final-group", "FINAL", [slot(a, 1), slot(b, 2), slot(c, 3)], [a.id])
      };
      resetCase("basic", 3, rounds, finalRace);
      const { rows, stats } = rowsAndStats("basic");
      assert(rowResult(rows, "1차 라운드", "준결승", "1조", "기본A") === "진출", "basic earlier stage winner should stay 진출");
      assert(rowResult(rows, "1차 라운드", "라운드 결승", "1조", "기본A") === "최종결승진출", "basic round final winner should be 최종결승진출");
      assert(rowResult(rows, "최종 결승", "FINAL", "FINAL", "기본A") === "최종우승", "basic final winner should be 최종우승");
      assert(countResult(rows, "최종결승진출") === 3, "basic should have exactly three final qualifier rows");
      const aStats = statByName(stats, "기본A");
      assert(aStats && aStats.wins === 2 && aStats.championships === 1, `basic stats for 기본A wrong ${JSON.stringify(aStats)}`);
      addSummary("basic", rows, stats);
    }

    function runPoints3Case() {
      const p1 = player("points3-a", "포인트3A");
      const p2 = player("points3-b", "포인트3B");
      const p3 = player("points3-c", "포인트3C");
      const pointStages = [
        stage("points3-s1", "포인트 1차전", "points", [
          group("points3-g1", "1조", [slot(p1, 1), slot(p2, 2), slot(p3, 3)], [], { points: { [p1.id]: 3, [p2.id]: 2, [p3.id]: 1 } })
        ]),
        stage("points3-s2", "포인트 2차전", "points", [
          group("points3-g2", "1조", [slot(p1, 1), slot(p2, 2), slot(p3, 3)], [], { points: { [p1.id]: 2, [p2.id]: 3, [p3.id]: 1 } })
        ]),
        stage("points3-s3", "포인트 3차전", "points", [
          group("points3-g3", "1조", [slot(p1, 1), slot(p2, 2), slot(p3, 3)], [], { points: { [p1.id]: 5, [p2.id]: 2, [p3.id]: 1 } })
        ]),
        stage("points3-final", "포인트 상위 3명 결정전", "pointFinal", [
          group("points3-final-g", "1조", [slot(p1, 1), slot(p2, 2), slot(p3, 3)], [p1.id])
        ])
      ];
      resetCase("points3", 3, [round("points3-r1", 1, "1차 라운드", pointStages, slot(p1, 1))]);
      const { rows, stats } = rowsAndStats("points3");
      assert(countResult(rows, "포인트") === 9, "points3 should keep all point heat rows as 포인트");
      assert(rowResult(rows, "1차 라운드", "포인트 상위 3명 결정전", "1조", "포인트3A") === "최종결승진출", "points3 final heat winner should be 최종결승진출");
      const p1Stats = statByName(stats, "포인트3A");
      const p2Stats = statByName(stats, "포인트3B");
      assert(p1Stats && p1Stats.wins === 3 && p1Stats.points === 10, `points3 stats for A wrong ${JSON.stringify(p1Stats)}`);
      assert(p2Stats && p2Stats.wins === 1, `points3 stats for B should count one high-score heat win ${JSON.stringify(p2Stats)}`);
      addSummary("points3", rows, stats);
    }

    function runPoints5TreeCase() {
      const a = player("tree-a", "트리A");
      const b = player("tree-b", "트리B");
      const c = player("tree-c", "트리C");
      const d = player("tree-d", "트리D");
      const slots = [slot(a, 1), slot(b, 2), slot(c, 3), slot(d, 4)];
      const point = (id, name, scores) => stage(id, name, "points", [
        group(`${id}-g`, "1조", slots, [], { points: { [a.id]: scores[0], [b.id]: scores[1], [c.id]: scores[2], [d.id]: scores[3] } })
      ]);
      const stages = [
        point("tree-p1", "포인트 1차전", [0, 0, 3, 2]),
        point("tree-p2", "포인트 2차전", [1, 1, 3, 2]),
        point("tree-p3", "포인트 3차전", [0, 1, 3, 2]),
        point("tree-p4", "포인트 4차전", [1, 0, 3, 2]),
        point("tree-p5", "포인트 5차전", [0, 0, 3, 2]),
        stage("tree-tie", "동점 순위 결정전", "pointTieBreak", [
          group("tree-tie-g", "2P 동점", [slot(a, 1), slot(b, 2)], [b.id, a.id])
        ], { pointTreeRanking: [{ id: a.id, name: a.name, team: a.team, total: 2 }, { id: b.id, name: b.name, team: b.team, total: 2 }] }),
        stage("tree-ladder", "트리타기 1단계", "pointLadder", [
          group("tree-ladder-g", "1조", [slot(a, 1), slot(b, 2)], [a.id])
        ], { pointTreeStep: 1 }),
        stage("tree-final", "트리타기 최종전", "pointFinal", [
          group("tree-final-g", "1조", [slot(a, 1), slot(c, 2)], [a.id])
        ], { pointFinalRule: "low-score-tree" })
      ];
      resetCase("points5Tree", 4, [round("tree-r1", 1, "1차 라운드", stages, slot(a, 1))]);
      const { rows, stats } = rowsAndStats("points5Tree");
      assert(rowResult(rows, "1차 라운드", "동점 순위 결정전", "2P 동점", "트리B") === "순위결정 1위", "points5 tie-break first should be 순위결정 1위");
      assert(rowResult(rows, "1차 라운드", "동점 순위 결정전", "2P 동점", "트리A") === "순위결정 2위", "points5 tie-break second should be 순위결정 2위");
      assert(rowResult(rows, "1차 라운드", "트리타기 1단계", "1조", "트리A") === "진출", "points5 ladder survivor should be 진출");
      assert(rowResult(rows, "1차 라운드", "트리타기 최종전", "1조", "트리A") === "최종결승진출", "points5 final survivor should be 최종결승진출");
      const aStats = statByName(stats, "트리A");
      const bStats = statByName(stats, "트리B");
      const cStats = statByName(stats, "트리C");
      assert(aStats && aStats.wins === 5, `points5 low-score stats for A wrong ${JSON.stringify(aStats)}`);
      assert(bStats && bStats.wins === 5, `points5 tie-break winner stats for B wrong ${JSON.stringify(bStats)}`);
      assert(cStats && cStats.wins === 0, `points5 high-score player must not get five point wins ${JSON.stringify(cStats)}`);
      addSummary("points5Tree", rows, stats);
    }

    function runRevivalCase() {
      const a = player("revival-a", "부활A");
      const b = player("revival-b", "부활B");
      const c = player("revival-c", "부활C");
      const stages = [
        stage("revival-main", "예선", "normal", [
          group("revival-main-g", "1조", [slot(a, 1), slot(b, 2), slot(c, 3)], [a.id])
        ]),
        stage("revival-retry", "패자부활전", "revival", [
          group("revival-retry-g", "1조", [slot(b, 1), slot(c, 2)], [b.id])
        ]),
        stage("revival-final", "결승", "merged", [
          group("revival-final-g", "FINAL", [slot(a, 1), slot(b, 2)], [b.id])
        ])
      ];
      resetCase("revival", 3, [round("revival-r1", 1, "패자부활 토너먼트", stages, slot(b, 2))]);
      const { rows, stats } = rowsAndStats("revival");
      assert(rowResult(rows, "패자부활 토너먼트", "결승", "FINAL", "부활B") === "최종우승", "revival final winner should save as 최종우승");
      assert(countResult(rows, "최종결승진출") === 0, "revival should not save the champion as only a final qualifier");
      const bStats = statByName(stats, "부활B");
      assert(bStats && bStats.championships === 1 && bStats.wins === 1, `revival champion stats wrong ${JSON.stringify(bStats)}`);
      addSummary("revival", rows, stats);
    }

    function crowRound(title, suffix, ranks) {
      const players = [
        player(`crow-${suffix}-1`, `크로우${suffix}1`),
        player(`crow-${suffix}-2`, `크로우${suffix}2`),
        player(`crow-${suffix}-3`, `크로우${suffix}3`),
        player(`crow-${suffix}-4`, `크로우${suffix}4`)
      ];
      const rankedPlayers = ranks.map(index => players[index - 1]);
      return round(`crow-r${suffix}`, Number(suffix), title, [
        stage(`crow-r${suffix}-final`, "라운드 결승", "normal", [
          group(`crow-r${suffix}-g`, "1조", players.map((item, index) => slot(item, index + 1)), rankedPlayers.map(item => item.id))
        ])
      ], { ...rankedPlayers[0], lane: 1 }, {
        crowFinalists: rankedPlayers.map((item, index) => ({ ...item, lane: index + 1, crowRank: index + 1, sourceRoundIndex: Number(suffix) }))
      });
    }

    function runCrowCase() {
      const rounds = [
        crowRound("1차 라운드", "1", [1, 2, 3]),
        crowRound("2차 라운드", "2", [2, 3, 1]),
        crowRound("3차 라운드", "3", [3, 1, 2])
      ];
      const finalPlayers = [rounds[0].crowFinalists[0], rounds[1].crowFinalists[0], rounds[2].crowFinalists[0]];
      const finalRace = {
        id: "crow-final",
        type: "crowFinal",
        name: "9강 최종 결승",
        groupSize: 3,
        group: group("crow-final-g", "FINAL", finalPlayers.map((item, index) => slot(item, index + 1)), [finalPlayers[0].id])
      };
      resetCase("crow", 3, rounds, finalRace);
      const { rows, stats } = rowsAndStats("crow");
      assert(rowResult(rows, "1차 라운드", "라운드 결승", "1조", "크로우11") === "9강 1위", "crow rank 1 should be 9강 1위");
      assert(rowResult(rows, "1차 라운드", "라운드 결승", "1조", "크로우12") === "9강 2위", "crow rank 2 should be 9강 2위");
      assert(rowResult(rows, "9강 최종 결승", "FINAL", "FINAL", "크로우11") === "최종우승", "crow final winner should be 최종우승");
      const rankOne = statByName(stats, "크로우11");
      const rankTwo = statByName(stats, "크로우12");
      assert(rankOne && rankOne.wins === 2 && rankOne.championships === 1, `crow rank one/final stats wrong ${JSON.stringify(rankOne)}`);
      assert(rankTwo && rankTwo.wins === 0, `crow rank two should not be counted as a heat win ${JSON.stringify(rankTwo)}`);
      addSummary("crow", rows, stats);
    }

    function runCrowSemiCase() {
      const a = player("crow-semi-a", "9강준결A");
      const b = player("crow-semi-b", "9강준결B");
      const c = player("crow-semi-c", "9강준결C");
      const semiRace = {
        id: "crow-semi",
        type: "crowSemi",
        name: "9강 최종 준결",
        groupSize: 3,
        groups: [
          group("crow-semi-g1", "9강 준결 1조", [slot(a, 1), slot(b, 2), slot(c, 3)], [a.id])
        ]
      };
      resetCase("crow", 3, [], semiRace);
      const { rows, stats } = rowsAndStats("crow-semi");
      assert(rowResult(rows, "9강 최종 준결", "9강준결", "9강 준결 1조", "9강준결A") === "결승진출", "crow semi winner should be 결승진출");
      const aStats = statByName(stats, "9강준결A");
      assert(aStats && aStats.wins === 1 && aStats.finals === 1, `crow semi winner stats wrong ${JSON.stringify(aStats)}`);
      addSummary("crow-semi", rows, stats);
    }

    function runLegacyLowScoreInferenceCase() {
      const rows = [
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "1LANE", 선수명: "레거시낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "points" },
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "2LANE", 선수명: "레거시높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "points" },
        { 차수: "1차 라운드", 단계: "트리타기 1단계", 조: "1조", 레인: "1LANE", 선수명: "레거시낮은", 팀명: "QA", 점수: "", 결과: "진출", 비고: "pointLadder" },
        { 차수: "1차 라운드", 단계: "트리타기 1단계", 조: "1조", 레인: "2LANE", 선수명: "레거시높은", 팀명: "QA", 점수: "", 결과: "탈락", 비고: "pointLadder" }
      ];
      const stats = analyzeRecords([{ id: "legacy-low-score", mode: "", laneCount: 3, rows }]);
      const low = statByName(stats, "레거시낮은");
      const high = statByName(stats, "레거시높은");
      assert(low && low.wins === 1, `legacy inferred low-score winner stats wrong ${JSON.stringify(low)}`);
      assert(high && high.wins === 0, `legacy inferred high-score player should not win ${JSON.stringify(high)}`);
      addSummary("legacy-low-score-inference", rows, stats);
    }

    function runPlainAdvanceDoesNotCountCase() {
      const rows = [
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "1LANE", 선수명: "PlainAdvanceA", 팀명: "QA", 점수: 5, 결과: "포인트", 비고: "points" },
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "2LANE", 선수명: "PlainAdvanceB", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "points" },
        { 차수: "2차 라운드", 단계: "본선", 조: "1조", 레인: "1LANE", 선수명: "PlainAdvanceA", 팀명: "QA", 점수: "", 결과: "진출", 비고: "" },
        { 차수: "3차 라운드", 단계: "준결승", 조: "1조", 레인: "1LANE", 선수명: "PlainAdvanceA", 팀명: "QA", 점수: "", 결과: "진출", 비고: "" },
        { 차수: "3차 라운드", 단계: "라운드 결승", 조: "1조", 레인: "1LANE", 선수명: "PlainAdvanceA", 팀명: "QA", 점수: "", 결과: "최종결승진출", 비고: "" },
        { 차수: "최종 결승", 단계: "FINAL", 조: "FINAL", 레인: "1LANE", 선수명: "PlainAdvanceA", 팀명: "QA", 점수: "", 결과: "최종우승", 비고: "" }
      ];
      const stats = analyzeRecords([{ id: "plain-advance-does-not-count", mode: "points3", laneCount: 3, rows }]);
      const target = statByName(stats, "PlainAdvanceA");
      assert(target && target.wins === 3 && target.championships === 1, `plain advance rows must not count as wins ${JSON.stringify(target)}`);
      addSummary("plain-advance-does-not-count", rows, stats);
    }

    function runLegacyUnmarkedPoints5Case() {
      const rows = [
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 1차전", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 2차전", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 2차전", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 3차전", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 3차전", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 4차전", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 4차전", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 5차전", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: 0, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "포인트 5차전", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: 3, 결과: "포인트", 비고: "" },
        { 차수: "1차 라운드", 단계: "동점자 순위 결정전", 조: "0P 동점", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: "", 결과: "진출", 비고: "" },
        { 차수: "1차 라운드", 단계: "동점자 순위 결정전", 조: "0P 동점", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: "", 결과: "진출", 비고: "" },
        { 차수: "1차 라운드", 단계: "트리타기 1단계", 조: "1조", 레인: "1LANE", 선수명: "구버전낮은", 팀명: "QA", 점수: "", 결과: "진출", 비고: "" },
        { 차수: "1차 라운드", 단계: "트리타기 1단계", 조: "1조", 레인: "2LANE", 선수명: "구버전높은", 팀명: "QA", 점수: "", 결과: "탈락", 비고: "" }
      ];
      const stats = analyzeRecords([{ id: "legacy-unmarked-points5", mode: "", laneCount: 3, rows }]);
      const low = statByName(stats, "구버전낮은");
      const high = statByName(stats, "구버전높은");
      assert(low && low.wins === 5, `unmarked legacy low-score player stats wrong ${JSON.stringify(low)}`);
      assert(high && high.wins === 0, `unmarked legacy high-score player should not win ${JSON.stringify(high)}`);
      addSummary("legacy-unmarked-points5", rows, stats);
    }

    assert(String(document.documentElement.getAttribute("data-build-version") || "") === String(version), "build version mismatch in browser");
    assert(typeof getStageResultRows === "function", "getStageResultRows is not available");
    assert(typeof analyzeRecords === "function", "analyzeRecords is not available");
    [
      runBasicCase,
      runPoints3Case,
      runPoints5TreeCase,
      runRevivalCase,
      runCrowCase,
      runCrowSemiCase,
      runLegacyLowScoreInferenceCase,
      runPlainAdvanceDoesNotCountCase,
      runLegacyUnmarkedPoints5Case
    ].forEach(fn => {
      try {
        fn();
      } catch (error) {
        failures.push(`${fn.name}: ${error && error.stack || error}`);
      }
    });
    try {
      state.tournament.status = "draft";
      state.finalRace = null;
    } catch (error) {}
    return { ok: failures.length === 0, failures, summaries };
  }, expectedVersion);
}

async function main() {
  const meta = readBuildMeta();
  const server = await startServer();
  const executablePath = browserPath();
  if (!executablePath) throw new Error("No Chrome or Edge executable was found. Set MINI4WD_BROWSER_PATH.");
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const failures = [];
  await installNetworkStubs(page);
  page.on("console", msg => {
    if (msg.type() === "error") failures.push(`console error: ${msg.text()}`);
  });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForFunction(() => typeof getStageResultRows === "function" && typeof analyzeRecords === "function", null, { timeout: 10000 });
  const matrix = await runMatrix(page, meta.version);
  await page.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  const result = {
    version: meta.version,
    label: meta.label,
    ok: failures.length === 0 && matrix.ok,
    failures: [...failures, ...matrix.failures],
    summaries: matrix.summaries
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
