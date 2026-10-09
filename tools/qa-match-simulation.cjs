const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");

let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  console.error("Playwright is required for full match simulation QA.");
  console.error("Install it locally or run with NODE_PATH pointing at a Playwright node_modules directory.");
  console.error(error.message);
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const port = Number(process.env.MINI4WD_QA_MATCH_PORT || 4179);

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
        venueId: "qa-venue",
        venueName: "QA Venue",
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
        if (next === undefined) return Promise.resolve({ committed: false, snapshot: snapshot(current) });
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

async function runViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const failures = [];
  await installNetworkStubs(page);
  page.on("console", msg => {
    if (msg.type() === "error") failures.push(`console error: ${msg.text()}`);
  });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator", null, { timeout: 10000 });

  const result = await page.evaluate(async () => {
    const summaries = [];
    const alerts = [];
    const algorithmChecks = {};
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    window.alert = message => alerts.push(String(message || ""));
    window.confirm = () => true;

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const actualSlots = group => (group.slots || []).filter(player => player && !player.isEmptyLane);
    const lastStage = roundIndex => {
      const round = state.qualifierRounds[roundIndex];
      return round?.stages?.[round.stages.length - 1] || null;
    };
    const tournamentId = () => getCurrentTournamentId();
    const liveRecord = () => window.__qaFirebaseStore?.publicLive?.[tournamentId()] || null;
    const historyCount = () => Object.keys(window.__qaFirebaseStore?.publicHistory || {}).length;
    const latestHistoryRecord = () => {
      const values = Object.values(window.__qaFirebaseStore?.publicHistory || {});
      return values[values.length - 1] || null;
    };
    const reset = async (mode, laneCount, playerCount, settings = {}) => {
      state = makeInitialState(laneCount);
      activeRoundIndex = 0;
      state.settings.matchMode = mode;
      state.settings.laneCount = laneCount;
      state.settings.excludeFinalists = settings.excludeFinalists ?? mode !== "crow";
      state.settings.forcedGroupCount = settings.forcedGroupCount ?? "";
      state.settings.nextGroupSize = settings.nextGroupSize ?? "";
      state.settings.avoidance = settings.avoidance ?? state.settings.avoidance;
      state.settings.sameLanePrevention = settings.sameLanePrevention ?? state.settings.sameLanePrevention;
      state.tournament.name = `QA ${mode} full match`;
      state.tournament.venue = "QA Venue";
      state.tournament.raceClass = "QA";
      state.tournament.id = `qa-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      state.tournament.recordId = state.tournament.id;
      state.inputText = Array.from({ length: playerCount }, (_, index) => `QA${mode}${index + 1}/T${(index % 3) + 1}`).join("\n");
      if (settings.ggpSeeds) {
        const player = parseParticipants()[0];
        state.tournament.ggpSeeds = Array.from({ length: 9 }, (_, index) => ({ name: player.name, team: player.team, group: index % 5 + 1, lane: Math.floor(index / 5) + 1 }));
      }
      state.qualifierRounds = makeQualifierRounds(laneCount, mode);
      state.finalRace = null;
      state.tournament.status = "draft";
      firebaseTournamentId = buildAutoTournamentId();
      safeSetItem("mini4wdTournamentId", firebaseTournamentId);
      localStorage.removeItem("mini4wdActiveLiveId");
      localStorage.removeItem("mini4wdActiveLiveSignature");
      renderOperator();
      const started = await startTournamentAsync();
      assert(
        started !== false && state.tournament.status === "running",
        `${mode} tournament did not start through the guarded v278 flow ${JSON.stringify({
          started,
          status: state.tournament.status,
          liveId: state.tournament.liveId || "",
          active: window.__qaFirebaseStore?.activeTournaments || {},
          leases: window.__qaFirebaseStore?.operationLocks?.leases || {},
          recentAlerts: alerts.slice(-4)
        })}`
      );
      await wait(80);
    };
    const ensureLease = async reason => {
      if (typeof claimOperationLeaseV178 === "function") await claimOperationLeaseV178(reason, true);
      await wait(40);
    };
    const selectFirstInEachGroup = async (roundIndex, stageIndex = null) => {
      const stage = stageIndex == null ? lastStage(roundIndex) : state.qualifierRounds[roundIndex].stages[stageIndex];
      stage.groups.forEach(group => {
        const first = actualSlots(group)[0];
        if (first && !(group.advanceIds || []).includes(first.id)) toggleAdvance(roundIndex, state.qualifierRounds[roundIndex].stages.indexOf(stage), group.id, first.id);
      });
      await wait(80);
    };
    const selectFirstNInFinalStage = async (roundIndex, count) => {
      const stage = lastStage(roundIndex);
      let selected = 0;
      stage.groups.forEach(group => {
        actualSlots(group).forEach(player => {
          if (selected >= count) return;
          if (!(group.advanceIds || []).includes(player.id)) {
            toggleAdvance(roundIndex, state.qualifierRounds[roundIndex].stages.indexOf(stage), group.id, player.id);
            selected += 1;
          }
        });
      });
      await wait(80);
      assert(selected === count, `round ${roundIndex} selected ${selected}/${count}`);
    };
    const runNormalRound = async roundIndex => {
      startQualifierRound(roundIndex);
      await ensureLease(`qa-round-${roundIndex}`);
      assert(lastStage(roundIndex), `round ${roundIndex} did not start`);
      let guard = 0;
      while (guard++ < 8) {
        const stage = lastStage(roundIndex);
        if (isConfirmableRoundFinalStageV228(stage)) {
          await selectFirstNInFinalStage(roundIndex, 1);
          confirmRoundFinalist(roundIndex);
          await wait(180);
          assert(state.qualifierRounds[roundIndex].finalist, `round ${roundIndex} finalist missing`);
          return;
        }
        await selectFirstInEachGroup(roundIndex);
        createNextStage(roundIndex);
        await wait(160);
      }
      throw new Error(`round ${roundIndex} did not finish`);
    };
    const finishStandardFinal = async expectedHistoryBefore => {
      createFinalRace();
      await wait(180);
      assert(state.finalRace, "final race missing");
      const groups = getFinalGroups();
      const group = groups[0];
      const winner = actualSlots(group)[0];
      assert(winner, "final winner candidate missing");
      toggleFinalWinner(winner.id, group.id);
      await wait(120);
      assert(isTournamentFinalResultReady(), "final result not ready");
      finishTournament();
      await wait(900);
      assert(historyCount() > expectedHistoryBefore, "public history did not save");
      const record = latestHistoryRecord();
      return {
        winner: winner.name,
        statusAfterFinish: state.tournament.status,
        historySaved: true,
        recordRows: Array.isArray(record?.rows) ? record.rows.length : 0,
        recordWinnerCount: Array.isArray(record?.winners) ? record.winners.length : 0
      };
    };
    const summarize = async (mode, extra = {}) => {
      await wait(900);
      const live = liveRecord();
      summaries.push({
        mode,
        status: state.tournament.status,
        activeRoundIndex,
        finalistCount: (state.qualifierRounds || []).filter(round => round.finalist).length,
        roundStageCounts: (state.qualifierRounds || []).map(round => round.stages.length),
        finalRaceType: state.finalRace?.type || "standard",
        publicLiveStatus: live?.state?.tournament?.status || live?.status || "",
        publicLiveRound: live?.state?.broadcast?.roundIndex ?? null,
        historyCount: historyCount(),
        rows: getStageResultRows().length,
        alerts: alerts.slice(),
        ...extra
      });
    };

    try {
      const modes = ["basic", "points3", "points5Tree", "revival", "crow"];

      state = makeInitialState(5);
      state.settings.laneCount = 5;
      state.settings.forcedGroupCount = "4";
      state.inputText = Array.from({ length: 5 }, (_, index) => `QAforced${index + 1}/T${index + 1}`).join("\n");
      renderOperator();
      const forcedValidationInput = document.querySelector(".forced-group-count-input-v265");
      if (forcedValidationInput) forcedValidationInput.value = "4";
      state.settings.forcedGroupCount = "4";
      const forcedGroupError = validateStart(parseParticipants(), "예선");
      assert(/최대 2조/.test(forcedGroupError), `forced grouping allowed singleton groups: ${forcedGroupError}`);

      const planningCases = [];
      for (const laneCount of [3, 5]) {
        for (let targetSize = 2; targetSize <= laneCount; targetSize += 1) {
          state = makeInitialState(laneCount);
          state.settings.laneCount = laneCount;
          state.settings.nextGroupSize = targetSize;
          state.settings.forcedGroupCount = "";
          const forcedInput = document.querySelector(".forced-group-count-input-v265");
          if (forcedInput) forcedInput.value = "";
          for (let playerCount = 2; playerCount <= 30; playerCount += 1) {
            const players = Array.from({ length: playerCount }, (_, index) => ({ id: `plan-${laneCount}-${targetSize}-${index}`, name: `P${index}`, team: "" }));
            const plan = makeStagePlan(playerCount, laneCount);
            const stage = generateStage(players, 1, 1, plan[0]);
            const actualGroups = stage.groups.filter(group => actualSlots(group).length > 0);
            const isFinalName = plan[0] === "라운드 결승";
            assert(isFinalName === (actualGroups.length === 1), `stage plan/group mismatch lanes=${laneCount} target=${targetSize} players=${playerCount} plan=${plan[0]} groups=${actualGroups.length}`);
            assert(actualGroups.every(group => actualSlots(group).length >= 2 && actualSlots(group).length <= laneCount), `invalid group size lanes=${laneCount} target=${targetSize} players=${playerCount}`);
            planningCases.push(`${laneCount}/${targetSize}/${playerCount}`);
          }
        }
      }

      state = makeInitialState(5);
      activeRoundIndex = 0;
      state.settings.matchMode = "basic";
      state.settings.laneCount = 5;
      state.settings.nextGroupSize = 2;
      state.settings.forcedGroupCount = "";
      state.inputText = Array.from({ length: 4 }, (_, index) => `QAboundary${index + 1}/T${index + 1}`).join("\n");
      state.qualifierRounds = makeQualifierRounds(5, "basic");
      const boundaryRound = state.qualifierRounds[0];
      boundaryRound.stagePlan = makeStagePlan(4, 5);
      boundaryRound.stages = [generateStage(parseParticipants(), boundaryRound.index, 1, boundaryRound.stagePlan[0])];
      renderOperator();
      const boundaryStage = lastStage(0);
      assert(boundaryStage.name === "준결승", `4-player 2-person grouping was mislabeled ${boundaryStage.name}`);
      assert(boundaryStage.groups.length === 2, `4-player 2-person grouping created ${boundaryStage.groups.length} groups`);
      const firstBoundaryGroup = boundaryStage.groups[0];
      const secondBoundaryGroup = boundaryStage.groups[1];
      const firstBoundaryPlayers = actualSlots(firstBoundaryGroup);
      const secondBoundaryPlayers = actualSlots(secondBoundaryGroup);
      firstBoundaryPlayers.forEach(player => toggleAdvance(0, 0, firstBoundaryGroup.id, player.id));
      const boundaryStageCount = boundaryRound.stages.length;
      createNextStage(0);
      await wait(120);
      const incompleteMessage = document.getElementById("error")?.textContent || "";
      assert(boundaryRound.stages.length === boundaryStageCount, "incomplete groups advanced and dropped racers");
      assert(incompleteMessage.includes(secondBoundaryGroup.name), `missing-group error did not identify ${secondBoundaryGroup.name}: ${incompleteMessage}`);
      toggleAdvance(0, 0, firstBoundaryGroup.id, firstBoundaryPlayers[1].id);
      toggleAdvance(0, 0, secondBoundaryGroup.id, secondBoundaryPlayers[0].id);
      const expectedBoundaryIds = new Set([String(firstBoundaryPlayers[0].id), String(secondBoundaryPlayers[0].id)]);
      createNextStage(0);
      await wait(160);
      const boundaryFinal = lastStage(0);
      const actualBoundaryIds = new Set(actualSlots(boundaryFinal.groups[0]).map(player => String(player.id)));
      assert(boundaryFinal.name === "라운드 결승" && boundaryFinal.groups.length === 1, `boundary finalists were not consolidated into one final: ${boundaryFinal.name}/${boundaryFinal.groups.length}`);
      assert(expectedBoundaryIds.size === actualBoundaryIds.size && [...expectedBoundaryIds].every(id => actualBoundaryIds.has(id)), "selected qualifiers changed while creating the next bracket");
      algorithmChecks.planningCases = planningCases.length;
      algorithmChecks.incompleteGroupBlocked = true;
      algorithmChecks.customGroupFinal = `${boundaryStage.groups.length}->${boundaryFinal.groups.length}`;
      algorithmChecks.forcedSingletonBlocked = true;

      await reset("basic", 3, 9);
      let historyBefore = historyCount();
      for (const index of [0, 1, 2]) await runNormalRound(index);
      const basicFinal = await finishStandardFinal(historyBefore);
      await summarize("basic", basicFinal);

      await reset("points3", 3, 9);
      historyBefore = historyCount();
      startQualifierRound(0);
      await ensureLease("qa-points3");
      {
        const incompletePointStage = lastStage(0);
        const incompletePointGroup = incompletePointStage.groups[0];
        const incompletePointPlayer = actualSlots(incompletePointGroup)[0];
        setPointScore(0, 0, incompletePointGroup.id, incompletePointPlayer.id, 1);
        const stageCountBeforeIncompleteScore = state.qualifierRounds[0].stages.length;
        createNextStage(0);
        await wait(120);
        const pointError = document.getElementById("error")?.textContent || "";
        assert(state.qualifierRounds[0].stages.length === stageCountBeforeIncompleteScore, "incomplete point scores advanced to the next heat");
        assert(pointError.includes(incompletePointGroup.name), `incomplete point-score error did not identify ${incompletePointGroup.name}: ${pointError}`);
        algorithmChecks.incompletePointScoresBlocked = true;
      }
      const points3RefreshLock = (() => {
        const beforeText = state.inputText;
        const beforeNames = parseParticipants().map(player => player.name).join("|");
        state.tournament.status = "running";
        state.tournament.lockedParticipants = beforeText;
        const exported = exportState();
        assert(exported.inputText === beforeText, "points3 export did not preserve inputText");
        assert(exported.tournament.lockedParticipants === beforeText, "points3 export did not preserve locked participants");

        const legacySavedState = JSON.parse(JSON.stringify(exported));
        delete legacySavedState.inputText;
        state = normalizeImportedState(legacySavedState);
        activeRoundIndex = Math.max(0, Math.min(Number(state.activeRoundIndex || 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
        state.activeRoundIndex = activeRoundIndex;
        assert(state.inputText === beforeText, "points3 legacy refresh changed participant input");
        assert(parseParticipants().map(player => player.name).join("|") === beforeNames, "points3 legacy refresh changed participant names");

        const pollutedSavedState = JSON.parse(JSON.stringify(exported));
        pollutedSavedState.inputText = "WRONG1/QA\nWRONG2/QA";
        state = normalizeImportedState(pollutedSavedState);
        activeRoundIndex = Math.max(0, Math.min(Number(state.activeRoundIndex || 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
        state.activeRoundIndex = activeRoundIndex;
        assert(state.inputText === beforeText, "points3 running refresh allowed unlocked participant input");
        assert(parseParticipants().map(player => player.name).join("|") === beforeNames, "points3 running refresh changed participant names");
        return { participantCount: parseParticipants().length, preservedNames: beforeNames };
      })();
      for (let stageIndex = 0; stageIndex < 3; stageIndex += 1) {
        const stage = lastStage(0);
        assert(stage?.type === "points", `points3 expected points stage ${stageIndex}`);
        stage.groups.forEach(group => actualSlots(group).forEach(player => setPointScore(0, state.qualifierRounds[0].stages.indexOf(stage), group.id, player.id, 1)));
        await wait(120);
        createNextStage(0);
        await wait(180);
      }
      assert(isPointFinalDecisionStage(lastStage(0)), "points3 tied-cutoff decision stage missing");
      assert(lastStage(0).groups.length > 1, "points3 tied cutoff did not create the expected multi-group playoff");
      let pointPlayoffGuard = 0;
      while (!isConfirmableRoundFinalStageV228(lastStage(0)) && pointPlayoffGuard++ < 8) {
        const previousStageCount = state.qualifierRounds[0].stages.length;
        await selectFirstInEachGroup(0);
        createNextStage(0);
        await wait(180);
        assert(state.qualifierRounds[0].stages.length === previousStageCount + 1, "points3 tied-cutoff playoff did not advance");
      }
      assert(isConfirmableRoundFinalStageV228(lastStage(0)), "points3 tied-cutoff playoff did not converge to one final group");
      algorithmChecks.pointCutoffPlayoffDepth = pointPlayoffGuard;
      await selectFirstNInFinalStage(0, 1);
      confirmRoundFinalist(0);
      await wait(200);
      assert(activeRoundIndex === 1, "points3 did not advance to round 2");
      await wait(1800);
      const points3LiveAfterFinalist = liveRecord();
      assert(points3LiveAfterFinalist?.state?.broadcast?.roundIndex === 1, `points3 publicLive did not advance to round 2 ${JSON.stringify(points3LiveAfterFinalist?.state?.broadcast || null)}`);
      assert(window.__qaFirebaseStore?.tournaments?.[tournamentId()]?.state?.activeRoundIndex === 1, "points3 remote state did not advance to round 2");
      const staleLive = JSON.parse(JSON.stringify(points3LiveAfterFinalist));
      staleLive.updatedAt = Math.max(1, Number(staleLive.updatedAt || 0) - 1000);
      staleLive.syncReason = "qa-stale-v272";
      staleLive.state.updatedAt = staleLive.updatedAt;
      staleLive.state.activeRoundIndex = 0;
      staleLive.state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: state.qualifierRounds[0].stages.length - 1 };
      let stalePublicRejected = false;
      try {
        await writeFreshLiveValueV272(initFirebase(), `publicLive/${tournamentId()}`, staleLive, "qa-stale-v272");
      } catch (error) {
        stalePublicRejected = error?.code === "FRESH_LIVE_REJECTED_V278";
      }
      assert(stalePublicRejected, "points3 stale publicLive write was not reported as rejected");
      assert(liveRecord()?.state?.broadcast?.roundIndex === 1, "points3 stale publicLive write regressed to round 1");
      const staleRemoteState = JSON.parse(JSON.stringify(window.__qaFirebaseStore.tournaments[tournamentId()].state));
      staleRemoteState.updatedAt = Math.max(1, Number(staleRemoteState.updatedAt || 0) - 1000);
      staleRemoteState.activeRoundIndex = 0;
      staleRemoteState.broadcast = { mode: "stage", roundIndex: 0, stageIndex: state.qualifierRounds[0].stages.length - 1 };
      let staleRemoteRejected = false;
      try {
        await writeFreshLiveValueV272(initFirebase(), `tournaments/${tournamentId()}/state`, staleRemoteState, "qa-stale-v272");
      } catch (error) {
        staleRemoteRejected = error?.code === "FRESH_LIVE_REJECTED_V278";
      }
      assert(staleRemoteRejected, "points3 stale remote state write was not reported as rejected");
      assert(window.__qaFirebaseStore.tournaments[tournamentId()].state.activeRoundIndex === 1, "points3 stale remote state write regressed to round 1");
      await runNormalRound(1);
      await runNormalRound(2);
      const points3Final = await finishStandardFinal(historyBefore);
      await summarize("points3", { ...points3Final, refreshLock: points3RefreshLock });

      await reset("points5Tree", 3, 9);
      historyBefore = historyCount();
      startQualifierRound(0);
      await ensureLease("qa-points5");
      const playerScoreMap = new Map(parseParticipants().map((player, index) => [player.id, index + 1]));
      for (let stageIndex = 0; stageIndex < 5; stageIndex += 1) {
        const stage = lastStage(0);
        assert(stage?.type === "points", `points5 expected points stage ${stageIndex}`);
        stage.groups.forEach(group => actualSlots(group).forEach(player => setPointScore(0, state.qualifierRounds[0].stages.indexOf(stage), group.id, player.id, playerScoreMap.get(player.id) || 9)));
        await wait(120);
        createNextStage(0);
        await wait(180);
      }
      let treeGuard = 0;
      while (!isPointFinalDecisionStage(lastStage(0)) && treeGuard++ < 12) {
        await selectFirstNInFinalStage(0, 1);
        createNextStage(0);
        await wait(180);
      }
      assert(isPointFinalDecisionStage(lastStage(0)), "points5 final decision stage missing");
      await selectFirstNInFinalStage(0, 1);
      confirmRoundFinalist(0);
      await wait(200);
      assert(activeRoundIndex === 1, "points5 did not advance to round 2");
      await runNormalRound(1);
      await runNormalRound(2);
      const points5Final = await finishStandardFinal(historyBefore);
      await summarize("points5Tree", points5Final);

      await reset("revival", 3, 9);
      historyBefore = historyCount();
      startQualifierRound(0);
      await ensureLease("qa-revival");
      await selectFirstInEachGroup(0);
      createRevivalStage(0);
      await wait(180);
      assert(lastStage(0)?.type === "revival", "revival stage missing");
      await selectFirstInEachGroup(0);
      createNextStage(0);
      await wait(180);
      assert(lastStage(0)?.name, "revival merged stage missing");
      let revivalGuard = 0;
      while (!isConfirmableRoundFinalStageV228(lastStage(0)) && revivalGuard++ < 8) {
        await selectFirstInEachGroup(0);
        createNextStage(0);
        await wait(180);
      }
      assert(isConfirmableRoundFinalStageV228(lastStage(0)), "revival final stage missing");
      await selectFirstNInFinalStage(0, 1);
      confirmRoundFinalist(0);
      await wait(180);
      assert(state.qualifierRounds[0].finalist, "revival winner missing");
      const revivalWinner = state.qualifierRounds[0].finalist.name;
      finishTournament();
      await wait(900);
      assert(historyCount() > historyBefore, "revival public history did not save");
      {
        const record = latestHistoryRecord();
        await summarize("revival", {
          winner: revivalWinner,
          statusAfterFinish: state.tournament.status,
          historySaved: true,
          recordRows: Array.isArray(record?.rows) ? record.rows.length : 0,
          recordWinnerCount: Array.isArray(record?.winners) ? record.winners.length : 0
        });
      }

      await reset("crow", 3, 9);
      historyBefore = historyCount();
      for (const roundIndex of [0, 1, 2]) {
        startQualifierRound(roundIndex);
        await ensureLease(`qa-crow-${roundIndex}`);
        let guard = 0;
        while (guard++ < 8) {
          const stage = lastStage(roundIndex);
          if (isConfirmableRoundFinalStageV228(stage)) {
            await selectFirstNInFinalStage(roundIndex, 3);
            confirmRoundFinalist(roundIndex);
            await wait(180);
            assert((state.qualifierRounds[roundIndex].crowFinalists || []).length === 3, `crow round ${roundIndex} ranks missing`);
            break;
          }
          await selectFirstInEachGroup(roundIndex);
          createNextStage(roundIndex);
          await wait(160);
        }
      }
      createFinalRace();
      await wait(180);
      assert(state.finalRace?.type === "crowSemi", "crow semi missing");
      const crowSemiGroups = getFinalGroups();
      const crowSemiFirstPlayers = crowSemiGroups.map(group => actualSlots(group)[0]);
      assert(crowSemiGroups.length === 3 && crowSemiFirstPlayers.every(Boolean), "crow semi groups are incomplete");
      const crowSemiExtraPlayer = actualSlots(crowSemiGroups[0])[1];
      assert(crowSemiExtraPlayer, "crow semi first group is missing its second racer");
      toggleFinalWinner(crowSemiFirstPlayers[0].id, crowSemiGroups[0].id);
      toggleFinalWinner(crowSemiExtraPlayer.id, crowSemiGroups[0].id);
      toggleFinalWinner(crowSemiFirstPlayers[1].id, crowSemiGroups[1].id);
      await wait(120);
      createCrowFinalFromSemi();
      await wait(120);
      assert(state.finalRace?.type === "crowSemi", "crow semi accepted three qualifiers without one winner per group");
      const crowDistributionError = document.getElementById("error")?.textContent || "";
      assert(crowDistributionError.includes("각 조"), `crow semi distribution error was unclear: ${crowDistributionError}`);
      toggleFinalWinner(crowSemiExtraPlayer.id, crowSemiGroups[0].id);
      toggleFinalWinner(crowSemiFirstPlayers[2].id, crowSemiGroups[2].id);
      await wait(120);
      const crowLaneHistory = collectLaneHistory();
      crowSemiGroups.forEach((group, index) => {
        const player = crowSemiFirstPlayers[index];
        assert(crowLaneHistory.get(`${player.id}|${player.lane}`) >= 1, `crow semi lane history missing ${player.name}/${player.lane}`);
      });
      algorithmChecks.crowPerGroupWinnerBlocked = true;
      algorithmChecks.crowSemiLaneHistory = true;
      await wait(160);
      const crowSemiSelectedCount = getFinalGroups()
        .flatMap(group => actualSlots(group).filter(player => (group.advanceIds || []).includes(player.id)))
        .length;
      const crowSemiDebug = getFinalGroups().map(group => ({
        name: group.name,
        advanceIds: group.advanceIds || [],
        slots: actualSlots(group).map(player => ({ id: player.id, name: player.name }))
      }));
      assert(crowSemiSelectedCount === 3, `crow semi selected ${crowSemiSelectedCount}/3 ${JSON.stringify(crowSemiDebug)}`);
      createCrowFinalFromSemi();
      await wait(180);
      assert(state.finalRace?.type === "crowFinal", `crow final missing after ${crowSemiSelectedCount} semi winners`);
      const crowGroup = getFinalGroups()[0];
      const crowWinner = actualSlots(crowGroup)[0];
      const crowRankCounts = state.qualifierRounds.map(round => (round.crowFinalists || []).length);
      toggleFinalWinner(crowWinner.id, crowGroup.id);
      await wait(120);
      finishTournament();
      await wait(900);
      assert(historyCount() > historyBefore, "crow public history did not save");
      {
        const record = latestHistoryRecord();
        await summarize("crow", {
          winner: crowWinner.name,
          statusAfterFinish: state.tournament.status,
          historySaved: true,
          recordRows: Array.isArray(record?.rows) ? record.rows.length : 0,
          recordWinnerCount: Array.isArray(record?.winners) ? record.winners.length : 0,
          crowRanks: crowRankCounts
        });
      }

      // GGP: 60 eligible racers plus one racer holding nine independent monthly seeds.
      historyBefore = historyCount();
      await reset("ggp", 5, 61, { ggpSeeds: true, excludeFinalists: false });
      await ensureLease("qa-ggp");
      const seedPlayer = parseParticipants()[0];
      assert(state.qualifierRounds.length === 5, "GGP needs five rounds");
      assert(state.qualifierRounds.slice(1).every(round => !round.stages.length), "GGP pre-generated later rounds before exclusions");
      assert(getEligibleParticipants().length === 60, "GGP monthly seed was not excluded");
      const seedsSaved = JSON.stringify(state.tournament.ggpSeeds);
      updateGgpSeed(0, "remove");
      assert(JSON.stringify(state.tournament.ggpSeeds) === seedsSaved, "GGP seeds changed after start");
      startQualifierRound(2);
      assert(!state.qualifierRounds[2].stages.length, "GGP allowed skipping an unfinished round");
      const ggpCounts = [];
      for (let ri = 0; ri < 5; ri++) {
        if (!lastStage(ri)) startQualifierRound(ri);
        let stage = lastStage(ri);
        const excluded = new Set([seedPlayer.id, ...getGgpQualifiedPlayers().map(player => player.id)]);
        assert(stage.groups.flatMap(actualSlots).every(player => !excluded.has(player.id)), "GGP qualified player re-entered a later round");
        ggpCounts.push(stage.groups.flatMap(actualSlots).length);
        if (ri === 0) {
          createNextStage(ri);
          assert(lastStage(ri) === stage, "GGP advanced with unresolved races");
          const firstGroup = stage.groups[0];
          actualSlots(firstGroup).slice(0, 3).forEach(player => toggleAdvance(ri, 0, firstGroup.id, player.id));
          assert(firstGroup.advanceIds.length === 2, "GGP qualifier accepted three advances");
          firstGroup.advanceIds.slice().forEach(id => toggleAdvance(ri, 0, firstGroup.id, id));
        }
        for (let guard = 0; guard < 8; guard++) {
          stage = lastStage(ri);
          const si = state.qualifierRounds[ri].stages.length - 1;
          const quota = ggpAdvanceLimit(stage.type);
          stage.groups.forEach(group => {
            actualSlots(group).slice(0, quota).forEach(player => toggleAdvance(ri, si, group.id, player.id));
            confirmGgpGroup(ri, si, group.id);
          });
          if (stage.type === "ggpRoundFinal") {
            confirmRoundFinalist(ri, { activateNext: true });
            assert(state.qualifierRounds[ri].ggpFinalists.length === 3, "GGP round did not qualify three racers");
            break;
          }
          createNextStage(ri);
          assert(lastStage(ri) !== stage, "GGP next stage was not generated");
        }
      }
      assert(JSON.stringify(ggpCounts) === JSON.stringify([60,57,54,51,48]), `GGP exclusion counts wrong: ${ggpCounts}`);
      assert(new Set(getGgpQualifiedPlayers().map(player => player.id)).size === 15, "GGP qualifiers duplicated");
      createFinalRace();
      assert(state.finalRace.type === "ggpSemiFinal" && getFinalGroups().length === 5, "GGP final semifinal must have exactly five groups");
      assert(getFinalGroups().flatMap(actualSlots).length === 24, "GGP final semifinal lost slots");
      assert(new Set(getFinalGroups().flatMap(actualSlots).map(player => player.id)).size === 24, "GGP multiple seeds collapsed to one ID");
      getGgpSeeds().forEach(seed => assert(getFinalGroups()[seed.group - 1].slots[seed.lane - 1].sourcePlayerId === seedPlayer.id, "GGP reserved seed moved"));
      assert(!isTournamentFinalResultReady(), "GGP semifinal can finish tournament");
      const privateSemi = JSON.parse(JSON.stringify(exportState()));
      state = normalizeImportedState(privateSemi);
      assert(getFinalGroups().length === 5 && getGgpQualifiedPlayers().length === 15, "GGP restore lost qualifiers or seeds");
      getFinalGroups().forEach(group => {
        toggleFinalWinner(actualSlots(group)[0].id, group.id);
        confirmGgpGroup(-1, 0, group.id);
      });
      const publicSemi = makePublicStatePayload(exportState());
      assert(publicSemi.qualifierRounds.every(round => round.ggpFinalists.length === 3), "GGP public DTO lost qualifiers");
      assert(!JSON.stringify(publicSemi).includes("sourcePlayerId") && !JSON.stringify(publicSemi).includes("ggpSeeds"), "GGP private seed data leaked");
      assert(!JSON.stringify(publicSemi).includes(seedPlayer.id), "GGP private IDs leaked");
      createGgpFinalFromSemi();
      assert(state.finalRace.type === "ggpFinal" && actualSlots(state.finalRace.group).length === 5, "GGP final did not receive five winners");
      const publicFinal = makePublicLivePayload(exportState());
      const recovered = window.__mini4wdMergeNewerPublicRunningStateV278(privateSemi, publicFinal);
      assert(!recovered.finalRace.groups && recovered.finalRace.semiGroups.length === 5, "GGP recovered final retained stale semifinal groups");
      assert(recovered.finalRace.semiGroups.flatMap(actualSlots).every(player => !player.id.startsWith("pub-")), "GGP recovery lost private entry IDs");
      toggleFinalWinner(actualSlots(state.finalRace.group)[0].id, state.finalRace.group.id);
      assert(!isTournamentFinalResultReady(), "GGP final finished before explicit result confirmation");
      confirmGgpGroup(-1, 0, state.finalRace.group.id);
      assert(isTournamentFinalResultReady(), "GGP final confirmation missing");
      const ggpRows = getStageResultRows();
      assert(ggpRows.filter(row => row.단계 === "GGP최종준결").length === 25, "GGP result export lost semifinal history");
      assert(ggpRows.filter(row => /GGP [123]위/.test(row.결과)).length === 15, "GGP round ranking export missing");
      await wait(180);
      await finishTournament();
      await wait(900);
      assert(historyCount() > historyBefore, "GGP public history did not save");
      await summarize("ggp", { ggpCounts, seeds: 9, qualified: 15, historySaved: true });

      // No qualifiers / fewer finishers must not strand the tournament.
      await reset("ggp", 5, 4);
      for (let ri = 0; ri < 5; ri++) {
        if (!lastStage(ri)) startQualifierRound(ri);
        const stage = lastStage(ri);
        stage.groups.forEach(group => confirmGgpGroup(ri, 0, group.id));
        createNextStage(ri);
        assert(isRoundNoFinalistV275(state.qualifierRounds[ri]), "GGP all-out round not completed");
      }
      assert(getEligibleParticipants().length === 4, "GGP course-out permanently withdrew entrants");
      createFinalRace();
      assert(getFinalGroups().length === 5, "GGP empty final semifinal lost fixed five groups");
      getFinalGroups().forEach(group => confirmGgpGroup(-1, 0, group.id));
      createGgpFinalFromSemi();
      assert(isTournamentFinalResultReady() && getFinalWinners().length === 0, "GGP all-out final cannot finish without invented winner");
      await wait(180);
      await finishTournament();
      await wait(900);
      algorithmChecks.ggpAllOut = true;
      algorithmChecks.ggpSeedPlacementAndExclusion = true;
      modes.push("ggp");
      return { ok: true, modes, summaries, alerts, algorithmChecks };
    } finally {
      window.alert = originalAlert;
      window.confirm = originalConfirm;
    }
  });

  await page.close();
  return { viewport, failures, result };
}

async function runGgpUi(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const failures = [];
  await installNetworkStubs(page);
  page.on("pageerror", error => failures.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator");
  await page.evaluate(() => {
    state = makeInitialState(3);
    state.inputText = Array.from({ length: 61 }, (_, i) => `GGP선수${i + 1}/테스트`).join("\n");
    state.tournament.name = "GGP UI QA";
    state.tournament.venue = "QA Venue";
    renderOperator();
  });
  await page.getByRole("button", { name: "GGP 최종전", exact: true }).click();
  await page.getByRole("button", { name: "시드 추가", exact: true }).click();
  await page.getByRole("button", { name: "시드 추가", exact: true }).click();
  await page.getByLabel("시드 2 조", { exact: true }).selectOption("5");
  await page.getByLabel("시드 2 레인", { exact: true }).selectOption("5");
  await page.getByLabel("시드 1 조", { exact: true }).selectOption("5");
  await page.getByLabel("시드 1 레인", { exact: true }).selectOption("5");
  const duplicateBlocked = await page.evaluate(() => Boolean(validateGgpSeeds()));
  if (!duplicateBlocked) failures.push("GGP duplicate seed placement accepted");
  await page.getByLabel("시드 1 조", { exact: true }).selectOption("1");
  await page.getByLabel("시드 1 레인", { exact: true }).selectOption("1");
  const screenshotDir = require("os").tmpdir();
  await page.locator(".ggp-seeds").screenshot({ path: path.join(screenshotDir, `mtm-ggp-seeds-${viewport.width}.png`) });
  const draftCheck = await page.evaluate(() => ({
    lanes: state.settings.laneCount,
    seeds: state.tournament.ggpSeeds.length,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    rowOverflow: [...document.querySelectorAll(".ggp-seed-row")].some(row => row.scrollWidth > row.clientWidth + 1)
  }));
  if (draftCheck.lanes !== 5 || draftCheck.seeds !== 2 || draftCheck.overflow || draftCheck.rowOverflow) failures.push(`GGP seed UI failed: ${JSON.stringify(draftCheck)}`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator");
  const restored = await page.evaluate(() => state.settings.matchMode === "ggp" && state.tournament.ggpSeeds?.length === 2 && state.tournament.ggpSeeds[1].group === 5 && state.tournament.ggpSeeds[1].lane === 5);
  if (!restored) failures.push("GGP seed assignments lost on actual reload");
  await page.evaluate(async () => {
    await startTournamentAsync();
    if (state.tournament.status !== "running") throw new Error("GGP UI tournament did not start");
    // Build completed round fixtures to inspect final surfaces and exercise guarded undo.
    state.qualifierRounds.forEach((round, index) => {
      round.noFinalist = true;
      round.finalistStatus = "none";
    });
    createFinalRace();
  });
  await page.locator(".final-box").scrollIntoViewIfNeeded();
  await page.locator(".final-box").screenshot({ path: path.join(screenshotDir, `mtm-ggp-semi-${viewport.width}.png`) });
  const finalCheck = await page.evaluate(() => {
    const groups = getFinalGroups();
    return { count: groups.length, overflow: document.documentElement.scrollWidth > innerWidth + 1, seedPlaces: [groups[0].slots[0].name, groups[4].slots[4].name] };
  });
  if (finalCheck.count !== 5 || finalCheck.overflow || finalCheck.seedPlaces.some(name => name !== "GGP선수1")) failures.push(`GGP semifinal UI failed: ${JSON.stringify(finalCheck)}`);
  // No production endpoint is used: keep the same stub database over a real reload.
  const store = await page.evaluate(() => {
    flushStateBeforeUnloadV95("qa-ggp-reload");
    return JSON.parse(JSON.stringify(window.__qaFirebaseStore));
  });
  await page.addInitScript(value => { window.__qaGgpRestoredStore = value; }, store);
  await page.route("**/*", route => {
    if (/gstatic\.com\/firebasejs/.test(route.request().url())) return route.fulfill({ status: 200, contentType: "application/javascript", body: firebaseStub.replace("const listeners = [];", "Object.assign(store, window.__qaGgpRestoredStore || {}); const listeners = [];") });
    return route.fallback();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-ui-surface") === "operator");
  const liveRestore = await page.evaluate(() => state.finalRace?.type === "ggpSemiFinal" && getFinalGroups().length === 5 && state.tournament.ggpSeeds?.length === 2);
  if (!liveRestore) failures.push("GGP running semifinal lost on reload");
  const publicPayload = await page.evaluate(() => makePublicLivePayload(exportState()));
  // Render the same allowlisted data on the viewer; no operator seed controls may appear.
  await page.evaluate(payload => { renderMobileSnapshot(payload.state); }, publicPayload);
  const viewerCheck = await page.evaluate(() => ({ seedControls: document.querySelectorAll(".ggp-seeds").length, text: document.body.innerText.includes("GGP 최종 준결승"), overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  if (viewerCheck.seedControls || !viewerCheck.text || viewerCheck.overflow) failures.push(`GGP viewer failed: ${JSON.stringify(viewerCheck)}`);
  await page.screenshot({ path: path.join(screenshotDir, `mtm-ggp-viewer-${viewport.width}.png`), fullPage: true });
  await page.close();
  return { viewport, failures, result: { ok: failures.length === 0, ggpUi: true, draftCheck, finalCheck, liveRestore, viewerCheck } };
}

async function main() {
  const meta = readBuildMeta();
  const server = await startServer();
  const launchOptions = { headless: true };
  const executablePath = browserPath();
  if (executablePath) launchOptions.executablePath = executablePath;
  const browser = await playwright.chromium.launch(launchOptions);
  try {
    const viewports = [
      { width: 1365, height: 900 },
      { width: 390, height: 844 }
    ];
    const results = [];
    for (const viewport of viewports) {
      if (!process.env.MINI4WD_QA_GGP_UI_ONLY) results.push(await runViewport(browser, viewport));
    }
    for (const viewport of [...viewports, { width: 320, height: 720 }]) results.push(await runGgpUi(browser, viewport));
    const failed = results.reduce((count, item) => count + item.failures.length + (item.result?.ok ? 0 : 1), 0);
    const output = {
      version: meta.version,
      label: meta.label,
      checked: results.length,
      failed,
      results
    };
    console.log(JSON.stringify(output, null, 2));
    if (failed) process.exit(1);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
