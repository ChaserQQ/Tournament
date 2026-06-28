    const MINI4WD_FALLBACK_SURFACES = [
      "operator", "admin-accounts", "admin-matches", "dashboard",
      "player-management", "mobile-live", "tv-live", "live-lobby",
      "login", "restricted", "print", "error"
    ];
    const MINI4WD_FALLBACK_PAGE_CLASSES = [
      "ui-page-operator", "ui-page-db", "ui-page-admin", "ui-page-dashboard",
      "ui-page-live-lobby", "ui-page-mobile-live", "ui-page-tv-live", "ui-page-login",
      "ui-page-print", "ui-page-restricted", "ui-page-error"
    ];
    const MINI4WD_BUILD = window.MINI4WD_BUILD_META || {
      version: 185,
      label: "BUILD v185 RUNTIME CLEANUP",
      rulesChanged: false,
      surfaces: MINI4WD_FALLBACK_SURFACES,
      pageClasses: MINI4WD_FALLBACK_PAGE_CLASSES
    };
    const MINI4WD_BUILD_LABEL = MINI4WD_BUILD.label || "BUILD v185 RUNTIME CLEANUP";
    const MINI4WD_SURFACES = Array.isArray(MINI4WD_BUILD.surfaces) && MINI4WD_BUILD.surfaces.length
      ? Array.from(MINI4WD_BUILD.surfaces)
      : MINI4WD_FALLBACK_SURFACES;
    const MINI4WD_SURFACE_CLASSES = MINI4WD_SURFACES.map(surface => `surface-${surface}`);
    const MINI4WD_PAGE_CLASSES = Array.isArray(MINI4WD_BUILD.pageClasses) && MINI4WD_BUILD.pageClasses.length
      ? Array.from(MINI4WD_BUILD.pageClasses)
      : MINI4WD_FALLBACK_PAGE_CLASSES;

    function mini4wdBuildLabel() {
      return MINI4WD_BUILD_LABEL;
    }

    function mini4wdBuildScopes() {
      return Array.from(MINI4WD_SURFACES);
    }

    let state = makeInitialState(3);
    let activeRoundIndex = 0;
    let tvState = null;
    let tvPage = 0;
    let tvGroupsPerPage = 3;
    let dbSelectedIds = new Set();
    let dbSearchText = "";
    let dbTeamFilter = "전체";
    let dbStatusFilter = "전체";
    let dbSortField = localStorage.getItem("mini4wdDbSortField") || "createdAt";
    let dbSortDir = localStorage.getItem("mini4wdDbSortDir") || "desc";

    let firebaseApp = null;
    let firebaseDb = null;
    let firebaseTournamentId = DEFAULT_TOURNAMENT_ID;
    let firebaseSaveTimer = null;
    let firebaseApplyingRemote = false;
    let firebaseOnline = false;


    const app = document.getElementById("app");

    function makeInitialState(laneCount) {
      return {
        inputText: SAMPLE_TEXT,
        settings: {
          laneCount,
          matchMode: "basic",
          avoidance: "none",
          forcedGroupCount: "",
          excludeFinalists: true,
          sameLanePrevention: false,
          nextGroupSize: "",
          firebaseAutoSave: false
        },
        tournament: {
          name: "",
          venue: "",
          raceClass: "오픈",
          status: "draft",
          startedAtISO: "",
          startedAtDisplay: "",
          endedAtISO: "",
          endedAtDisplay: "",
          liveStopped: false
        },
        activeRoundIndex: 0,
        broadcast: {
          mode: "stage",
          roundIndex: 0,
          stageIndex: 0
        },
        qualifierRounds: makeQualifierRounds(laneCount, "basic"),
        finalRace: null,
        updatedAt: Date.now()
      };
    }

    function makeQualifierRounds(laneCount, matchMode = "basic") {
      if (matchMode === "revival") {
        return [{
          id: "revival-main",
          index: 1,
          title: "패자부활 토너먼트",
          stagePlan: [],
          stages: [],
          finalist: null
        }];
      }

      return Array.from({ length: laneCount }, (_, index) => ({
        id: `qr-${index + 1}`,
        index: index + 1,
        title: `${index + 1}차 라운드`,
        stagePlan: [],
        stages: [],
        finalist: null
      }));
    }    function saveLiveState() {
      ensureStateDefaults();
      state.updatedAt = Date.now();
      state.activeRoundIndex = activeRoundIndex;
      if (state.tournament.status === "running") {
        state.settings.firebaseAutoSave = true;
        activateAutoLiveSession();
      }
      persistCurrentState();
      createAutoSnapshot("자동 저장");
      if (state.tournament.status === "running") queueFirebaseSave();
    }

function shuffle(array) {
      const result = [...array];
      for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    }

    function collectLaneHistory() {
      const history = new Map();

      function addPlayer(player) {
        if (!player || !player.id || !player.lane || player.isEmptyLane) return;
        const key = `${player.id}|${player.lane}`;
        history.set(key, (history.get(key) || 0) + 1);
      }

      state.qualifierRounds.forEach(round => {
        (round.stages || []).forEach(stage => {
          (stage.groups || []).forEach(group => {
            (group.slots || []).forEach(addPlayer);
          });
        });
      });

      if (state.finalRace?.group?.slots) {
        state.finalRace.group.slots.forEach(addPlayer);
      }

      return history;
    }

    function makeLaneOrders(lanes, length) {
      const result = [];

      function backtrack(current, used) {
        if (current.length === length) {
          result.push([...current]);
          return;
        }

        shuffle(lanes).forEach(lane => {
          if (used.has(lane)) return;
          used.add(lane);
          current.push(lane);
          backtrack(current, used);
          current.pop();
          used.delete(lane);
        });
      }

      backtrack([], new Set());
      return result;
    }

    function assignLanes(players, laneCount) {
      const lanes = Array.from({ length: laneCount }, (_, index) => index + 1);
      const shuffledPlayers = shuffle(players);
      let assignedPlayers = [];

      if (!state.settings.sameLanePrevention) {
        const laneNumbers = shuffle(lanes).slice(0, players.length);
        assignedPlayers = shuffledPlayers.map((player, index) => ({ ...player, lane: laneNumbers[index] }));
      } else {
        const history = collectLaneHistory();
        const laneOrders = makeLaneOrders(lanes, shuffledPlayers.length);
        let bestOrder = laneOrders[0] || lanes.slice(0, shuffledPlayers.length);
        let bestScore = Number.POSITIVE_INFINITY;

        laneOrders.forEach(order => {
          const score = order.reduce((sum, lane, index) => {
            const player = shuffledPlayers[index];
            return sum + ((history.get(`${player.id}|${lane}`) || 0) * 100);
          }, 0);

          if (score < bestScore || (score === bestScore && Math.random() < 0.5)) {
            bestScore = score;
            bestOrder = order;
          }
        });

        assignedPlayers = shuffledPlayers.map((player, index) => ({ ...player, lane: bestOrder[index] }));
      }

      const assignedByLane = new Map(assignedPlayers.map(player => [player.lane, player]));

      return lanes.map(lane => assignedByLane.get(lane) || {
        id: `empty-lane-${lane}-${Math.random().toString(36).slice(2, 8)}`,
        name: "빈 레인",
        team: "",
        lane,
        isEmptyLane: true
      });
    }

    function estimateStageCount(playerCount, laneCount) {
      if (playerCount <= laneCount) return 1;
      let count = playerCount;
      let stages = 0;
      while (count > laneCount) {
        stages += 1;
        count = Math.ceil(count / laneCount);
      }
      return stages + 1;
    }

    function makeStagePlan(playerCount, laneCount) {
      const total = estimateStageCount(playerCount, laneCount);
      const base = ["예선", "본선", "준결승", "라운드 결승"];

      if (total <= 4) return base.slice(4 - total);
      if (total === 5) return ["예선", "본선", "준준결승", "준결승", "라운드 결승"];

      const extraPrelimCount = total - 4;
      const extras = Array.from({ length: extraPrelimCount }, (_, index) => `${index + 1}차 예선`);
      return [...extras, "본선", "준준결승", "준결승", "라운드 결승"];
    }

    function getAttemptCount() {
      const level = state.settings.avoidance;
      if (level === "none") return 1;
      if (level === "low") return 120;
      if (level === "medium") return 500;
      return 1500;
    }

    function scoreGroups(groups) {
      if (state.settings.avoidance === "none") return 0;

      let score = 0;
      groups.forEach(group => {
        const teamCount = new Map();
        group.forEach(p => {
          if (!p || !p.team) return;
          teamCount.set(p.team, (teamCount.get(p.team) || 0) + 1);
        });

        teamCount.forEach(count => {
          if (count >= 2) {
            const pairCount = count * (count - 1) / 2;
            score += pairCount * (state.settings.avoidance === "high" ? 300 : state.settings.avoidance === "medium" ? 180 : 100);
          }
          if (count >= 3) score += count * 200;
        });
      });

      return score;
    }

    function sameTeamGroupCount(groups) {
      return groups.reduce((sum, group) => {
        const map = new Map();
        group.forEach(p => {
          if (!p || !p.team) return;
          map.set(p.team, (map.get(p.team) || 0) + 1);
        });
        return sum + ([...map.values()].some(v => v >= 2) ? 1 : 0);
      }, 0);
    }

    function cleanForcedGroupCountInput(value) {
      return String(value ?? "").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
    }

    function syncForcedGroupCountInputFromDom() {
      const input = document.querySelector(".forced-group-count-input-v265");
      if (!input) return String(state.settings.forcedGroupCount || "").trim();
      const next = cleanForcedGroupCountInput(input.value);
      state.settings.forcedGroupCount = next;
      if (input.value !== next) input.value = next;
      return next;
    }

    function getForcedGroupCount() {
      const raw = syncForcedGroupCountInputFromDom();
      if (!raw) return null;
      if (!/^\d+$/.test(raw)) return null;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) return null;
      return value;
    }

    function validateForcedGroupCountInput() {
      const raw = syncForcedGroupCountInputFromDom();
      if (!raw) return "";
      if (!/^\d+$/.test(raw)) return "조 편성은 숫자만 입력하세요.";
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 1) return "조 편성은 1 이상의 숫자로 입력하세요.";
      return "";
    }

    function restoreForcedGroupCountScroll(inputEl, left, top) {
      if (!inputEl || document.activeElement !== inputEl) return;
      requestAnimationFrame(() => {
        if (document.activeElement !== inputEl) return;
        if (Math.abs((window.scrollY || 0) - top) > 2 || Math.abs((window.scrollX || 0) - left) > 2) {
          window.scrollTo({ left, top, behavior: "auto" });
        }
      });
    }

    function setForcedGroupCountDraft(value, inputEl = null) {
      const left = window.scrollX || 0;
      const top = window.scrollY || 0;
      const next = cleanForcedGroupCountInput(value);
      state.settings.forcedGroupCount = next;
      if (inputEl && inputEl.value !== next) inputEl.value = next;
      restoreForcedGroupCountScroll(inputEl, left, top);
    }

    function commitForcedGroupCountInput(inputEl) {
      const left = window.scrollX || 0;
      const top = window.scrollY || 0;
      const raw = inputEl && Object.prototype.hasOwnProperty.call(inputEl, "value") ? inputEl.value : inputEl;
      const next = cleanForcedGroupCountInput(raw);
      state.settings.forcedGroupCount = next;
      if (inputEl && Object.prototype.hasOwnProperty.call(inputEl, "value") && inputEl.value !== next) inputEl.value = next;
      restoreForcedGroupCountScroll(inputEl, left, top);
    }

    document.addEventListener("input", event => {
      const input = event.target && event.target.closest ? event.target.closest(".forced-group-count-input-v265") : null;
      if (!input) return;
      setForcedGroupCountDraft(input.value, input);
    });

    function bindForcedGroupCountInputs(root = document) {
      root.querySelectorAll(".forced-group-count-input-v265").forEach(input => {
        if (input.__forcedGroupCountBoundV265) return;
        input.__forcedGroupCountBoundV265 = true;
        input.addEventListener("input", () => setForcedGroupCountDraft(input.value, input));
        input.addEventListener("change", () => commitForcedGroupCountInput(input));
        input.addEventListener("blur", () => commitForcedGroupCountInput(input));
        input.addEventListener("keydown", event => {
          if (event.key !== "Enter") return;
          commitForcedGroupCountInput(input);
          input.blur();
        });
      });
    }

    function getNextGroupSize() {
      const size = Number(state.settings.nextGroupSize || 0);
      if (!size || size < 2 || size > state.settings.laneCount) return state.settings.laneCount;
      return size;
    }

    function setNextGroupSize(size) {
      state.settings.nextGroupSize = size;
      renderOperator();
    }

    function renderGroupSizeControl() {
      const options = ["", ...Array.from({ length: Math.max(0, state.settings.laneCount - 1) }, (_, index) => index + 2)];
      return `
        <div class="group-size-control group-size-control-v145" role="group" aria-label="다음 경기 조 인원">
          <span class="group-size-label-v145">다음 경기 조 인원</span>
          <div class="group-size-buttons-v145">
            ${options.map(option => `
              <button type="button" class="group-size-button-v145 ${String(state.settings.nextGroupSize || "") === String(option) ? "active" : ""}" onclick="setNextGroupSize('${option}')">${option === "" ? "자동" : `${option}명`}</button>
            `).join("")}
          </div>
        </div>
      `;
    }

    function buildCandidateGroups(players, stageName) {
      const laneCount = state.settings.laneCount;
      const targetGroupSize = getNextGroupSize();
      const forced = stageName === "예선" || stageName.includes("예선") ? getForcedGroupCount() : null;

      let groupCount = forced || Math.ceil(players.length / targetGroupSize);

      if (!forced && players.length > 1) {
        const minGroups = Math.ceil(players.length / laneCount);
        const maxGroupsWithoutSingle = Math.max(1, Math.floor(players.length / 2));
        groupCount = Math.max(minGroups, Math.min(groupCount, maxGroupsWithoutSingle));
      }

      const groups = Array.from({ length: groupCount }, () => []);

      shuffle(players).forEach(player => {
        const options = groups
          .map((group, index) => ({ group, index }))
          .filter(item => item.group.length < laneCount)
          .map(item => item.index);

        if (!options.length) {
          groups.push([player]);
          return;
        }

        const ranked = shuffle(options).map(index => {
          const temp = groups.map((group, groupIndex) => groupIndex === index ? [...group, player] : [...group]);
          const targetPenalty = Math.max(0, temp[index].length - targetGroupSize) * 10;
          return {
            index,
            score: scoreGroups(temp) + targetPenalty,
            size: groups[index].length
          };
        }).sort((a, b) => a.score - b.score || a.size - b.size || Math.random() - .5);

        groups[ranked[0].index].push(player);
      });

      const activeGroups = groups.filter(group => group.length > 0);

      if (activeGroups.length > 1) {
        const singleIndex = activeGroups.findIndex(group => group.length === 1);
        if (singleIndex >= 0) {
          const targetIndex = activeGroups.findIndex((group, index) => index !== singleIndex && group.length < laneCount);
          if (targetIndex >= 0) {
            activeGroups[targetIndex].push(activeGroups[singleIndex][0]);
            activeGroups.splice(singleIndex, 1);
          }
        }
      }

      return activeGroups;
    }

    function generateStage(players, qualifierIndex, stageIndex, stageName) {
      const laneCount = state.settings.laneCount;
      const tries = players.length <= laneCount ? 1 : getAttemptCount();
      let best = null;
      let bestScore = Infinity;

      for (let i = 0; i < tries; i += 1) {
        const candidate = buildCandidateGroups(players, stageName);
        const score = scoreGroups(candidate);
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }

      return {
        id: `q${qualifierIndex}-s${stageIndex}-${Math.random().toString(36).slice(2, 8)}`,
        qualifierIndex,
        stageIndex,
        name: stageName,
        groups: best.map((slots, index) => ({
          id: `q${qualifierIndex}-s${stageIndex}-g${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${index + 1}조`,
          slots: assignLanes(slots, laneCount),
          advanceIds: []
        })),
        meta: {
          attempts: tries,
          score: bestScore,
          sameTeam: sameTeamGroupCount(best),
          groupSize: getNextGroupSize()
        }
      };
    }

    function getEligibleParticipants() {
      const withdrawnIds = getWithdrawnPlayerIdSet();
      const participants = parseParticipants().filter(player => !withdrawnIds.has(String(player.id)));
      if (!state.settings.excludeFinalists) return participants;

      const finalizedIds = new Set(
        state.qualifierRounds
          .filter(round => round.finalist)
          .map(round => String(round.finalist.id))
      );
      return participants.filter(player => !finalizedIds.has(String(player.id)));
    }

    function validateStart(players, stageName = "예선") {
      if (players.length < 2) return "참가자는 최소 2명 이상 필요합니다.";
      if (players.length > 150) return "현재 버전은 150명 이하를 권장합니다.";

      const names = parseParticipants().map(p => p.name);
      const duplicated = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
      if (duplicated.length) return "동명이인이 있습니다. 이름 뒤에 번호 등을 붙여 구분하세요: " + duplicated.join(", ");

      const forcedError = validateForcedGroupCountInput();
      if (forcedError) return forcedError;
      const forced = getForcedGroupCount();
      if (forced && (stageName === "예선" || stageName.includes("예선"))) {
        const minimum = Math.ceil(players.length / state.settings.laneCount);
        if (forced < minimum) return `${state.settings.laneCount}레인 기준 현재 참가자는 최소 ${minimum}조 이상 필요합니다.`;
        if (forced > players.length) return `조편성(수동)는 참가자 수 ${players.length}개를 초과할 수 없습니다.`;
      }

      return "";
    }

    function setActiveRound(roundIndex) {
      activeRoundIndex = roundIndex;
      state.activeRoundIndex = roundIndex;

      const round = state.qualifierRounds[roundIndex];
      if (round && round.stages.length) {
        state.broadcast = {
          mode: "stage",
          roundIndex,
          stageIndex: round.stages.length - 1
        };
      }

      renderOperator();
    }


    function ensureStateDefaults() {
      state.settings = state.settings || {};
      if (!state.settings.matchMode) state.settings.matchMode = "basic";
      if (state.settings.matchMode === "points") state.settings.matchMode = "points3";
      if (state.settings.sameLanePrevention === undefined) state.settings.sameLanePrevention = true;
      if (!state.tournament) {
        state.tournament = { name: "", venue: "", raceClass: "오픈", status: "draft", startedAtISO: "", startedAtDisplay: "", endedAtISO: "", endedAtDisplay: "" };
      }
      if (state.tournament.name === undefined) state.tournament.name = "";
      if (state.tournament.venue === undefined) state.tournament.venue = "";
      state.tournament.raceClass = normalizeRaceClassName(state.tournament.raceClass);
      if (state.tournament.status === undefined) state.tournament.status = state.tournament.startedAtISO ? "running" : "draft";
      if (state.tournament.startedAtISO === undefined) state.tournament.startedAtISO = "";
      if (state.tournament.startedAtDisplay === undefined) state.tournament.startedAtDisplay = "";
      if (state.tournament.endedAtISO === undefined) state.tournament.endedAtISO = "";
      if (state.tournament.endedAtDisplay === undefined) state.tournament.endedAtDisplay = "";
      if (state.tournament.liveId === undefined) state.tournament.liveId = "";
      if (state.tournament.venueId === undefined) state.tournament.venueId = "";
      if (!Array.isArray(state.tournament.withdrawnPlayerIds)) state.tournament.withdrawnPlayerIds = [];
      if (state.settings.firebaseAutoSave === undefined) state.settings.firebaseAutoSave = false;
    }

    function statusLabel(status = state.tournament?.status) {
      return {
        draft: "준비중",
        running: "진행중",
        finished: "종료",
        archived: "저장 완료"
      }[status] || "준비중";
    }
function startTournament() {
      startTournamentAsync();
    }

    async function startTournamentAsync() {
      ensureStateDefaults();
      if (!canModifyTournamentAction("대회 시작")) return;
      if (!validateTournamentMetaRequired()) return;

      const plannedId = buildAutoTournamentId();
      const preStartPlayers = getEligibleParticipants();
      const preStartError = validateStart(preStartPlayers, "예선");
      if (preStartError) return showError(preStartError);
      const claimed = await claimActiveTournamentForVenue(plannedId);
      if (!claimed) return;

      ensureTournamentStarted();
      state.tournament.status = "running";
      state.tournament.venueId = currentVenueId();
      state.tournament.venue = currentVenueName();
      state.settings.firebaseAutoSave = true;
      activateAutoLiveSession(true);
      state.tournament.lockedParticipants = state.inputText;
      state.tournament.lockedSettings = {
        matchMode: state.settings.matchMode,
        laneCount: state.settings.laneCount
      };
      createAutoSnapshot("대회 시작");
      logTournamentAction("대회 시작", state.tournament.name || "");
      startAllFirstStages();
      forceLiveBroadcastSync("tournament-start").finally(() => renderOperator());
    }

    async function claimActiveTournamentForVenue(plannedId) {
      const db = initFirebase();
      if (!db || !currentAuthUser) {
        try {
          const existingId = localStorage.getItem("mini4wdActiveLiveId") || "";
          if (existingId && existingId !== plannedId) {
            alert("이 브라우저에는 이미 진행 중인 대회가 있습니다. 기존 대회를 종료한 후 새로운 대회를 시작하세요.");
            return false;
          }
        } catch (_) {}
        return true;
      }
      const venueId = currentVenueId();
      const ref = db.ref(`activeTournaments/${venueId}`);
      try {
        try { await cleanupActiveTournamentForVenueV151(venueId); } catch (cleanupError) { console.warn("active tournament cleanup skipped", cleanupError); }
        const claimTransaction = () => ref.transaction(current => {
          if (current && current.status === "running" && current.tournamentId && current.tournamentId !== plannedId) return;
          return {
            venueId,
            venueName: currentVenueName(),
            tournamentId: plannedId,
            tournamentName: state.tournament.name || "",
            raceClass: normalizeRaceClassName(state.tournament.raceClass),
            status: "running",
            uid: currentAuthUser?.uid || "",
            email: currentAuthUser?.email || "",
            updatedAt: firebase.database.ServerValue.TIMESTAMP
          };
        });
        let result = await claimTransaction();
        if (!result.committed) {
          const cleanup = await cleanupActiveTournamentForVenueV151(venueId).catch(() => ({ removed: false }));
          if (cleanup.removed) result = await claimTransaction();
        }
        if (!result.committed) {
          const active = result.snapshot?.val() || {};
          alert(`이 경기장에서는 이미 진행 중인 대회가 있습니다.\n대회명: ${active.tournamentName || active.tournamentId || "진행 중 대회"}\n기존 대회를 종료한 뒤 새 대회를 시작하세요.`);
          return false;
        }
        return true;
      } catch (error) {
        alert("진행 중 대회 확인에 실패했습니다. Firebase 규칙/연결을 확인하세요.\n" + (error.message || error));
        return false;
      }
    }

    function releaseActiveTournamentForVenue(status = "finished") {
      const db = initFirebase();
      if (!db || !currentAuthUser) return;
      const venueId = currentVenueId();
      const id = getCurrentTournamentId();
      const ref = db.ref(`activeTournaments/${venueId}`);
      ref.get().then(snapshot => {
        const active = snapshot.val();
        if (!active || active.tournamentId !== id) return;
        if (status === "archived" || status === "finished-clear") return ref.remove();
        return ref.update({ status, updatedAt: firebase.database.ServerValue.TIMESTAMP });
      }).catch(() => {});
    }

    function isFirebasePermissionDeniedV151(error) {
      const message = String(error?.code || error?.message || error || "");
      return /permission.?denied|PERMISSION_DENIED/i.test(message);
    }

    async function removeActiveTournamentRefV151(ref, reason) {
      try {
        await ref.remove();
        return { removed: true, reason };
      } catch (error) {
        if (isFirebasePermissionDeniedV151(error)) return { removed: false, reason: "permission-denied" };
        throw error;
      }
    }

    async function cleanupActiveTournamentForVenueV151(venueId = currentVenueId()) {
      const db = initFirebase();
      if (!db || !currentAuthUser || !venueId) return { removed: false, reason: "unavailable" };
      const ref = db.ref(`activeTournaments/${venueId}`);
      let activeSnap;
      try {
        activeSnap = await ref.get();
      } catch (error) {
        if (isFirebasePermissionDeniedV151(error)) return { removed: false, reason: "permission-denied" };
        throw error;
      }
      const active = activeSnap.val();
      if (!active) return { removed: false, reason: "empty" };
      const tournamentId = active.tournamentId || active.id || "";
      if (!tournamentId) {
        return removeActiveTournamentRefV151(ref, "missing-id");
      }

      const [tournamentSnap, publicLiveSnap] = await Promise.all([
        db.ref(`tournaments/${tournamentId}`).get(),
        db.ref(`${PUBLIC_LIVE_PATH}/${tournamentId}`).get()
      ]);
      const tournamentRecord = tournamentSnap.val();
      const publicLiveRecord = publicLiveSnap.val();
      const tournamentStatus = tournamentRecord?.state?.tournament?.status || tournamentRecord?.status || "";
      const publicLiveStatus = publicLiveRecord?.state?.tournament?.status || publicLiveRecord?.status || "";
      const resolvedStatus = tournamentStatus || publicLiveStatus || active.status || "";

      if (!tournamentRecord && !publicLiveRecord) {
        return removeActiveTournamentRefV151(ref, "missing-record");
      }
      if (active.status !== "running" || (resolvedStatus && resolvedStatus !== "running")) {
        return removeActiveTournamentRefV151(ref, `status-${resolvedStatus || active.status || "unknown"}`);
      }
      return { removed: false, reason: "running" };
    }
    try { window.cleanupActiveTournamentForVenueV151 = cleanupActiveTournamentForVenueV151; } catch (error) {}

    function clearActiveTournamentSessionV116() {
      try {
        localStorage.removeItem("mini4wdActiveLiveId");
        localStorage.removeItem("mini4wdActiveLiveSignature");
        localStorage.removeItem("mini4wdActiveLiveDate");
      } catch (error) {}
      state.tournament.liveId = "";
      state.tournament.liveSignature = "";
      firebaseTournamentId = buildAutoTournamentId();
      safeSetItem("mini4wdTournamentId", firebaseTournamentId);
    }

    function prepareNextTournamentDraftV116(reason = "manual") {
      ensureStateDefaults();
      const previousInputText = state.inputText || "";
      const previousSettings = { ...(state.settings || {}) };
      const previousVenue = state.tournament?.venue || currentVenueName() || "";
      const previousVenueId = state.tournament?.venueId || currentVenueId() || "";
      const previousRaceClass = normalizeRaceClassName(state.tournament?.raceClass || "오픈");
      const laneCount = Number(previousSettings.laneCount || 3);
      const matchMode = previousSettings.matchMode || "basic";

      state = makeInitialState(laneCount);
      state.inputText = previousInputText;
      state.settings = {
        ...state.settings,
        ...previousSettings,
        laneCount,
        matchMode,
        firebaseAutoSave: false
      };
      state.tournament = {
        ...state.tournament,
        name: "",
        venue: previousVenue,
        venueId: previousVenueId,
        raceClass: previousRaceClass,
        status: "draft",
        startedAtISO: "",
        startedAtDisplay: "",
        endedAtISO: "",
        endedAtDisplay: "",
        liveStopped: false,
        liveId: "",
        liveSignature: "",
        previousTournamentClosedAt: new Date().toISOString(),
        previousTournamentCloseReason: reason
      };
      state.qualifierRounds = makeQualifierRounds(laneCount, matchMode);
      state.finalRace = null;
      state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
      activeRoundIndex = 0;
      clearActiveTournamentSessionV116();
      persistCurrentState();
    }

    /* v144 항목6: 경기 강제 종료 — 모든 경기 기록 삭제 후 종료(참가자 명단은 유지) */
    function forceEndTournament() {
      ensureStateDefaults();
      if (typeof canModifyTournamentAction === "function" && !canModifyTournamentAction("경기 강제 종료")) return;
      if (!confirm("[1/2] 현재 대회의 모든 경기 기록(대진 · 결과 · 점수)을 삭제하고 강제 종료합니다.\n참가자 명단은 그대로 유지됩니다.\n계속할까요?")) return;
      if (!confirm("[2/2] 이 작업은 되돌릴 수 없습니다.\n정말로 모든 경기 기록을 삭제하고 강제 종료할까요?")) return;
      try { createAutoSnapshot("강제 종료 전 백업"); } catch (error) {}
      const keepName = state.tournament.name || "";
      try { logTournamentAction("경기 강제 종료", keepName); } catch (error) {}
      try { releaseActiveTournamentForVenue("finished-clear"); } catch (error) {}
      prepareNextTournamentDraftV116("force-end");
      state.tournament.name = keepName;
      renderOperator();
      try { forceLiveBroadcastSync("force-end"); } catch (error) {}
      alert("모든 경기 기록을 삭제하고 강제 종료했습니다.\n참가자 명단은 유지되어 바로 다시 시작할 수 있습니다.");
    }
    try { window.forceEndTournament = forceEndTournament; } catch (error) {}

    function prepareNewTournamentFromFinished() {
      ensureStateDefaults();
      if (state.tournament.status === "running") {
        alert("진행 중 대회는 먼저 종료하세요.");
        return;
      }
      if (!confirm("현재 화면을 새 대회 준비 상태로 전환할까요?\n기존 종료 기록은 결과 기록에 유지됩니다.")) return;
      if (state.tournament.status === "finished" || state.tournament.status === "archived") {
        saveTournamentRecord();
        releaseActiveTournamentForVenue("finished-clear");
      }
      prepareNextTournamentDraftV116("manual-new-tournament");
      renderOperator();
    }
function reopenTournament() {
      ensureStateDefaults();
      if (!confirm("종료 상태를 해제하고 다시 진행중으로 변경할까요?")) return;
      state.tournament.status = "running";
      state.settings.firebaseAutoSave = true;
      activateAutoLiveSession();
      state.tournament.endedAtISO = "";
      state.tournament.endedAtDisplay = "";
      renderOperator();
    }
function isTournamentLocked() {
      ensureStateDefaults();
      return state.tournament.status === "running" || state.tournament.status === "finished" || state.tournament.status === "archived";
    }

    function formatDateTimeLocal(date) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const mi = String(date.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }

    function ensureTournamentStarted() {
      ensureStateDefaults();
      if (!state.tournament.startedAtISO) {
        const now = new Date();
        state.tournament.startedAtISO = now.toISOString();
        state.tournament.startedAtDisplay = formatDateTimeLocal(now);
        state.tournament.id = state.tournament.id || `tournament-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
      }
    }



function normalizeMatchMode(mode = state?.settings?.matchMode) {
      const raw = String(mode || "basic");
      // v140: legacy "points" is kept as the existing 3-race Athens style point mode.
      if (raw === "points") return "points3";
      return raw;
    }

    function isPointMode(mode = state?.settings?.matchMode) {
      const normalized = normalizeMatchMode(mode);
      return normalized === "points3" || normalized === "points5Tree";
    }

    function isPointRound(roundIndex) {
      return isPointMode(state.settings.matchMode) && roundIndex === 0;
    }

    function isPointFiveTreeMode(mode = state?.settings?.matchMode) {
      return normalizeMatchMode(mode) === "points5Tree";
    }

    function getPointStageLimit(mode = state?.settings?.matchMode) {
      return isPointFiveTreeMode(mode) ? 5 : 3;
    }

    function getPointFinalLabel(mode = state?.settings?.matchMode) {
      const limit = getPointStageLimit(mode);
      return isPointFiveTreeMode(mode)
        ? `포인트 ${limit}회 누적 · 동점 결정전 · 계단식 트리타기`
        : `포인트 상위 ${state.settings.laneCount}명 결정전`;
    }

    function isPointFinalDecisionStage(stage) {
      if (!stage) return false;
      if (stage.type === "pointFinal") return true;
      if (["points", "pointTieBreak", "pointLadder"].includes(stage.type)) return false;
      if (stage.pointFinalRule || Array.isArray(stage.pointFinalSource)) return true;
      const name = String(stage.name || "");
      return name.includes("포인트") && name.includes("결정전") && !name.includes("동점자 순위");
    }

    function makePointStagePlan(mode = state?.settings?.matchMode) {
      const limit = getPointStageLimit(mode);
      return [
        ...Array.from({ length: limit }, (_, index) => `포인트 ${index + 1}차전`),
        getPointFinalLabel(mode)
      ];
    }

    function isRevivalMode() {
      return state.settings.matchMode === "revival";
    }

    function isAthensPointClass() {
      const raceClass = (state?.tournament?.raceClass || "").trim();
      const athensClasses = ["비맥스", "스톡", "비맥스 클래스", "스톡 클래스", "비맥스클래스", "스톡클래스"];
      return athensClasses.some(c => raceClass.includes(c));
    }

    function getPointOptions(stageName) {
      const match = String(stageName || "").match(/포인트\s*([0-9]+)차전/);
      const num = match ? Number(match[1]) : null;
      // 비맥스/스톡은 기존 요청대로 포인트 3차 5점룰을 쓰지 않는다.
      if (isAthensPointClass()) return [3, 2, 1, 0];
      // 일반 3회 포인트전만 3차 5점룰. 5회 트리타기는 5회 모두 3/2/1/0으로 고정해 룰 충돌을 막는다.
      if (normalizeMatchMode(state.settings.matchMode) === "points3" && num === 3) return [5, 2, 1, 0];
      return [3, 2, 1, 0];
    }

    function generatePointStage(players, qualifierIndex, stageIndex, stageName) {
      const stage = generateStage(players, qualifierIndex, stageIndex, stageName);
      return {
        ...stage,
        type: "points",
        pointOptions: getPointOptions(stageName),
        groups: stage.groups.map(group => ({ ...group, points: {} }))
      };
    }

    function getPointPlayers(round) {
      const playerMap = new Map();
      (round.stages || []).filter(stage => stage.type === "points").forEach(stage => {
        stage.groups.forEach(group => {
          group.slots.forEach(player => {
            if (player.isEmptyLane || isPlayerWithdrawn(player.id)) return;
            if (!playerMap.has(player.id)) playerMap.set(player.id, { id: player.id, name: player.name, team: player.team });
          });
        });
      });
      return Array.from(playerMap.values());
    }

    function computePointTotals(round) {
      const totals = new Map();
      (round.stages || []).filter(stage => stage.type === "points").forEach(stage => {
        stage.groups.forEach(group => {
          group.slots.forEach(player => {
            if (player.isEmptyLane || isPlayerWithdrawn(player.id)) return;
            const current = totals.get(player.id) || { id: player.id, name: player.name, team: player.team, total: 0, heats: [] };
            const score = Number((group.points || {})[player.id] ?? 0);
            current.total += score;
            current.heats.push({ stage: stage.name, score });
            totals.set(player.id, current);
          });
        });
      });
      return Array.from(totals.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
    }

    function setPointScore(roundIndex, stageIndex, groupId, playerId, score) {
      if (!canModifyTournamentAction("점수 변경")) return;
      const stage = state.qualifierRounds[roundIndex]?.stages?.[stageIndex];
      if (!stage || stage.type !== "points") return;
      const group = stage.groups.find(item => item.id === groupId);
      if (!group) return;
      const player = group.slots.find(item => item.id === playerId);
      if (!player || player.isEmptyLane) return;
      captureOperatorUndoSnapshotV266("점수 선택");
      group.points = group.points || {};
      group.points[playerId] = Number(score);
      state.broadcast = { mode: "stage", roundIndex, stageIndex };
      activeRoundIndex = roundIndex;
      logTournamentAction("진출자 변경", player.name || player.id);
      logTournamentAction("점수 변경", `${player.name || player.id}: ${score}P`);
      renderOperator();
    }

    function selectPointFinalistsByCutoff(totals, limit, ascending = false) {
      const sorted = totals.slice().sort((a, b) => {
        const score = ascending ? a.total - b.total : b.total - a.total;
        return score || a.name.localeCompare(b.name, "ko");
      });
      if (!sorted.length) return [];
      const cutoffIndex = Math.min(limit, sorted.length) - 1;
      const cutoffScore = sorted[cutoffIndex]?.total;
      return sorted.filter(player => ascending ? player.total <= cutoffScore : player.total >= cutoffScore);
    }

    function getPointTreeRanking(totals) {
      return totals.slice().sort((a, b) => a.total - b.total || a.name.localeCompare(b.name, "ko"));
    }

    function getPointTreeTieGroups(ranking) {
      const groups = [];
      ranking.forEach(player => {
        const current = groups[groups.length - 1];
        if (current && current[0].total === player.total) current.push(player);
        else groups.push([player]);
      });
      return groups.filter(group => group.length > 1);
    }

    function makePointTreeTieBreakStage(ranking, round) {
      const tieGroups = getPointTreeTieGroups(ranking);
      return {
        id: `q${round.index}-s${round.stages.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
        qualifierIndex: round.index,
        stageIndex: round.stages.length + 1,
        name: "동점자 순위 결정전",
        type: "pointTieBreak",
        pointTreeRanking: ranking.map(player => ({ id: player.id, name: player.name, team: player.team, total: player.total })),
        groups: tieGroups.map((players, index) => ({
          id: `point-tie-${round.index}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${players[0].total}P 동점`,
          slots: players.map((player, playerIndex) => ({
            id: player.id,
            name: player.name,
            team: player.team,
            lane: playerIndex + 1
          })),
          advanceIds: [],
          tiedScore: players[0].total
        })),
        meta: { attempts: 1, score: 0, sameTeam: 0, groupSize: state.settings.laneCount }
      };
    }

    function resolvePointTreeTieBreak(stage) {
      const ranking = (stage.pointTreeRanking || []).map(player => ({ ...player }));
      for (const group of stage.groups || []) {
        const players = (group.slots || []).filter(player => !player.isEmptyLane);
        const orderedIds = group.advanceIds || [];
        if (orderedIds.length !== players.length || new Set(orderedIds).size !== players.length) {
          showError(`${group.name} 참가자를 낮은 순위부터 모두 선택하세요.`);
          return null;
        }
        const order = new Map(orderedIds.map((id, index) => [String(id), index]));
        const tiedIndexes = ranking
          .map((player, index) => Number(player.total) === Number(group.tiedScore) ? index : -1)
          .filter(index => index >= 0);
        const orderedPlayers = players
          .slice()
          .sort((a, b) => order.get(String(a.id)) - order.get(String(b.id)))
          .map(player => ranking.find(item => String(item.id) === String(player.id)) || player);
        tiedIndexes.forEach((rankingIndex, index) => { ranking[rankingIndex] = orderedPlayers[index]; });
      }
      return ranking;
    }

    function makePointTreeLadderStage(round, ranking, stepIndex, survivor = null) {
      const firstHeat = stepIndex === 1;
      const players = firstHeat
        ? [ranking[0], ranking[1]]
        : [survivor, ranking[stepIndex]];
      const isFinal = stepIndex >= ranking.length - 1;
      const stage = generateStage(
        players.map(player => ({ id: player.id, name: player.name, team: player.team })),
        round.index,
        round.stages.length + 1,
        isFinal ? "트리타기 최종전" : `트리타기 ${stepIndex}단계`
      );
      stage.type = isFinal ? "pointFinal" : "pointLadder";
      stage.pointFinalRule = "low-score-tree";
      stage.pointTreeRanking = ranking.map(player => ({ id: player.id, name: player.name, team: player.team, total: player.total }));
      stage.pointTreeStep = stepIndex;
      return stage;
    }

    function createPointNextStage(roundIndex) {
      const round = state.qualifierRounds[roundIndex];
      const lastStage = round?.stages?.[round.stages.length - 1];
      if (!round || !lastStage) return showError("먼저 포인트전을 시작하세요.");
      if (isPointFinalDecisionStage(lastStage)) return goToNextRoundAfterFinalist(roundIndex);
      if (!["points", "pointTieBreak", "pointLadder"].includes(lastStage.type)) return showError("포인트전 단계가 아닙니다.");

      const pointStageCount = round.stages.filter(stage => stage.type === "points").length;
      const pointLimit = getPointStageLimit(state.settings.matchMode);
      const allPlayers = getPointPlayers(round);
      let generatedStageName = "";

      if (lastStage.type === "pointTieBreak") {
        const ranking = resolvePointTreeTieBreak(lastStage);
        if (!ranking) return;
        const ladderStage = makePointTreeLadderStage(round, ranking, 1);
        generatedStageName = ladderStage.name;
        captureOperatorUndoSnapshotV266("다음 경기 진행");
        round.stages.push(ladderStage);
      } else if (lastStage.type === "pointLadder") {
        const selected = getSelectedFromStage(lastStage);
        if (selected.length !== 1) return showError("현재 트리타기 경기의 승자 1명을 선택하세요.");
        const ranking = lastStage.pointTreeRanking || [];
        const nextStep = Number(lastStage.pointTreeStep || 1) + 1;
        const ladderStage = makePointTreeLadderStage(round, ranking, nextStep, selected[0]);
        generatedStageName = ladderStage.name;
        captureOperatorUndoSnapshotV266("다음 경기 진행");
        round.stages.push(ladderStage);
      } else if (pointStageCount < pointLimit) {
        const nextIndex = pointStageCount + 1;
        generatedStageName = `포인트 ${nextIndex}차전`;
        captureOperatorUndoSnapshotV266("다음 경기 진행");
        round.stages.push(generatePointStage(allPlayers, round.index, round.stages.length + 1, generatedStageName));
      } else {
        const totals = computePointTotals(round);
        if (!totals.length) return showError("결정전을 만들 참가자가 부족합니다.");
        const lowScoreTree = isPointFiveTreeMode(state.settings.matchMode);
        if (lowScoreTree) {
          const ranking = getPointTreeRanking(totals);
          if (ranking.length < 2) return showError("트리타기를 진행할 참가자가 부족합니다.");
          const tieGroups = getPointTreeTieGroups(ranking);
          const nextStage = tieGroups.length
            ? makePointTreeTieBreakStage(ranking, round)
            : makePointTreeLadderStage(round, ranking, 1);
          generatedStageName = nextStage.name;
          captureOperatorUndoSnapshotV266("다음 경기 진행");
          round.stages.push(nextStage);
        } else {
          const finalists = selectPointFinalistsByCutoff(totals, state.settings.laneCount, false);
          if (finalists.length < 2) return showError("결정전을 만들 참가자가 부족합니다.");
          generatedStageName = getPointFinalLabel(state.settings.matchMode);
          const finalStage = generateStage(finalists.map(p => ({ id: p.id, name: p.name, team: p.team })), round.index, round.stages.length + 1, generatedStageName);
          finalStage.type = "pointFinal";
          finalStage.pointFinalRule = "top-score";
          finalStage.pointFinalSource = totals.map(item => ({ id: item.id, name: item.name, team: item.team, total: item.total }));
          captureOperatorUndoSnapshotV266("다음 경기 진행");
          round.stages.push(finalStage);
        }
      }

      state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
      activeRoundIndex = roundIndex;
      logTournamentAction("다음 경기 생성", generatedStageName);
      renderOperator();
      syncOperatorLiveStateV269("createPointNextStage");
      requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    function getActualPlayersFromStage(stage) {
      const players = [];
      stage.groups.forEach(group => group.slots.forEach(player => {
        if (!player.isEmptyLane) players.push({ id: player.id, name: player.name, team: player.team });
      }));
      return players;
    }

    function getLosersFromStage(stage) {
      const selected = new Set(getSelectedFromStage(stage).map(player => player.id));
      return getActualPlayersFromStage(stage).filter(player => !selected.has(player.id));
    }

    function createRevivalStage(roundIndex) {
      const round = state.qualifierRounds[roundIndex];
      if (!round || !round.stages.length) return showError("패자부활전을 만들 기준 단계가 없습니다.");

      const baseStageIndex = round.stages.length - 1;
      const baseStage = round.stages[baseStageIndex];

      if (baseStage.type === "points" || baseStage.type === "pointFinal") {
        return showError("포인트전 단계에서는 패자부활전을 생성하지 않습니다.");
      }
      if (baseStage.type === "revival") {
        return showError("패자부활전 안에서 다시 패자부활전을 만들 수 없습니다.");
      }

      const winners = getSelectedFromStage(baseStage);
      if (!winners.length) return showError("현재 단계에서 먼저 진출자를 선택하세요.");

      const losers = getLosersFromStage(baseStage);
      if (losers.length < 2) return showError("패자부활전을 만들 탈락자가 부족합니다.");

      const revivalStage = generateStage(losers, round.index, round.stages.length + 1, `패자부활전`);
      revivalStage.type = "revival";
      revivalStage.revivalBaseStageIndex = baseStageIndex;
      revivalStage.revivalBaseStageName = baseStage.name;
      captureOperatorUndoSnapshotV266("다음 경기 진행");
      round.stages.push(revivalStage);

      state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
      activeRoundIndex = roundIndex;
      renderOperator();
      requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    function createRevivalNextStage(roundIndex) {
      const round = state.qualifierRounds[roundIndex];
      const lastStage = round.stages[round.stages.length - 1];

      if (lastStage.type === "revival") {
        const baseStage = round.stages[lastStage.revivalBaseStageIndex];
        const baseWinners = baseStage ? getSelectedFromStage(baseStage) : [];
        const revivalWinners = getSelectedFromStage(lastStage);
        const merged = [...baseWinners, ...revivalWinners];
        const unique = Array.from(new Map(merged.map(player => [player.id, player])).values());

        if (unique.length < 2) return showError("합류 후 다음 단계를 만들 참가자가 부족합니다.");
        const nextName = getNextStageName(round, unique.length);
        const nextStage = generateStage(unique, round.index, round.stages.length + 1, nextName);
        nextStage.type = "merged";
        nextStage.mergedFromRevival = true;
        captureOperatorUndoSnapshotV266("다음 경기 진행");
        round.stages.push(nextStage);
      } else {
        const selected = getSelectedFromStage(lastStage);
        if (selected.length === 0) return showError("다음 단계로 보낼 진출자가 없습니다.");
        if (selected.length === 1) return showError("다음 단계 생성은 진출자 2명 이상부터 가능합니다.");
        const nextName = getNextStageName(round, selected.length);
        captureOperatorUndoSnapshotV266("다음 경기 진행");
        round.stages.push(generateStage(selected, round.index, round.stages.length + 1, nextName));
      }

      state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
      activeRoundIndex = roundIndex;
      renderOperator();
      requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    function startQualifierRound(roundIndex) {
      ensureStateDefaults();
      if (!validateTournamentMetaRequired()) return;
      ensureTournamentStarted();

      const round = state.qualifierRounds[roundIndex];
      const players = getEligibleParticipants();
      const error = validateStart(players, "예선");
      if (error) return showError(error);

      captureOperatorUndoSnapshotV266("라운드 시작");
      if (isPointRound(roundIndex)) {
        round.stagePlan = makePointStagePlan(state.settings.matchMode);
        round.stages = [];
        round.finalist = null;
        round.stages = [generatePointStage(players, round.index, 1, "포인트 1차전")];
      } else if (isRevivalMode()) {
        const plan = makeStagePlan(players.length, state.settings.laneCount).map(name => name === "라운드 결승" ? "결승" : name);
        round.stagePlan = [...plan, "패자부활 삽입 가능"];
        round.stages = [];
        round.finalist = null;
        round.stages = [generateStage(players, round.index, 1, plan[0])];
      } else {
        const plan = makeStagePlan(players.length, state.settings.laneCount);
        round.stagePlan = plan;
        round.stages = [];
        round.finalist = null;
        round.stages = [generateStage(players, round.index, 1, plan[0])];
      }

      state.finalRace = null;
      state.broadcast = { mode: "stage", roundIndex, stageIndex: 0 };
      activeRoundIndex = roundIndex;
      renderOperator();
    }

    function resetQualifierRound(roundIndex) {
      const round = state.qualifierRounds[roundIndex];
      captureOperatorUndoSnapshotV266("라운드 초기화");
      round.stagePlan = [];
      round.stages = [];
      round.finalist = null;
      state.finalRace = null;

      if (state.broadcast.roundIndex === roundIndex) {
        state.broadcast = { mode: "stage", roundIndex, stageIndex: 0 };
      }

      renderOperator();
    }

    function getSelectedFromStage(stage) {
      const selected = [];
      stage.groups.forEach(group => {
        (group.advanceIds || []).forEach(id => {
          const player = group.slots.find(slot => slot.id === id);
          if (player && !player.isEmptyLane) selected.push({ id: player.id, name: player.name, team: player.team });
        });
      });
      return selected;
    }

    function getNextStageName(round, nextPlayersCount) {
      if (nextPlayersCount <= state.settings.laneCount) return isRevivalMode() ? "결승" : "라운드 결승";

      const nextIndex = round.stages.length;
      const planned = round.stagePlan[nextIndex];
      if (planned && planned !== "라운드 결승") return planned;

      const dynamicPlan = makeStagePlan(nextPlayersCount, state.settings.laneCount);
      return dynamicPlan[0] === "라운드 결승" ? "준결승" : dynamicPlan[0];
    }

    function createNextStage(roundIndex) {
      ensureStateDefaults();
      if (!canModifyTournamentAction("다음 경기 생성")) return;
      const round = state.qualifierRounds[roundIndex];
      if (!round || !round.stages.length) return showError("먼저 해당 라운드를 시작하세요.");

      if (isPointRound(roundIndex)) return createPointNextStage(roundIndex);
      if (isRevivalMode()) return createRevivalNextStage(roundIndex);

      const lastStage = round.stages[round.stages.length - 1];
      if (lastStage.name === "라운드 결승") return showError("라운드 결승에서는 다음 단계 생성 대신 결승 진출자를 확정하세요.");

      const selected = getSelectedFromStage(lastStage);
      if (selected.length === 0) return showError("다음 단계로 보낼 진출자가 없습니다.");
      if (selected.length === 1) return showError("다음 단계 생성은 진출자 2명 이상부터 가능합니다.");

      const nextName = getNextStageName(round, selected.length);
      captureOperatorUndoSnapshotV266("다음 경기 진행");
      round.stages.push(generateStage(selected, round.index, round.stages.length + 1, nextName));
      state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
      activeRoundIndex = roundIndex;
      renderOperator();
      syncOperatorLiveStateV269("createPointNextStage");
      requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
function setBroadcastStage(roundIndex, stageIndex) {
      state.broadcast = { mode: "stage", roundIndex, stageIndex };
      activeRoundIndex = roundIndex;
      renderOperator();
      syncOperatorLiveStateV269("setBroadcastStage");
    }

    function toggleAdvance(roundIndex, stageIndex, groupId, playerId) {
      if (!canModifyTournamentAction("진출자 변경")) return;
      const stage = state.qualifierRounds[roundIndex]?.stages[stageIndex];
      if (!stage) return;
      const group = stage.groups.find(item => item.id === groupId);
      if (!group) return;

      const player = group.slots.find(item => item.id === playerId);
      if (!player || player.isEmptyLane) return;

      group.advanceIds = group.advanceIds || [];
      const wasSelected = group.advanceIds.includes(playerId);
      captureOperatorUndoSnapshotV266(wasSelected ? "진출 선택 해제" : "진출 선택");
      if (wasSelected) {
        group.advanceIds = group.advanceIds.filter(id => id !== playerId);
      } else {
        group.advanceIds.push(playerId);
      }

      state.broadcast = { mode: "stage", roundIndex, stageIndex };
      activeRoundIndex = roundIndex;
      logTournamentAction("진출자 변경", `${stage.name || "현재 단계"} / ${group.name || "조"} / ${player.name || player.id}: ${wasSelected ? "해제" : "선택"}`);
      saveLiveState();
      renderOperator();
    }

    function setLaneCount(laneCount) {
      ensureStateDefaults();
      if (isTournamentLocked() && !confirm("대회가 시작/종료된 상태입니다. 레인 수를 바꾸면 기록이 꼬일 수 있습니다. 계속할까요?")) return;
      if (state.qualifierRounds.some(round => round.stages.length) || state.finalRace) {
        if (!confirm("경기 타입을 바꾸면 현재 대진표가 라운드 초기화됩니다. 계속할까요?")) return;
      }

      const inputText = state.inputText;
      const previousSettings = { ...state.settings };
      const previousTournament = { ...state.tournament };

      state = makeInitialState(laneCount);
      state.inputText = inputText;
      state.settings = { ...state.settings, ...previousSettings, laneCount, nextGroupSize: "" };
      state.tournament = previousTournament;
      state.qualifierRounds = makeQualifierRounds(laneCount, state.settings.matchMode);
      state.finalRace = null;
      activeRoundIndex = 0;
      renderOperator();
    }

    function setSetting(key, value) {
      state.settings[key] = value;
      renderOperator();
    }

    function showError(message) {
      const el = document.getElementById("error");
      if (!el) return;
      el.style.display = message ? "block" : "none";
      el.textContent = message;
    }

    function decodePayload(text) {
      return JSON.parse(decodeURIComponent(escape(atob(text))));
    }

    function getHashParams() {
      const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
      return new URLSearchParams(raw);
    }


    function localDateKey(date = new Date()) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}${m}${d}`;
    }

    function liveSessionDateKey() {
      ensureStateDefaults();
      const started = state.tournament?.startedAtISO || state.tournament?.startedAtDisplay || "";
      const parsed = started ? new Date(started) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) return localDateKey(parsed);
      const stored = localStorage.getItem("mini4wdActiveLiveDate");
      if (stored) return stored;
      const today = localDateKey(new Date());
      safeSetItem("mini4wdActiveLiveDate", today);
      return today;
    }

    function buildAutoTournamentId() {
      ensureStateDefaults();
      const venue = state.tournament?.venue || (typeof currentVenueName === "function" ? currentVenueName() : "venue") || "venue";
      const name = state.tournament?.name || "tournament";
      const date = liveSessionDateKey();
      return normalizeKey(`${venue}-${name}-${date}`) || DEFAULT_TOURNAMENT_ID;
    }

    function activateAutoLiveSession(forceNew = false) {
      ensureStateDefaults();
      const canonicalId = buildAutoTournamentId();
      const signature = canonicalId;
      const previousSignature = localStorage.getItem("mini4wdActiveLiveSignature") || "";
      const previousId = localStorage.getItem("mini4wdActiveLiveId") || "";
      const shouldReuse = !forceNew && state.tournament.status === "running" && previousSignature === signature && previousId;
      const id = shouldReuse ? previousId : canonicalId;
      state.tournament.liveId = id;
      state.tournament.liveSignature = signature;
      firebaseTournamentId = id;
      safeSetItem("mini4wdTournamentId", id);
      safeSetItem("mini4wdActiveLiveId", id);
      safeSetItem("mini4wdActiveLiveSignature", signature);
      safeSetItem("mini4wdActiveLiveDate", liveSessionDateKey());
      return id;
    }

    function exportState() {
      const tournament = {
        ...state.tournament,
        venueId: typeof currentVenueId === "function" ? currentVenueId() : (state.tournament?.venueId || ""),
        venue: state.tournament?.venue || (typeof currentVenueName === "function" ? currentVenueName() : ""),
        raceClass: typeof normalizeRaceClassName === "function" ? normalizeRaceClassName(state.tournament?.raceClass || "오픈") : (state.tournament?.raceClass || "오픈")
      };
      return {
        settings: state.settings,
        tournament,
        activeRoundIndex,
        broadcast: state.broadcast,
        qualifierRounds: state.qualifierRounds,
        finalRace: state.finalRace,
        updatedAt: state.updatedAt || Date.now()
      };
    }    function makePublicLivePayload(sourceState = exportState()) {
      const publicState = makePublicStatePayload(sourceState);
      const id = getCurrentTournamentId();
      const isRunning = publicState.tournament.status === "running";
      return {
        id,
        liveSignature: buildAutoTournamentId(),
        venueId: publicState.tournament.venueId || currentVenueId(),
        venueName: publicState.tournament.venue || currentVenueName(),
        tournamentName: publicState.tournament.name || "대회명 미입력",
        raceClass: publicState.tournament.raceClass || "오픈",
        status: publicState.tournament.status || "draft",
        live: isRunning,
        liveKeyLabel: `${publicState.tournament.venue || currentVenueName()} · ${publicState.tournament.name || "대회명 미입력"} · ${liveSessionDateKey()}`,
        updatedAt: publicState.updatedAt || Date.now(),
        state: publicState
      };
    }

    function liveFreshTimestampV272(payload) {
      const value = payload?.state?.updatedAt ?? payload?.updatedAt ?? 0;
      return Number(value || 0) || 0;
    }

    function liveFreshStatusV272(payload) {
      const body = payload?.state || payload || {};
      return String(body?.tournament?.status || payload?.status || "");
    }

    function liveProgressRankV272(payload) {
      const body = payload?.state || payload || {};
      const broadcast = body.broadcast || {};
      const active = Number(body.activeRoundIndex ?? broadcast.roundIndex ?? 0) || 0;
      const round = Number(broadcast.roundIndex ?? active) || 0;
      const stage = Number(broadcast.stageIndex ?? 0) || 0;
      const finalistCount = Array.isArray(body.qualifierRounds) ? body.qualifierRounds.filter(item => item && item.finalist).length : 0;
      const finalRank = body.finalRace ? 1000000 : 0;
      return finalRank + (active * 10000) + (round * 1000) + (stage * 10) + finalistCount;
    }

    function isLiveRegressionAllowedV272(reason = "") {
      return /undo|restore|recover|recovery|load-active|manual-takeover/i.test(String(reason || ""));
    }

    function shouldAcceptFreshLiveValueV272(currentValue, nextValue, reason = "manual") {
      if (nextValue === null) return true;
      if (!currentValue || isLiveRegressionAllowedV272(reason)) return true;
      const currentStatus = liveFreshStatusV272(currentValue);
      const nextStatus = liveFreshStatusV272(nextValue);
      if (currentStatus === "finished" && nextStatus === "running") return false;
      const currentAt = liveFreshTimestampV272(currentValue);
      const nextAt = liveFreshTimestampV272(nextValue);
      if (currentAt && nextAt && nextAt < currentAt) return false;
      if (currentAt && nextAt && nextAt === currentAt && liveProgressRankV272(nextValue) < liveProgressRankV272(currentValue)) return false;
      return true;
    }

    function writeFreshLiveValueV272(db, path, nextValue, reason = "manual") {
      const ref = db?.ref ? db.ref(path) : null;
      if (!ref) return Promise.resolve(false);
      if (typeof ref.transaction !== "function") {
        return ref.set(nextValue).then(() => true);
      }
      return ref.transaction(currentValue => {
        return shouldAcceptFreshLiveValueV272(currentValue, nextValue, reason) ? nextValue : currentValue;
      }).then(result => {
        if (!result || result.committed === false) return false;
        return true;
      }).catch(error => {
        console.warn("v272 fresh live write failed", path, error);
        return false;
      });
    }

    function scheduleSettledLiveSyncV272(reason = "settled-live-sync-v272") {
      [160, 720, 1600].forEach(delay => {
        setTimeout(() => {
          try { syncOperatorLiveStateV269(`${reason}-settle-v272-${delay}`); }
          catch (error) { console.warn("v272 settled live sync failed", error); }
        }, delay);
      });
    }
    function startAllFirstStages() {
      ensureStateDefaults();
      if (!validateTournamentMetaRequired()) return;
      ensureTournamentStarted();
      if (state.tournament.status !== "running") {
        state.tournament.status = "running";
        state.settings.firebaseAutoSave = true;
        activateAutoLiveSession(true);
        state.tournament.lockedParticipants = state.inputText;
        state.tournament.lockedSettings = {
          matchMode: state.settings.matchMode,
          laneCount: state.settings.laneCount
        };
        createAutoSnapshot("대회 시작");
        logTournamentAction("대회 시작", state.tournament.name || "");
      }

      const players = getEligibleParticipants();
      const error = validateStart(players, "예선");
      if (error) return showError(error);

      state.qualifierRounds.forEach(round => {
        round.stagePlan = [];
        round.stages = [];
        round.finalist = null;
      });
      state.finalRace = null;

      state.qualifierRounds.forEach((round, index) => {
        const roundPlayers = state.settings.excludeFinalists ? getEligibleParticipants() : parseParticipants();

        if (isPointRound(index)) {
          round.stagePlan = makePointStagePlan(state.settings.matchMode);
          round.stages = [generatePointStage(roundPlayers, round.index, 1, "포인트 1차전")];
        } else if (isRevivalMode()) {
          const plan = makeStagePlan(roundPlayers.length, state.settings.laneCount).map(name => name === "라운드 결승" ? "결승" : name);
          round.stagePlan = [...plan, "패자부활 삽입 가능"];
          round.stages = [generateStage(roundPlayers, round.index, 1, plan[0])];
        } else {
          const plan = makeStagePlan(roundPlayers.length, state.settings.laneCount);
          round.stagePlan = plan;
          round.stages = [generateStage(roundPlayers, round.index, 1, plan[0])];
        }
      });

      state.broadcast = { mode: "stage", roundIndex: 0, stageIndex: 0 };
      activeRoundIndex = 0;
      renderOperator();
    }

    function firebaseStatusSummaryV231() {
      const text = String(firebaseStatusText() || "");
      if (text.startsWith("오류")) return "오류";
      if (text.startsWith("연결됨")) return "연결됨";
      return "대기";
    }




    function getWithdrawnPlayerIdSet() {
      ensureStateDefaults();
      return new Set((state.tournament.withdrawnPlayerIds || []).map(String));
    }

    function isPlayerWithdrawn(playerId) {
      return getWithdrawnPlayerIdSet().has(String(playerId || ""));
    }

    function setWithdrawnPlayer(playerId, withdrawn = true) {
      ensureStateDefaults();
      const id = String(playerId || "");
      if (!id) return;
      const ids = getWithdrawnPlayerIdSet();
      if (withdrawn) ids.add(id);
      else ids.delete(id);
      state.tournament.withdrawnPlayerIds = Array.from(ids);
    }

    function makeEmptyLaneSlot(lane) {
      return {
        id: `empty-lane-${lane}-${Math.random().toString(36).slice(2, 8)}`,
        name: "빈 레인",
        team: "",
        lane,
        isEmptyLane: true
      };
    }

    function normalizeEmergencyParticipant(name, team = "") {
      const cleanName = String(name || "").trim();
      const cleanTeam = String(team || "").trim();
      if (!cleanName) return null;
      const roster = findRosterMatch(cleanName, cleanTeam);
      if (roster) {
        return { id: roster.id, name: cleanName, team: cleanTeam || roster.team || "", realName: roster.realName || "", contact: roster.contact || "", contactStatus: roster.contactStatus || contactStatusOf(roster), venueId: roster.venueId || currentVenueId(), venueName: roster.venueName || currentVenueName() };
      }
      return { id: `late-${Date.now()}-${slugId(cleanName)}`, name: cleanName, team: cleanTeam, realName: "", contact: "", contactStatus: "missing", venueId: currentVenueId(), venueName: currentVenueName() };
    }

    function getAllStagePlayers() {
      const map = new Map();
      const add = player => {
        if (!player || player.isEmptyLane || !player.id) return;
        map.set(String(player.id), { id: String(player.id), name: player.name || player.nickname || player.id, team: player.team || "" });
      };
      parseParticipants().forEach(add);
      (state.qualifierRounds || []).forEach(round => (round.stages || []).forEach(stage => (stage.groups || []).forEach(group => (group.slots || []).forEach(add))));
      if (state.finalRace?.group?.slots) state.finalRace.group.slots.forEach(add);
      if (Array.isArray(state.finalRace?.groups)) state.finalRace.groups.forEach(group => (group.slots || []).forEach(add));
      return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    }

    function getEmergencyTargetStage() {
      ensureStateDefaults();
      const b = state.broadcast || {};
      if (b.mode === "stage" && state.qualifierRounds?.[b.roundIndex]?.stages?.[b.stageIndex]) {
        return { roundIndex: b.roundIndex, stageIndex: b.stageIndex, stage: state.qualifierRounds[b.roundIndex].stages[b.stageIndex] };
      }
      const round = state.qualifierRounds?.[activeRoundIndex];
      if (round?.stages?.length) {
        return { roundIndex: activeRoundIndex, stageIndex: round.stages.length - 1, stage: round.stages[round.stages.length - 1] };
      }
      return null;
    }

    function groupHasResult(group, stage) {
      if (!group) return false;
      if ((group.advanceIds || []).length > 0) return true;
      if ((stage?.type === "points" || stage?.type === "pointFinal") && Object.keys(group.points || {}).length > 0) return true;
      return false;
    }

    function addPlayerToStage(stage, player) {
      const laneCount = state.settings.laneCount || 3;
      for (const group of (stage.groups || [])) {
        if (groupHasResult(group, stage)) continue;
        const empty = (group.slots || []).find(slot => slot.isEmptyLane);
        if (empty) {
          const lane = empty.lane || ((group.slots || []).length + 1);
          Object.assign(empty, { ...player, lane, isEmptyLane: false });
          return true;
        }
      }
      const groupIndex = (stage.groups || []).length + 1;
      const slots = Array.from({ length: laneCount }, (_, index) => index === 0 ? { ...player, lane: 1 } : makeEmptyLaneSlot(index + 1));
      const newGroup = { id: `${stage.id || "stage"}-late-g${groupIndex}-${Math.random().toString(36).slice(2, 8)}`, name: `${groupIndex}조`, slots, advanceIds: [] };
      if (stage.type === "points" || stage.type === "pointFinal") newGroup.points = {};
      stage.groups = stage.groups || [];
      stage.groups.push(newGroup);
      return true;
    }

    function emergencyAddParticipant() {
      if (!canModifyTournamentAction("진행 중 참가자 추가")) return;
      const name = document.getElementById("emergencyAddName")?.value.trim();
      const team = document.getElementById("emergencyAddTeam")?.value.trim();
      const player = normalizeEmergencyParticipant(name, team);
      if (!player) return showError("추가할 선수명을 입력하세요.");
      const existing = getAllStagePlayers().find(item => String(item.id) === String(player.id) || (item.name === player.name && item.team === player.team));
      if (existing && !isPlayerWithdrawn(existing.id)) return showError("이미 대회 명단 또는 현재 경기 안에 있는 선수입니다.");
      const line = `${player.name}${player.team ? "/" + player.team : ""}`;
      const lines = String(state.inputText || "").split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      if (!lines.some(v => v === line || v.split(/[\/\t,]/)[0] === player.name)) state.inputText = [...lines, line].join("\n");
      setWithdrawnPlayer(player.id, false);
      const target = getEmergencyTargetStage();
      if (state.tournament.status === "running" && target?.stage) {
        addPlayerToStage(target.stage, player);
        state.broadcast = { mode: "stage", roundIndex: target.roundIndex, stageIndex: target.stageIndex };
        activeRoundIndex = target.roundIndex;
      }
      createAutoSnapshot("진행 중 선수 추가");
      logTournamentAction("선수 추가", `${player.name}${player.team ? " / " + player.team : ""}`);
      renderOperator();
    }

    function emergencyWithdrawParticipant() {
      if (!canModifyTournamentAction("진행 중 선수 제외")) return;
      const playerId = document.getElementById("emergencyWithdrawPlayer")?.value;
      if (!playerId) return showError("제외할 선수를 선택하세요.");
      const player = getAllStagePlayers().find(item => String(item.id) === String(playerId));
      if (!player) return showError("선수를 찾을 수 없습니다.");
      if (!confirm(`${player.name} 선수를 현재 이후 경기에서 제외할까요?\n이미 확정된 과거 결과는 유지됩니다.`)) return;
      setWithdrawnPlayer(playerId, true);
      let changed = 0;
      (state.qualifierRounds || []).forEach((round, roundIndex) => {
        (round.stages || []).forEach((stage, stageIndex) => {
          const isBeforeBroadcast = state.broadcast?.mode === "stage" && (roundIndex < state.broadcast.roundIndex || (roundIndex === state.broadcast.roundIndex && stageIndex < state.broadcast.stageIndex));
          if (isBeforeBroadcast) return;
          (stage.groups || []).forEach(group => {
            if (groupHasResult(group, stage)) return;
            (group.slots || []).forEach((slot, slotIndex) => {
              if (String(slot.id) === String(playerId)) {
                group.slots[slotIndex] = makeEmptyLaneSlot(slot.lane || slotIndex + 1);
                changed += 1;
              }
            });
          });
        });
      });
      const finalGroups = state.finalRace?.groups || (state.finalRace?.group ? [state.finalRace.group] : []);
      finalGroups.forEach(group => {
        if (groupHasResult(group, { type: state.finalRace?.type || "final" })) return;
        (group.slots || []).forEach((slot, slotIndex) => {
          if (String(slot.id) === String(playerId)) {
            group.slots[slotIndex] = makeEmptyLaneSlot(slot.lane || slotIndex + 1);
            changed += 1;
          }
        });
      });
      createAutoSnapshot("진행 중 선수 제외");
      logTournamentAction("선수 제외", `${player.name} · 변경 슬롯 ${changed}`);
      renderOperator();
    }

    function renderEmergencyAdjustPanel() {
      const isRunning = state.tournament?.status === "running";
      const players = getAllStagePlayers();
      const withdrawn = getWithdrawnPlayerIdSet();
      const options = players.map(player => `<option value="${escapeAttr(player.id)}">${escapeHtml(player.name)}${player.team ? " / " + escapeHtml(player.team) : ""}${withdrawn.has(String(player.id)) ? " · 제외됨" : ""}</option>`).join("");
      return `<section class="card emergency-adjust-card-v99"><h2>참가자 조정</h2><div class="emergency-adjust-grid-v99"><div><label>추가 선수명</label><input class="mini-input" id="emergencyAddName" placeholder="현장 추가 선수" /></div><div><label for="emergencyAddTeam">팀명</label><input class="mini-input" id="emergencyAddTeam" placeholder="선택" /></div></div><button class="primary" style="width:100%; margin-top:8px;" onclick="emergencyAddParticipant()">경기 명단에 추가</button><div style="margin-top:12px;"><label>제외 선수</label><select class="mini-input" id="emergencyWithdrawPlayer"><option value="">선수 선택</option>${options}</select></div><button class="danger" style="width:100%; margin-top:8px;" onclick="emergencyWithdrawParticipant()">이후 경기에서 제외</button>${withdrawn.size ? `<p class="hint" style="margin-top:8px;">제외 처리: ${Array.from(withdrawn).length}명</p>` : ""}</section>`;
    }

    function setUiSurfaceV149(surface) {
      MINI4WD_SURFACE_CLASSES.forEach(className => document.body.classList.remove(className));
      if (surface) document.body.classList.add(`surface-${surface}`);
      document.documentElement.setAttribute("data-ui-surface", surface || "");
    }

    let __operatorRenderLiveSyncTimerV269 = null;
    let __operatorRenderLiveSyncLastAtV269 = 0;

    function scheduleOperatorRenderLiveSyncV269(reason = "operator-render-v269") {
      try {
        ensureStateDefaults();
        if (state.tournament.status !== "running") return;
        const now = Date.now();
        if (now - __operatorRenderLiveSyncLastAtV269 < 4000) return;
        __operatorRenderLiveSyncLastAtV269 = now;
        clearTimeout(__operatorRenderLiveSyncTimerV269);
        __operatorRenderLiveSyncTimerV269 = setTimeout(() => {
          try { syncOperatorLiveStateV269(reason); } catch (error) { console.warn("v269 render live sync failed", error); }
        }, 700);
      } catch (error) {}
    }

    function renderOperator() {
      setUiSurfaceV149("operator");
      ensureStateDefaults();
      document.body.classList.remove("tv-mode");
      document.body.classList.remove("live-lobby-page-v88");
      document.body.classList.remove("live-lobby-page-v89");
      document.body.classList.add("operator-light-page-v95");
      resetMetricCacheV122();
      saveOperatorRenderStateV122("renderOperator");

      const players = parseParticipants();
      const estimatedGroups = players.length ? Math.ceil(players.length / state.settings.laneCount) : 0;
      const finalizedCount = state.qualifierRounds.filter(round => round.finalist).length;
      activeRoundIndex = Math.min(activeRoundIndex, state.qualifierRounds.length - 1);
      const activeRound = state.qualifierRounds[activeRoundIndex];
      const isMobileOperatorView = (() => {
        try {
          if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) return true;
          if (window.matchMedia && window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches) return true;
          return window.innerWidth <= 760;
        } catch (error) { return false; }
      })();
      const hasActiveStage = Boolean(activeRound?.stages?.length);
      const shouldOpenSetupPanel = !isMobileOperatorView || (!hasActiveStage && state.tournament.status !== "running");
      const operatorHeaderDescription = "";

      app.innerHTML = `
        <div class="wrap app-shell-v211 app-shell-v224 operator-shell-v211 operator-shell-v224 operator-shell-v226 operator-shell-v227">
          ${renderUnifiedPageHeaderV173({
            className: "operator-titlebar-v132 operator-titlebar-v224 operator-titlebar-v226 operator-titlebar-v249",
            kicker: "운영",
            title: `${matchModeLabel()} · ${state.settings.laneCount}레인`,
            description: operatorHeaderDescription,
            stats: []
          })}

          ${renderOperatorCommandBarV224()}
          ${renderOperatorOverviewV226(activeRound, {
            players,
            estimatedGroups,
            finalizedCount,
            roundIndex: activeRoundIndex,
            isMobileOperatorView
          })}

          <div class="layout ui-workspace-v211 ui-workspace-v224 operator-workspace-v211 operator-workspace-v224 operator-workspace-v226 operator-workspace-v227">
            <main class="main-area ui-work-main-v224 operator-main-v211 operator-main-v224 operator-main-v226 operator-main-v227" id="operatorMatchAreaV147">
              <section class="operator-task-stack-v224 operator-task-stack-v227" aria-label="운영 현재 작업">
                ${renderOperatorRoundRailV226()}
                ${renderOperatorFinalShortcutV245()}
                ${renderActiveRound(activeRound, activeRoundIndex)}
                ${renderOperatorFinalPanelV224()}
              </section>
            </main>

            <aside class="side-area ui-work-side-v224 operator-control-pages operator-side-v211 operator-side-v224 operator-side-v226 operator-side-v227" id="operatorControlAreaV147">
              ${renderOperatorSetupPanelV224(shouldOpenSetupPanel)}
              ${renderOperatorToolsPanelV224()}
            </aside>
          </div>
          ${renderOperatorUndoFloatV266(isMobileOperatorView)}
          ${renderOperatorMobileDockV226(activeRound, activeRoundIndex)}
        </div>
      `;
      bindForcedGroupCountInputs(app);
      scheduleOperatorRenderLiveSyncV269("operator-render-v269");
    }

    function renderUiStatusStripV224(items = [], className = "") {
      const rows = items.filter(item => item && (item.value || item.value === 0));
      if (!rows.length) return "";
      return `<section class="ui-status-strip-v224 ${escapeAttr(className)}">${rows.map(item => `<div class="ui-status-item-v224"><span>${escapeHtml(item.label || "")}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</section>`;
    }

    function renderUiPanelHeadV224(options = {}) {
      const kicker = options.kicker ? `<span class="ui-panel-kicker-v224">${escapeHtml(options.kicker)}</span>` : "";
      const title = options.title ? `<strong>${escapeHtml(options.title)}</strong>` : "";
      const meta = options.meta ? `<small>${escapeHtml(options.meta)}</small>` : "";
      const actions = Array.isArray(options.actions) && options.actions.length
        ? `<span class="ui-panel-actions-v224">${options.actions.join("")}</span>`
        : "";
      return `<div class="ui-panel-head-v224"><span>${kicker}${title}${meta}</span>${actions}</div>`;
    }

    function renderOperatorSubheadV230(options = {}) {
      const kicker = options.kicker ? `<span>${escapeHtml(options.kicker)}</span>` : "";
      const title = options.title ? `<strong>${escapeHtml(options.title)}</strong>` : "";
      const meta = options.meta ? `<small>${escapeHtml(options.meta)}</small>` : "";
      return `<div class="operator-subhead-v230">${kicker}<div>${title}${meta}</div></div>`;
    }

    function getOperatorControlContextV246(round) {
      const currentStageIndex = round?.stages?.length ? round.stages.length - 1 : -1;
      const currentStage = currentStageIndex >= 0 ? round.stages[currentStageIndex] : null;
      const progress = getOperatorStageProgressV225(currentStage);
      const stageLabel = currentStage ? `${round.title} · ${currentStage.name}` : `${round?.title || "라운드"} 준비`;
      const progressLabel = currentStage ? `${progress.done}/${progress.total}조 입력` : `${parseParticipants().length}명 대기`;
      const nextGroupText = currentStage
        ? `${progress.nextName || "다음 조"}${progress.nextPlayers ? ` · ${progress.nextPlayers}${progress.extraCount ? ` 외 ${progress.extraCount}명` : ""}` : ""}`
        : "";
      return { currentStageIndex, currentStage, progress, stageLabel, progressLabel, nextGroupText };
    }

    function renderOperatorOverviewV226(round, counts = {}) {
      const { currentStage, stageLabel, progressLabel, nextGroupText } = getOperatorControlContextV246(round);
      const players = counts.players || parseParticipants();
      const participantCount = players.filter(player => player && !player.isEmptyLane).length;
      const estimatedGroups = counts.estimatedGroups ?? (participantCount ? Math.ceil(participantCount / state.settings.laneCount) : 0);
      const finalizedCount = counts.finalizedCount ?? state.qualifierRounds.filter(item => item.finalist).length;
      const totalGroups = currentStage?.groups?.length || estimatedGroups;
      const tournamentName = state.tournament?.name || "대회명 미입력";
      const venueName = state.tournament?.venue || currentVenueName() || "경기장 미입력";
      const raceClass = normalizeRaceClassName(state.tournament?.raceClass || "오픈");
      const roundIndex = counts.roundIndex ?? activeRoundIndex;
      const isMobileOperatorView = !!counts.isMobileOperatorView;
      return `<section class="operator-overview-v226 ui-panel-v224" aria-label="운영 현황">
        <div class="operator-overview-current-v226">
          <small>${escapeHtml(statusLabel(state.tournament?.status || "draft"))}</small>
          <strong>${escapeHtml(stageLabel)}</strong>
          ${currentStage ? `<span class="operator-overview-next-v246">${escapeHtml(nextGroupText || "현재 조 대기")}</span><b class="operator-overview-progress-v246">${escapeHtml(progressLabel)}</b>` : ""}
          <span class="operator-overview-meta-v246">${escapeHtml(`${tournamentName} · ${venueName} · ${raceClass}`)}</span>
        </div>
        <div class="operator-overview-stat-v226"><small>참가자</small><strong>${participantCount}</strong></div>
        <div class="operator-overview-stat-v226"><small>현재 조</small><strong>${totalGroups}</strong></div>
        <div class="operator-overview-stat-v226"><small>진출 확정</small><strong>${finalizedCount}/${state.qualifierRounds.length}</strong></div>
        ${renderOperatorControlConsoleV226(round, roundIndex, isMobileOperatorView)}
        <div class="error operator-feedback-v228" id="error"></div>
      </section>`;
    }

    function renderOperatorCommandBarV224() {
      const navActions = [
        { label: "선수 명단", onClick: "openDbPage()" },
        { label: "기록", onClick: "openDashboardPage()" },
        { label: "라이브", onClick: "openLiveLobbyPage()" },
        isAdminUser() ? { label: "관리", onClick: "openAdminPage()" } : null
      ].filter(Boolean);
      const mobileRouteActions = [
        { label: "선수", onClick: "openDbPage()" },
        { label: "기록", onClick: "openDashboardPage()" },
        { label: "라이브", onClick: "openLiveLobbyPage()" },
        isAdminUser() ? { label: "관리", onClick: "openAdminPage()" } : null
      ].filter(Boolean);
      const toolActions = [
        { label: "출력", onClick: "openPrintView()" }
      ];
      const role = isAdminUser() ? "관리자" : isVenueUser() ? "경기장" : "운영";
      const venue = currentVenueName();
      const accountText = currentAuthUser?.email
        ? `${role}${venue ? ` · ${venue}` : ""} · ${currentAuthUser.email}`
        : `${role}${venue ? ` · ${venue}` : ""}`;
      return `<nav class="ui-actionbar-v211 ui-commandbar-v212 operator-commandbar-v211 operator-commandbar-v224" aria-label="운영 화면 작업">
        <div class="operator-mobile-top-route-v233" role="group" aria-label="다른 화면 이동">
          ${mobileRouteActions.map(action => `<button type="button" class="ghost" onclick="${escapeAttr(action.onClick)}">${escapeHtml(action.label)}</button>`).join("")}
        </div>
        ${renderUiActionGroupV211("", navActions, "operator-nav-group-v211 operator-nav-group-v224")}
        ${renderUiActionGroupV211("", toolActions, "operator-tool-group-v211 operator-tool-group-v224")}
        <div class="ui-action-group-v211 ui-action-account-v211 operator-account-group-v211 operator-account-group-v224">
          <span class="pill operator-account-pill-v211 operator-account-pill-v224">${escapeHtml(accountText)}</span>
          <button type="button" class="ghost" onclick="logoutUser()">로그아웃</button>
        </div>
      </nav>`;
    }

    function renderOperatorContextStripV224(round) {
      const currentStage = round?.stages?.[round.stages.length - 1];
      const stageLabel = currentStage ? `${round.title} · ${currentStage.name}` : `${round?.title || "1차 라운드"} 준비`;
      return renderUiStatusStripV224([
        { label: "현재 작업", value: stageLabel },
        { label: "대회", value: state.tournament?.name || "미입력" },
        { label: "경기장", value: state.tournament?.venue || currentVenueName() || "미입력" },
        { label: "클래스", value: normalizeRaceClassName(state.tournament?.raceClass || "오픈") }
      ], "operator-context-strip-v224");
    }

    function getOperatorStageProgressV225(stage) {
      const groups = stage?.groups || [];
      const done = groups.filter(group => groupHasResult(group, stage)).length;
      const nextGroup = groups.find(group => !groupHasResult(group, stage)) || groups[groups.length - 1] || null;
      const names = (nextGroup?.slots || [])
        .filter(player => player && !player.isEmptyLane)
        .map(player => player.name || player.nickname || player.realName || "참가자");
      return {
        done,
        total: groups.length,
        nextName: nextGroup?.name || "",
        nextPlayers: names.slice(0, 3).join(" · "),
        extraCount: Math.max(0, names.length - 3)
      };
    }

    function isConfirmableRoundFinalStageV228(stage) {
      if (!stage) return false;
      return stage.name === "라운드 결승" || stage.name === "결승" || isPointFinalDecisionStage(stage);
    }

    function renderOperatorControlConsoleV226(round, roundIndex, isMobileOperatorView = false) {
      const { currentStage } = getOperatorControlContextV246(round);
      const hideMobileReadyConsoleV240 = isMobileOperatorView && !currentStage;
      const isPointFinalStage = isPointFinalDecisionStage(currentStage);
      const canConfirmFinalist = isConfirmableRoundFinalStageV228(currentStage);
      const primary = getOperatorPrimaryActionV224(round, roundIndex);
      const confirmLabel = isPointFinalStage ? "1차 진출자 확정" : isRevivalMode() ? "우승자 확정" : isCrowMode() ? "1~3위 확정" : "결승 진출자 확정";
      const secondaryActions = [];
      if (currentStage) {
        secondaryActions.push({ label: "재추첨", onClick: `startQualifierRound(${roundIndex})`, className: "ghost" });
        if (isRevivalMode() && currentStage.type !== "revival" && currentStage.name !== "라운드 결승") {
          secondaryActions.push({ label: "패자부활전", onClick: `createRevivalStage(${roundIndex})`, className: "ghost" });
        }
        if (canConfirmFinalist) {
          secondaryActions.push({ label: confirmLabel, onClick: `confirmRoundFinalist(${roundIndex})`, className: "ghost" });
        }
        secondaryActions.push({ label: "초기화", onClick: `resetQualifierRound(${roundIndex})`, className: "danger" });
      } else {
        secondaryActions.push({ label: "선수 명단", onClick: "openDbPage()", className: "ghost" });
        secondaryActions.push({ label: "설정 열기", onClick: "scrollOperatorSectionV147('operatorSetupAreaV214')", className: "ghost" });
      }

      return `<div class="operator-control-console-v226 operator-overview-controls-v246 ${hideMobileReadyConsoleV240 ? "operator-ready-console-v240" : ""}" aria-label="운영 컨트롤러" data-has-stage="${currentStage ? "true" : "false"}" ${hideMobileReadyConsoleV240 ? `hidden aria-hidden="true"` : ""}>
        <div class="operator-controller-grid-v226">
          ${!isMobileOperatorView ? `<button type="button" class="${escapeAttr(primary.className)} operator-controller-primary-v226" onclick="${escapeAttr(primary.onClick)}">${escapeHtml(primary.label)}</button>` : ""}
          <div class="operator-controller-actions-v226" role="group" aria-label="운영 보조 작업">
            ${secondaryActions.map(action => `<button type="button" class="${escapeAttr(action.className)}" onclick="${escapeAttr(action.onClick)}">${escapeHtml(action.label)}</button>`).join("")}
          </div>
          <div class="operator-controller-group-size-v226">${renderGroupSizeControl()}</div>
        </div>
      </div>`;
    }

    function renderOperatorSetupPanelV224(shouldOpenSetupPanel) {
      void shouldOpenSetupPanel;
      return `<section class="operator-page ui-panel-v211 ui-panel-v224 operator-side-panel-v227 operator-setup-panel-v224 operator-setup-panel-v227 operator-static-panel-v236" id="operatorSetupAreaV214">
        ${renderUiPanelHeadV224({ title: "대회 준비" })}
        <div class="operator-page-body operator-page-body-v224 operator-page-body-v227">
          <section class="operator-form-panel-v224 operator-form-panel-v227 operator-unified-section-v230 prep-card-v115 prep-card-v116">
            ${renderOperatorSubheadV230({ title: "기본 정보" })}
            ${renderTournamentStatusPanel()}
            <div class="prep-form-v115">
              <div class="form-grid">
                <div><label>대회명 <span class="prep-required-v115">필수</span></label><input class="mini-input" required placeholder="예: OPEN CLASS 1차전" value="${escapeHtml(state.tournament.name || "")}" oninput="setTournamentField('name', this.value)" onblur="renderOperator()" /></div>
                <div><label>경기장 <span class="prep-required-v115">필수</span></label><input class="mini-input" required placeholder="예: ATHENS" value="${escapeHtml(state.tournament.venue || currentVenueName() || "")}" ${isVenueUser() ? "disabled" : ""} oninput="setTournamentField('venue', this.value)" onblur="renderOperator()" /></div>
              </div>
              <div><label>클래스</label><select class="mini-input" value="${escapeHtml(state.tournament.raceClass || "오픈")}" onchange="setTournamentField('raceClass', this.value)">${CLASS_OPTIONS.map(item => `<option value="${item}" ${normalizeRaceClassName(state.tournament.raceClass) === item ? "selected" : ""}>${item}</option>`).join("")}</select></div>
            </div>
          </section>

          <section class="operator-config-group-v224 operator-config-group-v227 operator-unified-section-v230">
            ${renderOperatorSubheadV230({ title: "규칙" })}
            <label>레인</label>
            <div class="btnrow"><button class="${state.settings.laneCount === 3 ? "active" : ""}" onclick="setLaneCount(3)">3레인</button><button class="${state.settings.laneCount === 5 ? "active" : ""}" onclick="setLaneCount(5)">5레인</button></div>
            <label>같은 팀 회피</label>
            <div class="btnrow four">${["none", "low", "medium", "high"].map(level => `<button class="${state.settings.avoidance === level ? "active" : ""}" onclick="setSetting('avoidance', '${level}')">${avoidanceLabel(level)}</button>`).join("")}</div>
            <label>레인 중복 회피</label>
            <div class="btnrow"><button class="${!state.settings.sameLanePrevention ? "active" : ""}" onclick="setSetting('sameLanePrevention', false)">없음</button><button class="${state.settings.sameLanePrevention ? "active" : ""}" onclick="setSetting('sameLanePrevention', true)">적용</button></div>
            <div class="form-grid"><div><label>조 편성</label><input class="mini-input forced-group-count-input-v265" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="자동" value="${escapeHtml(state.settings.forcedGroupCount)}" oninput="setForcedGroupCountDraft(this.value, this)" onchange="commitForcedGroupCountInput(this)" onblur="commitForcedGroupCountInput(this)" onkeydown="if(event.key==='Enter'){commitForcedGroupCountInput(this); this.blur();}" /></div><div><label>레인 수</label><input type="number" value="${state.settings.laneCount}" disabled /></div></div>
            <label class="settings-checkline-v182"><input type="checkbox" ${state.settings.excludeFinalists ? "checked" : ""} onchange="setSetting('excludeFinalists', this.checked)" /><span>결승 진출자는 다음 라운드 제외</span></label>
          </section>

          <section class="operator-mode-group-v224 operator-mode-group-v227 operator-unified-section-v230">
            ${renderOperatorSubheadV230({ title: "방식" })}
            <div class="btnrow mode-row match-mode-grid-v124 match-mode-grid-v140"><button class="${normalizeMatchMode(state.settings.matchMode) === 'basic' ? "active" : ""}" onclick="setMatchMode('basic')">토너먼트</button><button class="${normalizeMatchMode(state.settings.matchMode) === 'points3' ? "active" : ""}" onclick="setMatchMode('points3')">포인트전 3회</button><button class="${normalizeMatchMode(state.settings.matchMode) === 'points5Tree' ? "active" : ""}" onclick="setMatchMode('points5Tree')">포인트전 5회</button><button class="${state.settings.matchMode === 'revival' ? "active" : ""}" onclick="setMatchMode('revival')">패자부활</button><button class="${state.settings.matchMode === 'crow' ? "active" : ""}" onclick="setMatchMode('crow')">토너먼트(9강)</button></div>
          </section>
        </div>
      </section>`;
    }

    function renderOperatorToolsPanelV224() {
      return `<section class="operator-page ui-panel-v211 ui-panel-v224 operator-side-panel-v227 operator-tools-panel-v224 operator-tools-panel-v227 operator-static-panel-v236" id="operatorOpsAreaV183">
        ${renderUiPanelHeadV224({ title: "기타" })}
        <div class="operator-page-body operator-page-body-v224 operator-page-body-v227">
          <section class="operator-tools-summary-v224 operator-tools-summary-v227 operator-unified-section-v230">
            ${renderOperatorSubheadV230({ title: "안내와 기록" })}
            <div class="operator-tool-primary-row-v230"><button class="primary manual-open-button" onclick="openUsageManual()">안내 열기</button></div>
            <div class="finalist-grid operator-tool-grid-v224 operator-tool-grid-v227">
              <div class="finalist-item"><b>경기 방식</b><br>${matchModeLabel()}</div>
              <div class="finalist-item"><b>대회명</b><br>${escapeHtml(state.tournament.name || "미입력")}</div>
              <div class="finalist-item"><b>경기장</b><br>${escapeHtml(state.tournament.venue || "미입력")}</div>
              <div class="finalist-item"><b>레인 중복 회피</b><br>${state.settings.sameLanePrevention ? "적용" : "없음"}</div>
              <div class="finalist-item download-mini operator-download-actions-v224 operator-download-actions-v227"><b>기록 저장</b><div class="operator-download-button-row-v243"><button onclick="exportTournamentCsv()">결과표</button><button onclick="exportTournamentJson()">전체 기록</button></div></div>
            </div>
          </section>
          ${renderEmergencyAdjustPanel()}
          ${renderOperationPanel()}
        </div>
      </section>`;
    }

    function getOperatorFinalActionLabelV245() {
      return isCrowMode() ? "9강 준결 생성" : "최종 결승 진행";
    }

    function renderOperatorFinalShortcutV245() {
      if (isRevivalMode() || state.finalRace) return "";
      const label = getOperatorFinalActionLabelV245();
      return `<div class="operator-final-shortcut-v245" aria-label="${escapeAttr(label)}"><button type="button" class="primary" onclick="createFinalRace()">${escapeHtml(label)}</button></div>`;
    }

    function renderOperatorFinalPanelV224() {
      if (isRevivalMode() || !state.finalRace) return "";
      return `<div class="operator-final-area-v224 operator-final-area-v227">${renderFinalRace()}</div>`;
    }

    function getOperatorPrimaryActionV224(round, roundIndex) {
      const currentStageIndex = round?.stages?.length ? round.stages.length - 1 : -1;
      const currentStage = currentStageIndex >= 0 ? round.stages[currentStageIndex] : null;
      if (state.finalRace && state.tournament.status === "running" && isTournamentFinalResultReady()) {
        return { label: "대회 종료", onClick: "finishTournament()", className: "primary operator-mobile-primary-v224" };
      }
      if (!isRevivalMode() && !state.finalRace && state.qualifierRounds.every(item => item.finalist || (isCrowMode() && (item.crowFinalists || []).length >= 3))) {
        return { label: isCrowMode() ? "9강 준결 생성" : "최종 결승 진행", onClick: "createFinalRace()", className: "primary operator-mobile-primary-v224" };
      }
      if (!currentStage) {
        return { label: `${round?.title || "라운드"} 시작`, onClick: `startQualifierRound(${roundIndex})`, className: "primary operator-mobile-primary-v224" };
      }
      const isFinalDecisionStage = isConfirmableRoundFinalStageV228(currentStage);
      const finalDecisionLabel = isRevivalMode() ? "우승 확정" : isCrowMode() ? "1~3위 확정" : "진출 확정";
      const nextLabel = isFinalDecisionStage
        ? (round?.finalist ? "다음 라운드" : finalDecisionLabel)
        : currentStage?.type === "pointTieBreak"
          ? "트리타기 시작"
          : currentStage?.type === "pointLadder"
            ? "다음 단계"
            : currentStage?.type === "revival"
              ? "진출자 합류"
              : "다음 경기 진행";
      return {
        label: nextLabel,
        onClick: isFinalDecisionStage ? `goToNextRoundAfterFinalist(${roundIndex})` : `createNextStage(${roundIndex})`,
        className: "primary operator-mobile-primary-v224"
      };
    }

    function renderOperatorMobileDockV226(round, roundIndex) {
      const primary = getOperatorPrimaryActionV224(round, roundIndex);
      return `<nav class="mobile-operator-dock-v147 operator-mobile-dock-v224 operator-mobile-dock-v226 operator-mobile-dock-v233" aria-label="모바일 운영 빠른 이동">
        <button type="button" class="${escapeAttr(primary.className)}" onclick="${escapeAttr(primary.onClick)}">${escapeHtml(primary.label)}</button>
        <button type="button" class="operator-mobile-section-button-v233" onclick="scrollOperatorSectionV147('operatorCurrentRoundV147')">경기</button>
        <button type="button" class="operator-mobile-section-button-v233" onclick="scrollOperatorSectionV147('operatorSetupAreaV214')">설정</button>
        <button type="button" class="operator-mobile-section-button-v233" onclick="scrollOperatorSectionV147('operatorOpsAreaV183')">기타</button>
      </nav>`;
    }

    function openUsageManual() {
      closeUsageManual();

      const modal = document.createElement("div");
      modal.className = "manual-modal";
      modal.id = "usageManualModal";
      modal.innerHTML = `
        <div class="manual-backdrop" onclick="closeUsageManual()"></div>
        <section class="manual-panel" role="dialog" aria-modal="true" aria-label="안내">
          <header class="manual-head">
            <div>
              <strong>MINI4WD TOURNAMENT MAKER</strong>
              <span>안내</span>
            </div>
            <button onclick="closeUsageManual()">닫기</button>
          </header>

          <div class="manual-body">
            <h2>1. 기본 흐름</h2>
            <ol>
              <li>대회명과 경기장은 필수로 입력합니다. 클래스는 오픈, 스톡, 어드&비맥스, 기타 클래스 순서로 선택합니다.</li>
              <li>경기 방식을 선택합니다. 토너먼트, 포인트전, 패자부활, 토너먼트(9강) 중 하나를 고릅니다.</li>
              <li>레인을 3레인 또는 5레인으로 선택합니다.</li>
              <li>선수 명단에서 참가자를 선택해 대진 명단을 구성합니다.</li>
              <li><b>대회 시작</b>을 누르면 시작 시간이 기록됩니다.</li>
              <li>각 조에서 진출자를 선택하고 <b>다음 경기 진행</b>을 누릅니다.</li>
              <li>마지막 결승 또는 최종 결승에서 우승자를 확정합니다.</li>
            </ol>

            <h2>2. 경기 방식</h2>
            <h3>토너먼트</h3>
            <p>3레인은 1차~3차 라운드, 5레인은 1차~5차 라운드로 운영합니다. 각 라운드의 결승 진출자가 모두 확정되면 최종 결승을 진행합니다.</p>

            <h3>포인트전</h3>
            <p>1차 라운드만 포인트전으로 진행합니다. 1·2차전은 3점/2점/1점/0점, 3차전은 5점/2점/1점/0점입니다. 합산 상위 인원이 결선을 진행하고, 그 승자가 최종 결승에 진출합니다.</p>
            <p>포인트전 5회는 모두 3점/2점/1점/0점으로 진행합니다. 누적 점수가 같으면 추가 순위 결정전으로 위아래를 정한 뒤, 가장 낮은 점수 선수부터 계단식 트리타기를 진행합니다.</p>

            <h3>패자부활 토너먼트</h3>
            <p>패자부활은 1차/2차/3차 라운드 구조가 아니라 하나의 큰 토너먼트 흐름입니다. 원하는 시점에 <b>패자부활전 생성</b>을 누르면 현재 경기의 비진출자가 패자부활 대상으로 편성됩니다. 패자부활 진출자는 기존 진출자와 합류하여 다음 경기를 진행합니다.</p>

            <h2>3. 조 편성 규칙</h2>
            <ul>
              <li>레인 수는 실제 경기장 구조입니다. 3레인은 1~3LANE, 5레인은 1~5LANE으로 표시됩니다.</li>
              <li>다음 경기 조 인원은 레인 수와 별도로 선택할 수 있습니다. 예를 들어 3레인 경기에서도 2명씩 편성할 수 있습니다.</li>
              <li>조 인원은 기본 목표값입니다. 참가자가 정수로 나뉘지 않아도 <b>1명짜리 단독 조는 만들지 않습니다.</b></li>
              <li>남는 1명은 다른 조에 합쳐서 경기 가능한 조로 편성합니다. 단, 한 조의 실제 인원은 레인 수를 넘지 않습니다.</li>
              <li>비어 있는 레인은 <b>빈 레인</b>으로 표시되며 선택할 수 없습니다.</li>
            </ul>

            <h2>4. 운영 버튼</h2>
            <ul>
              <li><b>TV 화면</b>: 현재 송출 대상을 큰 화면으로 엽니다.</li>
              <li><b>라이브</b>: 경기장별 송출 화면으로 이동합니다.</li>
              <li><b>대진표</b>: 현재 경기의 출력용 대진표를 엽니다.</li>
              <li><b>엑셀 다운로드</b>: 대진표 화면에서 출력용 대진표를 엑셀 파일로 저장합니다.</li>
              <li><b>기록 저장</b>: 결과표와 전체 기록을 저장합니다.</li>
            </ul>

            <h2>5. 출력 / 기록</h2>
            <p>출력용 대진표에는 조, 레인, 선수명만 표시합니다. 기록 파일에는 팀명, 점수, 결과, 레인 이력이 포함됩니다.</p>

            <h2>6. 주의사항</h2>
            <ul>
              <li>대회 시작 후 경기 방식과 레인 수를 바꾸면 기록이 꼬일 수 있습니다.</li>
              <li>패자부활전은 현재 단계의 진출자를 먼저 선택한 뒤 생성해야 합니다.</li>
              <li>같은 팀 회피와 레인 중복 회피는 필요할 때만 적용하세요.</li>
              <li>경기 중 수정이 많아질 경우, 기록을 내려받아 보관합니다.</li>
            </ul>
          </div>
        </section>
      `;

      document.body.appendChild(modal);
    }

    function closeUsageManual() {
      const existing = document.getElementById("usageManualModal");
      if (existing) existing.remove();
    }


    /* v122 performance cache: render cache / lazy history / lightweight render save */
    let metricCacheV122 = null;
    let renderSaveTimerV122 = null;

    function resetMetricCacheV122() {
      metricCacheV122 = null;
    }

    function getPlayerMetricCacheKeyV122(player = {}) {
      try {
        return playerMetricKeys(player).join("\u001f");
      } catch (error) {
        return String(player?.id || player?.name || "");
      }
    }

    function keysOverlapV122(left = [], right = []) {
      if (!left.length || !right.length) return false;
      const set = new Set(left);
      return right.some(key => set.has(key));
    }

    function buildGroupedRecentRecordsV122(records = []) {
      return records.map(record => {
        const groups = new Map();
        const lowScoreWins = isLowScorePointRecordV188(record);
        (record.rows || []).forEach(row => {
          if (!row || row.결과 === "빈 레인") return;
          const key = `${row.차수 || ""}|${row.단계 || ""}|${row.조 || ""}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        });
        return {
          record,
          groups: Array.from(groups.values()).map(rows => ({
            rows,
            lowScoreWins,
            items: rows.map(row => ({ row, keys: rowMetricKeys(row) }))
          }))
        };
      });
    }

    function buildTodayLaneRateMapV122() {
      const laneStats = new Map();
      const ensureLane = laneNo => {
        if (!laneStats.has(laneNo)) laneStats.set(laneNo, { matches: 0, wins: 0 });
        return laneStats.get(laneNo);
      };
      getAllTournamentStagesForMetrics().forEach(stage => {
        (stage.groups || []).forEach(group => {
          const validSlots = (group.slots || []).filter(item => item && !item.isEmptyLane);
          let pointWinScore = null;
          if (group.points) {
            const scores = validSlots.map(item => Number(group.points[item.id] || 0)).filter(value => Number.isFinite(value));
            pointWinScore = scores.length
              ? (isPointFiveTreeMode() ? Math.min(...scores) : Math.max(...scores))
              : null;
          }
          validSlots.forEach(slot => {
            const laneNo = Number(slot.lane);
            if (!laneNo) return;
            const stat = ensureLane(laneNo);
            stat.matches += 1;
            if ((group.advanceIds || []).includes(slot.id)) {
              stat.wins += 1;
              return;
            }
            if (group.points && Object.prototype.hasOwnProperty.call(group.points, slot.id)) {
              const score = Number(group.points[slot.id] || 0);
              if (pointWinScore != null && score === pointWinScore && (isPointFiveTreeMode() || score > 0)) stat.wins += 1;
            }
          });
        });
      });
      const rateMap = new Map();
      laneStats.forEach((stat, laneNo) => {
        rateMap.set(laneNo, stat.matches ? `${Math.round((stat.wins / stat.matches) * 100)}%` : "-");
      });
      return rateMap;
    }

    function getMetricCacheV122() {
      if (metricCacheV122) return metricCacheV122;
      let recentRecords = [];
      try { recentRecords = getRecentMetricRecords(3); } catch (error) { recentRecords = []; }
      metricCacheV122 = {
        recentRecords,
        groupedRecords: buildGroupedRecentRecordsV122(recentRecords),
        laneRateMap: buildTodayLaneRateMapV122(),
        h2h: new Map()
      };
      return metricCacheV122;
    }

    function saveOperatorRenderStateV122(reason = "render") {
      try {
        ensureStateDefaults();
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        if (state.tournament?.status === "running") {
          state.settings.firebaseAutoSave = true;
          activateAutoLiveSession(false);
        }
        clearTimeout(renderSaveTimerV122);
        renderSaveTimerV122 = setTimeout(() => {
          try {
            const payload = exportState();
            safeSetItem(STORAGE_KEY, JSON.stringify(payload));
            if (["running", "finished", "archived"].includes(state.tournament?.status || "")) queueFirebaseSave();
          } catch (error) {
            console.warn("v122 render save skipped", error);
          }
        }, 80);
      } catch (error) {
        console.warn("v122 render save setup failed", error);
      }
    }

    function renderPastStageHistoryV122(details, roundIndex) {
      try {
        if (!details || !details.open || details.dataset.loaded === "1") return;
        const container = details.querySelector(".history-list-v122");
        const round = state.qualifierRounds?.[roundIndex];
        if (!container || !round) return;
        const currentStageIndex = round.stages?.length ? round.stages.length - 1 : -1;
        const pastStages = currentStageIndex > 0 ? round.stages.slice(0, currentStageIndex) : [];
        resetMetricCacheV122();
        container.innerHTML = pastStages.slice().reverse().map((stage, offset) => {
          const originalIndex = pastStages.length - 1 - offset;
          return renderStage(stage, roundIndex, originalIndex, true);
        }).join("") || `<div class="hint">과거 경기 기록이 없습니다.</div>`;
        details.dataset.loaded = "1";
      } catch (error) {
        console.warn("v122 lazy history render failed", error);
      }
    }

    function renderRoundTab(round, index) {
      const status = getRoundStatus(round);
      return `
        <button class="tab-btn ${activeRoundIndex === index ? "active" : ""}" onclick="setActiveRound(${index})" aria-label="${escapeAttr(`${round.title} ${status}`)}">
          <span>${escapeHtml(round.title)}</span>
          <small>${escapeHtml(status)}</small>
        </button>
      `;
    }

    function renderOperatorRoundRailV226() {
      if (isRevivalMode()) return "";
      return `<nav class="operator-round-rail-v226" aria-label="라운드 선택">
        ${state.qualifierRounds.map((round, index) => {
          const status = getRoundStatus(round);
          return `<button type="button" class="operator-round-tab-v226 ${activeRoundIndex === index ? "is-active" : ""}" onclick="setActiveRound(${index})" aria-label="${escapeAttr(`${round.title} ${status}`)}">
            <span>${escapeHtml(round.title)}</span>
            <small>${escapeHtml(status)}</small>
          </button>`;
        }).join("")}
      </nav>`;
    }

    function getRoundStatus(round) {
      if (round.finalist) return round.finalist.name || "확정";
      if (round.stages.length) return `진행중 · ${round.stages[round.stages.length - 1].name}`;
      return "미진행";
    }

    function renderMobileOperatorOverviewV147(round) {
      const currentStage = round?.stages?.[round.stages.length - 1];
      const stageLabel = currentStage ? `${round.title} · ${currentStage.name}` : `${round?.title || "1차 라운드"} 준비`;
      const participantCount = parseParticipants().filter(player => player && !player.isEmptyLane).length;
      const totalGroups = currentStage?.groups?.length || 0;
      const finalizedCount = state.qualifierRounds.filter(item => item.finalist).length;
      const tournamentMeta = [
        state.tournament?.name || "대회명 미입력",
        state.tournament?.venue || currentVenueName() || "경기장 미입력",
        normalizeRaceClassName(state.tournament?.raceClass || "오픈")
      ].filter(Boolean).join(" · ");
      const status = state.tournament?.status || "draft";
      return `<section class="mobile-operator-overview-v147" aria-label="모바일 운영 현황">
        <div class="mobile-overview-main-v147"><small>${escapeHtml(statusLabel(status))}</small><strong>${escapeHtml(stageLabel)}</strong><span>${escapeHtml(tournamentMeta)}</span></div>
        <div class="mobile-overview-stat-v147"><small>참가자</small><strong>${participantCount}</strong></div>
        <div class="mobile-overview-stat-v147"><small>현재 조</small><strong>${totalGroups}</strong></div>
        <div class="mobile-overview-stat-v147"><small>진출 확정</small><strong>${finalizedCount}</strong></div>
      </section>`;
    }

    function renderPcOperatorOverviewV148(round) {
      const currentStage = round?.stages?.[round.stages.length - 1];
      const participantCount = parseParticipants().filter(player => player && !player.isEmptyLane).length;
      const totalGroups = currentStage?.groups?.length || 0;
      const finalizedCount = state.qualifierRounds.filter(item => item.finalist).length;
      const stageLabel = currentStage ? `${round.title} · ${currentStage.name}` : `${round?.title || "1차 라운드"} 준비`;
      const venueLabel = state.tournament?.venue || currentVenueName() || "경기장 미입력";
      return `<section class="pc-operator-overview-v148" aria-label="PC 운영 현황">
        <div class="pc-overview-main-v148">
          <small>${escapeHtml(statusLabel(state.tournament?.status || "draft"))}</small>
          <strong>${escapeHtml(stageLabel)}</strong>
          <span>${escapeHtml(state.tournament?.name || "대회명 미입력")} · ${escapeHtml(venueLabel)}</span>
        </div>
        <div class="pc-overview-stat-v148"><small>참가자</small><strong>${participantCount}</strong></div>
        <div class="pc-overview-stat-v148"><small>현재 조</small><strong>${totalGroups}</strong></div>
        <div class="pc-overview-stat-v148"><small>진출 확정</small><strong>${finalizedCount}</strong></div>
      </section>`;
    }

    function scrollOperatorSectionV147(targetId) {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }


    function renderRoundProgressDock(roundIndex, currentStage) {
      return "";
    }

    function renderActiveRound(round, roundIndex) {
      const currentStageIndex = round.stages.length ? round.stages.length - 1 : -1;
      const currentStage = currentStageIndex >= 0 ? round.stages[currentStageIndex] : null;
      const pastStages = currentStageIndex > 0 ? round.stages.slice(0, currentStageIndex) : [];

      return `
        <section class="round-card operator-current-task-v224 operator-current-task-v226 operator-current-task-v227" id="operatorCurrentRoundV147">
          ${!currentStage ? `<div class="round-head operator-current-ready-head-v227">
            <div>
              <div class="round-title">
                <h2>${escapeHtml(round.title)}</h2>
                ${round.finalist ? `<span class="round-badge finalist-badge">${escapeHtml(round.finalist.name)}</span>` : ``}
              </div>
              <div class="meta">
                경기 순서 : ${round.stagePlan.length ? round.stagePlan.join(" → ") : makeStagePlan(Math.max(2, parseParticipants().length), state.settings.laneCount).join(" → ")}
              </div>
            </div>
          </div>` : ""}

          ${currentStage ? `
            ${isPointRound(roundIndex) ? renderPointScoreboard(round) : ""}
            <div id="currentStageTop" class="current-stage-area operator-stage-board-v227">
              ${renderStage(currentStage, roundIndex, currentStageIndex, false)}
              ${renderRoundProgressDock(roundIndex, currentStage)}
            </div>
            ${pastStages.length ? `
              <details class="history-panel operator-history-panel-v227 ui-panel-v224" ontoggle="renderPastStageHistoryV122(this, ${roundIndex})">
                <summary>과거 경기 기록 · ${pastStages.length}단계</summary>
                <div class="stage-list history-list history-list-v122 history-list-v227"></div>
              </details>
            ` : ""}
          ` : `<div class="empty operator-current-empty-v227"><div><h3>${round.title} 대진 없음</h3><p>라운드 시작으로 생성합니다.</p></div></div>`}
        </section>
      `;
    }


    function getPointRuleSummaryText(mode = state.settings.matchMode) {
      if (isPointFiveTreeMode(mode)) return "5회 누적 낮은 점수부터 · 동점 결정전 후 계단식 트리";
      if (isAthensPointClass()) return "비맥스/스톡 3회 모두 3/2/1/0";
      return "1·2차 3/2/1/0 · 3차 5/2/1/0";
    }

    function renderPointScoreboard(round) {
      const rawTotals = computePointTotals(round);
      const totals = isPointFiveTreeMode() ? getPointTreeRanking(rawTotals) : rawTotals;
      if (!totals.length) return "";

      // [v113] 포인트 3차전부터 누적 순위 노출 (1·2차에는 순위 숨김)
      const pointStageCount = (round.stages || []).filter(s => s.type === "points").length;
      const showRank = pointStageCount >= 3;

      return `
        <section class="athens-scoreboard${showRank ? " show-rank" : " hide-rank"}">
          <div class="scoreboard-head">
            <strong>포인트 합산 순위</strong>
            <span class="badge">${escapeHtml(getPointRuleSummaryText())}</span>
          </div>
          <div class="scoreboard-list">
            ${totals.map((player, index) => `
              <div class="score-row ${!isPointFiveTreeMode() && index < state.settings.laneCount ? "top-three" : ""}">
                <span class="rank">${showRank ? (index + 1) : "·"}</span>
                <span class="score-name">${escapeHtml(player.name)}${player.team ? ` / ${escapeHtml(player.team)}` : ""}</span>
                <strong>${player.total}P</strong>
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }

    function renderStage(stage, roundIndex, stageIndex, isPast = false) {
      if (stage.type === "points") return renderPointStage(stage, roundIndex, stageIndex, isPast);

      const isBroadcast = state.broadcast.mode === "stage" && state.broadcast.roundIndex === roundIndex && state.broadcast.stageIndex === stageIndex;
      const hidePointFinalHeaderV239 = isPointFinalDecisionStage(stage);
      const sameTeamMeta = Number(stage.meta?.sameTeam || 0);
      const stageGuide = stage.type === "pointTieBreak"
        ? `<div class="point-tree-guide-v150">동점 선수만 낮은 순위부터 선택하세요.</div>`
        : stage.type === "pointLadder"
          ? `<div class="point-tree-guide-v150">승자 1명을 선택하세요. 다음 순위와 이어집니다.</div>`
          : stage.type === "pointFinal" && stage.pointFinalRule === "low-score-tree"
            ? `<div class="point-tree-guide-v150">승자 1명이 최종 결승에 진출합니다.</div>`
            : "";
      return `
        <section class="stage-card operator-stage-v227 ${hidePointFinalHeaderV239 ? "point-final-stage-v239" : ""} ${isPast ? "past-stage" : "current-stage"}">
          ${hidePointFinalHeaderV239 ? "" : `<div class="stage-head stage-head-v131 operator-stage-head-v227">
            <div class="stage-title-line-v131">
              <h3>${escapeHtml(stage.name)} ${isBroadcast ? `<span class="round-badge live-badge">● TV 송출중</span>` : ""}</h3>
              <div class="meta stage-meta-inline-v131"><span>${stage.groups.length}개 조</span>${sameTeamMeta > 0 ? `<span>같은 팀 ${sameTeamMeta}조</span>` : ""}</div>
            </div>
          </div>`}

          ${stageGuide}
          ${!hidePointFinalHeaderV239 && sameTeamMeta > 0 ? `<div class="error" style="display:block; margin-bottom:12px; border-color:#fb923c; color:#fed7aa; background:rgba(251,146,60,.1);">같은 팀 일부 배정</div>` : ""}

          <div class="groups operator-groups-v227">
            ${stage.groups.map(group => renderGroup(group, roundIndex, stageIndex, stage)).join("")}
          </div>
        </section>
      `;
    }


    function renderPointStage(stage, roundIndex, stageIndex, isPast = false) {
      return `
        <section class="stage-card point-stage point-stage-trim-v247 operator-stage-v227 ${isPast ? "past-stage" : "current-stage"}">
          <div class="groups operator-groups-v227">
            ${stage.groups.map(group => `
              <article class="group operator-group-v227">
                <div class="group-title">
                  <strong>${escapeHtml(group.name)}</strong>
                  <span class="badge">${group.slots.filter(slot => !slot.isEmptyLane).length}명 경기</span>
                </div>
                ${group.slots.map(player => renderPointPlayerSlot(player, group, stage, roundIndex, stageIndex)).join("")}
              </article>
            `).join("")}
          </div>
        </section>
      `;
    }

    function renderPointPlayerSlot(player, group, stage, roundIndex, stageIndex) {
      if (player.isEmptyLane) {
        return `
          <div class="slot operator-slot-v227 empty-lane point-slot">
            <div class="slot-inner slot-inner-name-first">
              ${renderPlayerCardMain(player, group)}
            </div>
          </div>
        `;
      }

      const selectedScore = (group.points || {})[player.id];
      return `
        <div class="slot operator-slot-v227 point-slot">
          <div class="slot-inner slot-inner-name-first">
            ${renderPlayerCardMain(player, group)}
          </div>
          <div class="point-buttons">
            ${stage.pointOptions.map(score => `
              <button class="${Number(selectedScore) === Number(score) ? "primary" : "ghost"}" onclick="setPointScore(${roundIndex}, ${stageIndex}, '${escapeAttr(group.id)}', '${escapeAttr(player.id)}', ${score})">${score}P</button>
            `).join("")}
          </div>
        </div>
      `;
    }

    function getAllTournamentStagesForMetrics() {
      const stages = [];
      (state.qualifierRounds || []).forEach(round => (round.stages || []).forEach(stage => stages.push(stage)));
      if (state.finalRace) {
        if (Array.isArray(state.finalRace.groups)) stages.push({ name: state.finalRace.name || "결승", groups: state.finalRace.groups });
        else if (state.finalRace.group) stages.push({ name: state.finalRace.name || "결승", groups: [state.finalRace.group] });
      }
      return stages;
    }

    function getResultRecordDateMs(record = {}) {
      const raw = record.endedAtISO || record.startedAtISO || record.createdAt || record.updatedAt || "";
      const ms = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(ms) ? ms : 0;
    }

    function getRecentMetricRecords(months = 3) {
      const cutoff = Date.now() - months * 31 * 24 * 60 * 60 * 1000;
      const records = [];
      try {
        if (typeof loadLocalResultLogs === "function") records.push(...loadLocalResultLogs());
      } catch (error) {}
      try {
        if (Array.isArray(window.__dashboardRecords)) records.push(...window.__dashboardRecords);
      } catch (error) {}
      try {
        const currentRows = typeof getStageResultRows === "function" ? getStageResultRows() : [];
        if (currentRows && currentRows.length) {
          records.push({
            id: `current-${state.tournament?.recordId || state.tournament?.id || "active"}`,
            createdAt: new Date().toISOString(),
            rows: currentRows
          });
        }
      } catch (error) {}

      const seen = new Set();
      return records.filter(record => {
        if (!record || !Array.isArray(record.rows)) return false;
        const id = record.id || `${record.createdAt || ""}-${record.rows.length}`;
        if (seen.has(id)) return false;
        seen.add(id);
        const dateMs = getResultRecordDateMs(record) || Date.now();
        return dateMs >= cutoff;
      });
    }

    function playerMetricKeys(player = {}) {
      if (!player || player.isEmptyLane) return [];
      let ident = {};
      try { ident = resolvePlayerIdentity(player) || {}; } catch (error) {}
      return Array.from(new Set([
        ident.playerId,
        player.id,
        player.playerId,
        player.name ? `${player.name}|${player.team || ""}` : "",
        player.name || ""
      ].filter(Boolean).map(value => String(value).trim())));
    }

    function rowMetricKeys(row = {}) {
      return Array.from(new Set([
        row.선수ID,
        row.playerId,
        row.선수명 ? `${row.선수명}|${row.팀명 || ""}` : "",
        row.선수명 || row.닉네임 || ""
      ].filter(Boolean).map(value => String(value).trim())));
    }

    function isCountableWinResultV192(result) {
      const text = String(result || "");
      return isRankWinnerResultV188(text) || ["결승진출", "최종결승진출", "최종우승"].includes(text);
    }

    function isMetricWinRow(row, peerRows = [], lowScoreWins = false) {
      const result = String(row?.결과 || "");
      if (isCountableWinResultV192(result)) return true;
      const rowScore = Number(row?.점수 ?? "");
      if (Number.isFinite(rowScore) && (lowScoreWins || rowScore > 0)) {
        const scores = peerRows.map(item => Number(item?.점수 ?? "")).filter(value => Number.isFinite(value));
        if (scores.length && rowScore === (lowScoreWins ? Math.min(...scores) : Math.max(...scores))) return true;
      }
      return false;
    }

    function getRecentHeadToHeadStats(player, currentGroup) {
      if (!player || player.isEmptyLane || !currentGroup) return [];
      const opponents = (currentGroup.slots || [])
        .filter(slot => slot && !slot.isEmptyLane && slot.id !== player.id);
      if (Array.isArray(player.h2hMetrics)) {
        const byName = new Map(player.h2hMetrics.map(item => [String(item.name || "상대").trim(), item]));
        return opponents.map(opponent => {
          const name = String(opponent.name || "상대").trim();
          const item = byName.get(name) || {};
          const matches = Number(item.matches || 0);
          const wins = Number(item.wins || 0);
          const losses = Number(item.losses || Math.max(0, matches - wins));
          const rate = item.rate == null ? (matches ? Math.round((wins / matches) * 100) : null) : Number(item.rate);
          return { opponent, name, matches, wins, losses, rate, rateText: matches ? `${rate}%` : "-" };
        });
      }
      if (!opponents.length) return [];

      const cache = getMetricCacheV122();
      const playerKeys = playerMetricKeys(player);
      const playerKey = getPlayerMetricCacheKeyV122(player);
      return opponents.map(opponent => {
        const opponentKeys = playerMetricKeys(opponent);
        const cacheKey = `${playerKey}::${opponentKeys.join("\u001f")}`;
        if (cache.h2h.has(cacheKey)) {
          const cached = cache.h2h.get(cacheKey);
          return { ...cached, opponent, name: opponent.name || cached.name || "상대" };
        }
        let matches = 0;
        let wins = 0;
        cache.groupedRecords.forEach(record => {
          record.groups.forEach(group => {
            const myItem = group.items.find(item => keysOverlapV122(item.keys, playerKeys));
            if (!myItem) return;
            const opponentItem = group.items.find(item => keysOverlapV122(item.keys, opponentKeys));
            if (!opponentItem) return;
            matches += 1;
            if (isMetricWinRow(myItem.row, group.rows, group.lowScoreWins)) wins += 1;
          });
        });
        const losses = Math.max(0, matches - wins);
        const rate = matches ? Math.round((wins / matches) * 100) : null;
        const value = { name: opponent.name || "상대", matches, wins, losses, rate, rateText: matches ? `${rate}%` : "-" };
        cache.h2h.set(cacheKey, value);
        return { ...value, opponent };
      });
    }

    function getGroupMatchStatsForPlayer(player, currentGroup) {
      const opponents = (currentGroup?.slots || []).filter(slot => slot && !slot.isEmptyLane && slot.id !== player?.id);
      const h2h = getRecentHeadToHeadStats(player, currentGroup);
      const matches = h2h.reduce((sum, item) => sum + Number(item.matches || 0), 0);
      const wins = h2h.reduce((sum, item) => sum + Number(item.wins || 0), 0);
      const rateText = matches ? `${Math.round((wins / matches) * 100)}%` : "-";
      return { opponents: Number(player.groupOpponentCount ?? opponents.length), matches, wins, rateText, h2h };
    }

    function getTodayLaneWinRate(lane) {
      const laneNo = Number(lane);
      if (!laneNo) return "-";
      try {
        const cache = getMetricCacheV122();
        return cache.laneRateMap.get(laneNo) || "-";
      } catch (error) {
        return "-";
      }
    }

    function getDisplayLaneWinRate(lane, player = null) {
      const direct = player && player.todayLaneWinRate != null ? String(player.todayLaneWinRate) : "";
      if (direct) return direct;
      return getTodayLaneWinRate(lane);
    }

    function renderLaneLabelWithRate(lane, player = null) {
      return `<span class="lane-label">${escapeHtml(lane)}LANE<span class="lane-win-rate">오늘 ${escapeHtml(getDisplayLaneWinRate(lane, player))}</span></span>`;
    }

    function getPlayerNameFitClass(name) {
      const length = Array.from(String(name || "").trim()).length;
      if (length <= 4) return "name-fit-short";
      if (length <= 8) return "name-fit-medium";
      if (length <= 13) return "name-fit-long";
      return "name-fit-xlong";
    }

    function renderPlayerTeamInline(player = {}) {
      return player.team ? `<div class="team team-under-name">${escapeHtml(player.team)}</div>` : "";
    }

    function renderPlayerMatchMetrics(player, group) {
      const stats = getGroupMatchStatsForPlayer(player, group);
      const h2hCount = Math.max(1, Math.min(4, (stats.h2h || []).length || 1));
      const h2hRows = (stats.h2h || []).map(item => {
        const label = item.matches
          ? `${item.name} ${item.wins}승${item.losses}패`
          : `${item.name} 전적없음`;
        return `<span class="slot-metric h2h ${item.matches ? "" : "h2h-empty"}">${escapeHtml(label)}</span>`;
      }).join("");
      return `<div class="slot-metrics slot-metrics-inline slot-h2h-rows" title="최근 3개월 전적" style="--h2h-row-count:${h2hCount}"><div class="slot-h2h-title">최근 3개월 전적</div>${h2hRows || `<span class="slot-metric h2h h2h-empty">상대전적 없음</span>`}</div>`;
    }

    function renderPlayerCardMain(player, group) {
      if (player?.isEmptyLane) {
        return `
          <div class="player-card-main player-card-main-empty player-card-main-empty-v133">
            <div class="slot-card-lane-line">${renderLaneLabelWithRate(player.lane, player)}</div>
            <div class="player-info player-info-with-h2h player-info-name-first-card empty-lane-grid-v133">
              <div class="player-identity-block">
                <strong class="player-name-fit name-fit-empty">빈 레인</strong>
              </div>
              <div class="slot-metrics slot-metrics-inline slot-h2h-rows empty-h2h-placeholder-v133" aria-hidden="true" style="--h2h-row-count:4">
                <div class="slot-h2h-title">최근 3개월 전적</div>
                <span class="slot-metric h2h">-</span>
                <span class="slot-metric h2h">-</span>
                <span class="slot-metric h2h">-</span>
                <span class="slot-metric h2h">-</span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="player-card-main player-card-main-active">
          <div class="slot-card-lane-line">${renderLaneLabelWithRate(player.lane, player)}</div>
          <div class="player-info player-info-with-h2h player-info-name-first-card">
            <div class="player-identity-block">
              <strong class="player-name-fit ${getPlayerNameFitClass(player.name)}">${escapeHtml(player.name)}</strong>
              ${renderPlayerTeamInline(player)}
            </div>
            ${renderPlayerMatchMetrics(player, group)}
          </div>
        </div>
      `;
    }

    function isManualLaneStage(stage) {
      if (!stage) return false;
      const name = String(stage.name || "");
      return stage.type === "pointFinal" || name === "라운드 결승" || name === "결승" || name.includes("결정전");
    }

    function getStageLaneCount(stage = null) {
      const laneCount = Number(state?.settings?.laneCount || 0);
      if (laneCount) return laneCount;
      const firstGroup = (stage?.groups || [])[0];
      return Math.max(3, (firstGroup?.slots || []).length || 3);
    }

    function forceStageLane(roundIndex, stageIndex, groupId, playerId, lane) {
      if (!canModifyTournamentAction("라운드 결승 레인 지정")) return;
      const stage = state.qualifierRounds?.[roundIndex]?.stages?.[stageIndex];
      if (!stage || !isManualLaneStage(stage)) return showError("라운드 결승 또는 상위 결정전에서만 레인을 직접 지정할 수 있습니다.");
      const group = (stage.groups || []).find(item => item.id === groupId);
      if (!group) return;
      const target = (group.slots || []).find(item => item.id === playerId);
      if (!target || target.isEmptyLane) return;
      const laneNo = Number(lane);
      if (!laneNo || laneNo < 1 || laneNo > getStageLaneCount(stage)) return;
      const oldLane = target.lane;
      const other = (group.slots || []).find(item => Number(item.lane) === laneNo);
      target.lane = laneNo;
      if (other && other.id !== target.id) other.lane = oldLane;
      group.slots.sort((a, b) => Number(a.lane || 0) - Number(b.lane || 0));
      state.broadcast = { mode: "stage", roundIndex, stageIndex };
      activeRoundIndex = roundIndex;
      logTournamentAction("라운드 결승 레인 지정", `${stage.name} / ${group.name} / ${target.name}: ${laneNo}LANE`);
      renderOperator();
    }

    function renderStageLaneTools(stage, group, player, roundIndex, stageIndex) {
      if (!isManualLaneStage(stage) || !player || player.isEmptyLane) return "";
      const maxLane = getStageLaneCount(stage);
      return `<div class="final-lane-tools round-final-lane-tools">${Array.from({ length: maxLane }, (_, i) => i + 1).map(lane => `<button class="${Number(player.lane) === lane ? "primary" : "ghost"}" onclick="forceStageLane(${roundIndex}, ${stageIndex}, '${escapeAttr(group.id)}', '${escapeAttr(player.id)}', ${lane})">${lane}</button>`).join("")}</div>`;
    }

    function renderGroup(group, roundIndex, stageIndex, stage = null) {
      return `
        <article class="group operator-group-v227 ${isManualLaneStage(stage) ? "round-final-manual-lane-group" : ""}">
          <div class="group-title">
            <strong>${escapeHtml(group.name)}</strong>
            <span class="badge">${group.slots.filter(slot => !slot.isEmptyLane).length}명 경기</span>
          </div>
          ${group.slots.map(player => renderPlayerSlot(player, group, roundIndex, stageIndex, stage)).join("")}
        </article>
      `;
    }

    function renderPlayerSlot(player, group, roundIndex, stageIndex, stage = null) {
      if (player.isEmptyLane) {
        return `
          <div class="slot operator-slot-v227 empty-lane">
            <div class="slot-inner slot-inner-name-first">
              ${renderPlayerCardMain(player, group)}
            </div>
          </div>
        `;
      }

      const selected = (group.advanceIds || []).includes(player.id);
      if (stage?.type === "pointTieBreak") {
        const order = (group.advanceIds || []).indexOf(player.id);
        return `
          <button class="slot operator-slot-v227 ${selected ? "selected" : ""}" onclick="toggleAdvance(${roundIndex}, ${stageIndex}, '${escapeAttr(group.id)}', '${escapeAttr(player.id)}')">
            <div class="slot-inner slot-inner-name-first">
              <div class="player-card-main player-card-main-active point-tree-player-v150">
                <div class="player-info player-info-name-first-card">
                  <div class="player-identity-block">
                    <strong class="player-name-fit ${getPlayerNameFitClass(player.name)}">${escapeHtml(player.name)}</strong>
                    ${renderPlayerTeamInline(player)}
                  </div>
                </div>
              </div>
              <span class="point-tree-order-v150">${selected ? `낮은 순위 ${order + 1}번째` : "순위 선택"}</span>
            </div>
          </button>
        `;
      }
      if (isManualLaneStage(stage)) {
        return `
          <div class="slot operator-slot-v227 ${selected ? "selected" : ""} round-final-manual-slot">
            <div class="slot-inner final-slot-actions round-final-slot-actions">
              ${renderPlayerCardMain(player, group)}
              <div class="final-card-actions round-final-card-actions">
                <button class="${selected ? "primary" : "ghost"}" onclick="toggleAdvance(${roundIndex}, ${stageIndex}, '${escapeAttr(group.id)}', '${escapeAttr(player.id)}')">${selected ? "선택 해제" : isCrowMode() ? "순위 선택" : "진출 선택"}</button>
                ${renderStageLaneTools(stage, group, player, roundIndex, stageIndex)}
              </div>
            </div>
          </div>
        `;
      }

      return `
        <button class="slot operator-slot-v227 ${selected ? "selected" : ""}" onclick="toggleAdvance(${roundIndex}, ${stageIndex}, '${escapeAttr(group.id)}', '${escapeAttr(player.id)}')">
          <div class="slot-inner slot-inner-name-first">
            ${renderPlayerCardMain(player, group)}
          </div>
        </button>
      `;
    }
    function initFirebase() {
      if (firebaseDb) return firebaseDb;
      try {
        if (!window.firebase || !firebase.initializeApp || !firebase.database) {
          firebaseOnline = false;
          return null;
        }
        firebaseApp = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDb = firebase.database();
        firebaseOnline = true;
        return firebaseDb;
      } catch (error) {
        firebaseOnline = false;
        console.warn("Firebase init failed", error);
        return null;
      }
    }

    function queueFirebaseSave() {
      if (firebaseApplyingRemote) return;
      if (state.tournament?.status !== "running" && state.tournament?.status !== "finished" && state.tournament?.status !== "archived") {
        persistCurrentState();
        return;
      }
      clearTimeout(firebaseSaveTimer);
      firebaseSaveTimer = setTimeout(() => {
        forceLiveBroadcastSync("queued");
      }, 250);
    }

    function forceLiveBroadcastSync(reason = "manual") {
      if (firebaseApplyingRemote) return Promise.resolve(false);
      ensureStateDefaults();
      state.updatedAt = Date.now();
      state.activeRoundIndex = activeRoundIndex;
      if (state.tournament.status === "running") {
        state.settings.firebaseAutoSave = true;
        activateAutoLiveSession();
      }
      const privateState = exportState();
      privateState.updatedAt = state.updatedAt;
      safeSetItem(STORAGE_KEY, JSON.stringify(privateState));

      const db = initFirebase();
      if (!db) {
        firebaseOnline = false;
        window.__mini4wdFirebaseLastError = "저장 연결 준비 안됨";
        console.warn("Firebase is not ready.");
        return Promise.resolve(false);
      }
      const id = getCurrentTournamentId();
      const publicLive = makePublicLivePayload(privateState);
      publicLive.syncReason = reason;
      const serverTs = firebase.database.ServerValue.TIMESTAMP;
      const writes = [
        writeFreshLiveValueV272(db, `tournaments/${id}/state`, privateState, reason),
        db.ref(`tournaments/${id}/updatedAt`).set(serverTs),
        writeFreshLiveValueV272(db, `${PUBLIC_LIVE_PATH}/${id}`, publicLive, reason)
      ];
      return Promise.allSettled(writes).then(results => {
        const failed = results.filter(r => r.status === "rejected");
        if (failed.length) {
          firebaseOnline = false;
          window.__mini4wdFirebaseLastError = failed[0].reason?.message || String(failed[0].reason || "저장 실패");
          console.warn("Firebase live sync partial failure", failed);
          return false;
        }
        firebaseOnline = true;
        window.__mini4wdFirebaseLastSavedAt = Date.now();
        window.__mini4wdFirebaseLastError = "";
        return true;
      });
    }

    function publishLiveStateFallbackV269(reason = "operator-fallback") {
      try {
        if (firebaseApplyingRemote) return Promise.resolve(false);
        if (typeof window.__mini4wdCanPublishLiveNowV270 === "function" && !window.__mini4wdCanPublishLiveNowV270(reason)) {
          return Promise.resolve(false);
        }
        ensureStateDefaults();
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        if (state.tournament.status === "running") {
          state.settings.firebaseAutoSave = true;
          activateAutoLiveSession();
        }
        const privateState = exportState();
        privateState.updatedAt = state.updatedAt;
        safeSetItem(STORAGE_KEY, JSON.stringify(privateState));
        const db = initFirebase();
        if (!db) return Promise.resolve(false);
        const id = getCurrentTournamentId();
        const publicLive = makePublicLivePayload(privateState);
        publicLive.syncReason = reason;
        return Promise.all([
          writeFreshLiveValueV272(db, `tournaments/${id}/state`, privateState, reason),
          db.ref(`tournaments/${id}/updatedAt`).set(firebase.database.ServerValue.TIMESTAMP),
          writeFreshLiveValueV272(db, `${PUBLIC_LIVE_PATH}/${id}`, publicLive, reason)
        ]).then(() => {
          firebaseOnline = true;
          window.__mini4wdFirebaseLastSavedAt = Date.now();
          window.__mini4wdFirebaseLastError = "";
          return true;
        }).catch(error => {
          firebaseOnline = false;
          window.__mini4wdFirebaseLastError = error?.message || String(error || "fallback sync failed");
          console.warn("v269 live fallback sync failed", error);
          return false;
        });
      } catch (error) {
        console.warn("v269 live fallback sync failed", error);
        return Promise.resolve(false);
      }
    }

    function syncOperatorLiveStateV269(reason = "operator") {
      let result = null;
      try {
        result = forceLiveBroadcastSync(reason);
      } catch (error) {
        console.warn("operator live sync threw", error);
        return publishLiveStateFallbackV269(`${reason}-fallback`);
      }
      Promise.resolve(result).then(ok => {
        if (ok) return;
        setTimeout(() => publishLiveStateFallbackV269(`${reason}-fallback`), 450);
      }).catch(error => {
        console.warn("operator live sync failed", error);
        setTimeout(() => publishLiveStateFallbackV269(`${reason}-fallback`), 450);
      });
      return result;
    }

function firebaseStatusText() {
      const id = escapeHtml(getCurrentTournamentId());
      if (window.__mini4wdFirebaseLastError) return `오류 · ${id} · ${escapeHtml(window.__mini4wdFirebaseLastError)}`;
      if (window.__mini4wdFirebaseLastSavedAt) return `연결됨 · ${id} · 저장 ${escapeHtml(formatDateTimeLocal(new Date(window.__mini4wdFirebaseLastSavedAt)))}`;
      return firebaseOnline ? `연결됨 · ${id}` : `대기 · ${id}`;
    }

function currentActorLabel() {
      return currentAuthUser?.email || currentUserProfile?.email || "local";
    }

    function getOperationLock() {
      ensureStateDefaults();
      return state.tournament.operationLock || null;
    }

    function isOperationLockedByOther() {
      const lock = getOperationLock();
      if (!lock || !lock.uid) return false;
      if (lock.expiresAt && Date.now() > Number(lock.expiresAt)) return false;
      return Boolean(currentAuthUser?.uid && lock.uid !== currentAuthUser.uid);
    }

    function operationLockText() {
      const lock = getOperationLock();
      if (!lock || !lock.uid) return { on: false, text: "운영권 없음" };
      if (lock.expiresAt && Date.now() > Number(lock.expiresAt)) return { on: false, text: "운영권 만료" };
      return { on: true, text: `운영권 사용 중 · ${lock.email || lock.uid}` };
    }

    function canModifyTournamentAction(actionName = "이 작업") {
      if (isOperationLockedByOther()) {
        const lock = getOperationLock();
        alert(`${actionName}은 현재 ${lock.email || lock.uid} 사용자가 운영 중이라 실행할 수 없습니다.`);
        return false;
      }
      return true;
    }

    function acquireOperationLock() {
      ensureStateDefaults();
      const lock = getOperationLock();
      if (lock?.uid && lock.uid !== currentAuthUser?.uid && (!lock.expiresAt || Date.now() < Number(lock.expiresAt))) {
        return alert(`이미 ${lock.email || lock.uid} 사용자가 운영 중입니다.`);
      }
      state.tournament.operationLock = {
        uid: currentAuthUser?.uid || "local",
        email: currentActorLabel(),
        lockedAt: new Date().toISOString(),
        expiresAt: Date.now() + (6 * 60 * 60 * 1000)
      };
      logTournamentAction("운영권", "운영권 설정");
      renderOperator();
    }

    function releaseOperationLock(force = false) {
      ensureStateDefaults();
      const lock = getOperationLock();
      if (!lock?.uid) return;
      if (!force && lock.uid !== (currentAuthUser?.uid || "local") && !isAdminUser()) return alert("운영권 해제 권한이 없습니다.");
      state.tournament.operationLock = null;
      logTournamentAction(force ? "운영권 강제해제" : "운영권 해제", "운영권 해제");
      renderOperator();
    }

    function currentSnapshotKey() {
      return `${currentVenueId()}::${getCurrentTournamentId()}`;
    }

    function loadSnapshotMap() {
      try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_SNAPSHOT_KEY) || "{}");
        if (Array.isArray(raw)) {
          const migrated = {};
          raw.forEach(item => {
            const key = item?.tournamentId || item?.state?.tournament?.id || currentSnapshotKey();
            migrated[key] = item;
          });
          return migrated;
        }
        return raw && typeof raw === "object" ? raw : {};
      } catch (e) { return {}; }
    }

    function loadSnapshots() {
      const snap = loadSnapshotMap()[currentSnapshotKey()];
      return snap ? [snap] : [];
    }

    let lastAutoSnapshotAt = 0;
    function createAutoSnapshot(label = "자동 저장") {
      if (!state || !state.tournament) return;
      // Only record snapshots when the tournament is actively running.
      if (state.tournament.status !== "running") return;
      const now = Date.now();
      if (label === "자동 저장" && now - lastAutoSnapshotAt < 60000) return;
      lastAutoSnapshotAt = now;
      const key = currentSnapshotKey();
      const snapshot = {
        id: `snap-${key}`,
        key,
        tournamentId: getCurrentTournamentId(),
        label,
        createdAt: new Date().toISOString(),
        state: exportState()
      };
      // Persist only the most recent backup for this tournament.
      safeSetItem(LOCAL_SNAPSHOT_KEY, JSON.stringify({ [key]: snapshot }));
    }

    function loadOperatorUndoSnapshotV266() {
      try {
        const snap = JSON.parse(localStorage.getItem(OPERATOR_UNDO_STORAGE_KEY_V266) || "null");
        if (!snap || typeof snap !== "object" || !snap.state) return null;
        if (snap.key && snap.key !== currentSnapshotKey()) return null;
        return snap;
      } catch (error) {
        return null;
      }
    }

    function hasOperatorUndoSnapshotV266() {
      return Boolean(loadOperatorUndoSnapshotV266());
    }

    function captureOperatorUndoSnapshotV266(label = "직전 작업") {
      try {
        if (!state || !state.tournament) return false;
        ensureStateDefaults();
        const snapshot = {
          id: `undo-${Date.now()}`,
          key: currentSnapshotKey(),
          tournamentId: getCurrentTournamentId(),
          label,
          createdAt: new Date().toISOString(),
          activeRoundIndex,
          state: exportState()
        };
        return safeSetItem(OPERATOR_UNDO_STORAGE_KEY_V266, JSON.stringify(snapshot));
      } catch (error) {
        console.warn("operator undo snapshot failed", error);
        return false;
      }
    }

    function clearOperatorUndoSnapshotV266() {
      try { localStorage.removeItem(OPERATOR_UNDO_STORAGE_KEY_V266); } catch (error) {}
    }

    function restoreOperatorUndoV266() {
      const snap = loadOperatorUndoSnapshotV266();
      if (!snap) return alert("되돌릴 직전 작업이 없습니다.");
      if (!confirm(`${snap.label || "직전 작업"} 이전 상태로 되돌릴까요?`)) return;
      state = normalizeImportedState(snap.state);
      activeRoundIndex = Math.max(0, Math.min(Number(snap.activeRoundIndex ?? state.activeRoundIndex ?? 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
      state.activeRoundIndex = activeRoundIndex;
      clearOperatorUndoSnapshotV266();
      persistCurrentState();
      if (state.tournament?.status === "running") {
        queueFirebaseSave();
        forceLiveBroadcastSync("operator-undo-v266");
      }
      renderOperator();
      requestAnimationFrame(() => document.getElementById("operatorMatchAreaV147")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }

    function renderOperatorUndoFloatV266(isMobileOperatorView) {
      if (!isMobileOperatorView || !hasOperatorUndoSnapshotV266()) return "";
      return `<button type="button" class="operator-undo-float-v266" onclick="restoreOperatorUndoV266()" aria-label="직전 작업 되돌리기">되돌리기</button>`;
    }

    function refreshOperatorUndoFloatV266() {
      const existing = document.querySelector(".operator-undo-float-v266");
      const isMobileOperatorView = document.body.classList.contains("ui-mode-mobile") && document.body.classList.contains("ui-page-operator");
      if (!isMobileOperatorView || !hasOperatorUndoSnapshotV266()) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      const dock = document.querySelector(".operator-mobile-dock-v233");
      if (dock) dock.insertAdjacentHTML("beforebegin", renderOperatorUndoFloatV266(true));
    }


    function normalizeImportedState(imported) {
      const base = makeInitialState(Number(imported?.settings?.laneCount || state?.settings?.laneCount || 3));
      const next = {
        ...base,
        ...(imported || {}),
        settings: { ...base.settings, ...(imported?.settings || {}) },
        tournament: { ...base.tournament, ...(imported?.tournament || {}) },
        qualifierRounds: Array.isArray(imported?.qualifierRounds) ? imported.qualifierRounds : base.qualifierRounds,
        finalRace: imported?.finalRace || null,
        broadcast: { ...base.broadcast, ...(imported?.broadcast || {}) },
        updatedAt: imported?.updatedAt || Date.now()
      };
      next.tournament.raceClass = normalizeRaceClassName(next.tournament.raceClass || "오픈");
      if (next.tournament.status === undefined) next.tournament.status = next.tournament.startedAtISO ? "running" : "draft";
      return next;
    }



    /* v95: refresh-safe local recovery. This is synchronous and runs before screen render. */
    let persistedStateLoadedV95 = false;
    function restorePersistedStateV95() {
      if (persistedStateLoadedV95) return false;
      persistedStateLoadedV95 = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("mini4wdTournamentLastSafeStateV95") || "";
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return false;
        state = normalizeImportedState(parsed);
        activeRoundIndex = Math.max(0, Math.min(Number(state.activeRoundIndex || 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
        state.activeRoundIndex = activeRoundIndex;
        persistCurrentState();
        return true;
      } catch (error) {
        console.warn("v95 persisted state restore failed", error);
        return false;
      }
    }

    function flushStateBeforeUnloadV95(reason = "pagehide") {
      try {
        if (!state || !state.settings || !state.tournament) return false;
        ensureStateDefaults();
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        const payload = exportState();
        const json = JSON.stringify(payload);
        safeSetItem(STORAGE_KEY, json);
        safeSetItem("mini4wdTournamentLastSafeStateV95", json);
        safeSetItem("mini4wdTournamentLastSafeStateV95Reason", String(reason));
        safeSetItem("mini4wdTournamentLastSafeStateV95At", new Date().toISOString());
        if (state.tournament.status === "running") {
          createAutoSnapshot("새로고침 전 자동 백업");
          queueFirebaseSave();
        }
        return true;
      } catch (error) {
        console.warn("v95 unload flush failed", error);
        return false;
      }
    }

    if (!window.__mini4wdUnloadBackupBound) {
      window.__mini4wdUnloadBackupBound = true;
      window.addEventListener("pagehide", () => flushStateBeforeUnloadV95("pagehide"));
      window.addEventListener("beforeunload", () => flushStateBeforeUnloadV95("beforeunload"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushStateBeforeUnloadV95("visibilitychange:hidden");
      });
    }

    function createManualSnapshot() {
      createAutoSnapshot("현재 저장");
      alert("현재 대회 ID 기준으로 마지막 상태를 저장했습니다.");
      renderOperator();
    }

    function restoreSnapshot(snapshotId) {
      const snap = loadSnapshots().find(item => item.id === snapshotId || item.key === snapshotId);
      if (!snap) return alert("복구할 백업을 찾지 못했습니다.");
      if (!confirm(`${snap.label} / ${formatSnapshotTime(snap.createdAt)} 상태로 복구할까요?`)) return;
      state = normalizeImportedState(snap.state);
      activeRoundIndex = state.activeRoundIndex || 0;
      persistCurrentState();
      logTournamentAction("백업 복구", snap.label || "snapshot");
      renderOperator();
    }

    function formatSnapshotTime(value) {
      if (!value) return "-";
      try { return new Date(value).toLocaleString("ko-KR"); } catch (e) { return value; }
    }

    function renderOperationPanel() {
      const lock = operationLockText();
      const snapshots = loadSnapshots().slice(0, 3);
      return `<section class="ops-panel"><div class="ops-row"><div><strong>저장과 복구</strong><br><span class="${lock.on ? 'lock-on' : 'lock-off'}">${escapeHtml(lock.text)}</span></div><div class="ops-buttons"><button class="${lock.on ? 'ghost' : 'primary'}" onclick="acquireOperationLock()">운영권 잡기</button><button class="ghost" onclick="releaseOperationLock(false)">운영권 해제</button><button class="ghost" onclick="createManualSnapshot()">현재 저장</button></div></div>${snapshots.length ? `<div class="snapshot-list">${snapshots.map(s => `<div class="snapshot-item"><span>${escapeHtml(s.label)} · ${escapeHtml(formatSnapshotTime(s.createdAt))}</span><button class="ghost" onclick="restoreSnapshot('${escapeAttr(s.id)}')">복구</button></div>`).join("")}</div>` : ""}</section>`;
    }

    function logTournamentAction(action, detail = "") {
      try {
        const entry = {
          action,
          detail,
          actorUid: currentAuthUser?.uid || "local",
          actorEmail: currentActorLabel(),
          venueId: currentVenueId(),
          venueName: currentVenueName(),
          tournamentId: getCurrentTournamentId(),
          tournamentName: state?.tournament?.name || "",
          createdAt: new Date().toISOString()
        };
        const key = `mini4wdActionLogs_${currentVenueId()}`;
        const local = JSON.parse(localStorage.getItem(key) || "[]");
        local.unshift(entry);
        safeSetItem(key, JSON.stringify(local.slice(0, 100)));
        const db = initFirebase();
        if (db && currentAuthUser) {
          db.ref(`${ACTION_LOG_PATH}/${entry.venueId}/${entry.tournamentId}`).push(entry)
            .then(() => scheduleActionLogPrune(entry.venueId, entry.tournamentId))
            .catch(() => {});
        }
      } catch (error) {}
    }

    function scheduleActionLogPrune(venueId, tournamentId) {
      const key = `${venueId || ""}/${tournamentId || ""}`;
      if (!venueId || !tournamentId) return;
      clearTimeout(actionLogPruneTimers.get(key));
      actionLogPruneTimers.set(key, setTimeout(() => {
        actionLogPruneTimers.delete(key);
        pruneActionLogsForTournament(venueId, tournamentId).catch(error => console.warn("action log prune skipped", error));
      }, ACTION_LOG_PRUNE_DEBOUNCE_MS));
    }

    async function pruneActionLogsForTournament(venueId, tournamentId, maxEntries = ACTION_LOG_MAX_PER_TOURNAMENT) {
      const db = initFirebase();
      if (!db || !currentAuthUser || !venueId || !tournamentId) return { removed: 0, reason: "unavailable" };
      const ref = db.ref(`${ACTION_LOG_PATH}/${venueId}/${tournamentId}`);
      const snapshot = await ref.orderByChild("createdAt").once("value");
      const entries = [];
      snapshot.forEach(child => {
        const value = child.val() || {};
        entries.push({ key: child.key, createdAt: value.createdAt || "" });
        return false;
      });
      const overflow = entries.length - Math.max(1, Number(maxEntries || ACTION_LOG_MAX_PER_TOURNAMENT));
      if (overflow <= 0) return { removed: 0, total: entries.length };
      const updates = {};
      entries
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
        .slice(0, overflow)
        .forEach(item => { if (item.key) updates[item.key] = null; });
      await ref.update(updates);
      return { removed: Object.keys(updates).length, total: entries.length };
    }

    try { window.pruneActionLogsForTournament = pruneActionLogsForTournament; } catch (error) {}

function renderTournamentStatusPanel() {
      ensureStateDefaults();
      const status = state.tournament.status || "draft";
      const finalResultReady = isTournamentFinalResultReady();
      const finishRequirement = getTournamentFinishRequirementText();
      const tournamentName = state.tournament.name || "대회명 미입력";
      const venueName = state.tournament.venue || currentVenueName() || "경기장 미입력";
      const raceClassName = normalizeRaceClassName(state.tournament.raceClass);
      const participantCount = parseParticipants().filter(p => p && !p.isEmptyLane).length;
      const missing = [];
      if (!String(state.tournament.name || "").trim()) missing.push("대회명");
      if (!String(state.tournament.venue || currentVenueName() || "").trim()) missing.push("경기장");

      const statusText = statusLabel(status);
      const statusNote = status === "draft"
        ? (missing.length ? `시작 전 ${missing.join(" / ")} 입력 필요` : "시작 가능")
        : status === "running"
          ? (finalResultReady ? "최종 결과 확정 · 대회 종료 가능" : `진행 중 · ${finishRequirement}`)
          : status === "finished"
            ? "종료됨 · 새 대회 준비 가능"
            : "저장 완료 · 새 대회 준비 가능";

      const actionButtons = status === "draft"
        ? `<button class="primary prep-main-action-v116" onclick="startTournament()">대회 시작</button>`
        : status === "running"
          ? (finalResultReady
            ? `<button class="primary prep-main-action-v116" onclick="finishTournament()">대회 종료</button>`
            : `<span class="tournament-finish-wait-v142">${escapeHtml(finishRequirement)}</span>`)
          : `<button class="primary prep-main-action-v116" onclick="prepareNewTournamentFromFinished()">새 대회 준비</button><button class="ghost prep-sub-action-v116" onclick="reopenTournament()">종료 취소</button>`;

      return `
        <div class="prep-hero-v116 prep-hero-v143">
          <div class="prep-topline-v116">
            <span>대회 정보</span>
            <span class="status-badge status-${status}">${statusText}</span>
          </div>
          <div class="prep-action-v116">${actionButtons}</div>
          ${(state.tournament.startedAtDisplay || state.tournament.endedAtDisplay) ? `<div class="prep-time-row-v116 prep-status-meta-v143">
            ${state.tournament.startedAtDisplay ? `<span>시작 ${escapeHtml(state.tournament.startedAtDisplay)}</span>` : ""}
            ${state.tournament.endedAtDisplay ? `<span>종료 ${escapeHtml(state.tournament.endedAtDisplay)}</span>` : ""}
          </div>` : ""}
        </div>
      `;
    }
function avoidanceLabel(level) {
      return { none: "없음", low: "낮음", medium: "보통", high: "높음" }[level] || level;
    }

    function computePointTotalsUpToStage(round, uptoStageIndex = Infinity) {
      const totals = new Map();
      (round.stages || []).forEach((stage, stageIndex) => {
        if (stageIndex > uptoStageIndex || stage.type !== "points") return;
        stage.groups.forEach(group => {
          group.slots.forEach(player => {
            if (player.isEmptyLane) return;
            const current = totals.get(player.id) || { id: player.id, name: player.name, team: player.team, total: 0, heats: [] };
            const score = Number((group.points || {})[player.id] ?? 0);
            current.total += score;
            current.heats.push({ stage: stage.name, score });
            totals.set(player.id, current);
          });
        });
      });
      return Array.from(totals.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
    }

    function getPointLeadersWithTies(totals, rankLimit = 3) {
      if (!totals.length) return [];
      const cutoffIndex = Math.min(rankLimit, totals.length) - 1;
      const cutoffScore = totals[cutoffIndex]?.total ?? 0;
      return totals.filter(player => player.total >= cutoffScore);
    }

    function renderMobilePointLeaders(target) {
      if (!target || target.stageType !== "points" || !/^포인트\s*[0-9]+차전$/.test(String(target.stageName || "")) || !(target.pointLeaders || []).length) return "";
      return `
        <section class="final-box mobile-point-leaders-v144">
          <h2>포인트 TOP 3</h2>
          <div class="mobile-leader-list-v144">
            ${target.pointLeaders.map((player, index) => `
              <div class="mobile-leader-v144">
                <b>${index + 1}</b>
                <span class="mobile-leader-name-v144">${escapeHtml(player.name)}${player.team ? ` <em>${escapeHtml(player.team)}</em>` : ""}</span>
                <strong>${player.total}P</strong>
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }

    function renderTvPointLeaders(target) {
      if (target.stageType !== "points" || !/^포인트\s*[0-9]+차전$/.test(String(target.stageName || "")) || !target.pointLeaders?.length) return "";
      return `
        <section class="tv-point-leaders">
          <div class="tv-point-leaders-title">포인트 TOP 3</div>
          <div class="tv-point-leaders-list">
            ${target.pointLeaders.map((player, index) => `
              <div class="tv-point-leader">
                <b>${index + 1}</b>
                <span>${escapeHtml(player.name)}${player.team ? ` / ${escapeHtml(player.team)}` : ""}</span>
                <strong>${player.total}P</strong>
              </div>
            `).join("")}
          </div>
        </section>
      `;
    }
    function renderTvSnapshot(payload, viewType = "tv") {
      tvState = payload;

      if (viewType === "mobile") {
        renderMobileSnapshot(payload);
        return;
      }

      document.body.classList.add("tv-mode");
      renderTvStage();
    }

    function renderMobileSnapshot(payload) {
      setUiSurfaceV149("mobile-live");
      resetMetricCacheV122();
      document.body.classList.remove("tv-mode");
      const target = getBroadcastTarget(payload);

      app.innerHTML = `
        <div class="mobile-view">
          ${renderUnifiedPageHeaderV173({
            className: "mobile-live-titlebar-v173",
            kicker: "모바일 LIVE",
            title: payload.tournament?.name || "대회명 미입력",
            description: `${matchModeLabel(payload.settings?.matchMode)} · ${payload.settings?.laneCount || 3}레인 · ${payload.tournament?.venue || ""}`,
            stats: [
              { label: "현재", value: target?.title || "대기" },
              { label: "경기장", value: payload.tournament?.venue || "미입력" },
              { label: "라운드", value: `${(payload.qualifierRounds || []).length}개` }
            ]
          })}

          ${target ? `
            <section class="final-box mobile-current">
              <h2>현재 진행</h2>
              <p class="hint">${escapeHtml(target.title)}</p>
              <div class="groups" >
                ${target.groups.map(group => target.stageType === "points" ? renderReadOnlyPointGroup(group, { type: "points" }, target.pointTotalsMap) : renderReadOnlyGroup(group, target.isFinal)).join("")}
              </div>
            </section>
            ${renderMobilePointLeaders(target)}
          ` : ""}

          <details class="mobile-history" open>
            <summary>경기 진행 히스토리</summary>
            ${renderMobileHistory(payload)}
          </details>
        </div>
      `;
    }

    function renderMobileHistory(payload) {
      const rounds = payload.qualifierRounds || [];
      return `
        <div class="history-mobile-list">
          ${rounds.map(round => `
            <section class="history-round">
              <div class="history-round-head">
                <strong>${escapeHtml(round.title)}</strong>
                <span>${round.finalist ? `확정 · ${escapeHtml(round.finalist.name)}` : round.stages?.length ? "진행중" : "미진행"}</span>
              </div>
              ${(round.stages || []).map(stage => `
                <details class="history-stage">
                  <summary>${escapeHtml(stage.name)} · ${stage.groups.length}개 조</summary>
                  <div class="history-stage-body">
                    ${stage.groups.map(group => {
                      const selectedNames = (group.advanceIds || [])
                        .map(id => group.slots.find(slot => slot.id === id))
                        .filter(Boolean)
                        .map(player => player.name);
                      return `
                        <div class="history-group-line">
                          <b>${escapeHtml(group.name)}</b>
                          <span>${stage.type === "points" ? "포인트전" : selectedNames.length ? `진출: ${escapeHtml(selectedNames.join(", "))}` : "진출자 미선택"}</span>
                        </div>
                      `;
                    }).join("")}
                  </div>
                </details>
              `).join("") || `<div class="hint">아직 진행 전입니다.</div>`}
            </section>
          `).join("")}
        </div>
      `;
    }

function getTvWindowGroups(target) {
      const groups = target?.groups || [];
      if (!groups.length) return { groups: [], mode: "empty", startIndex: 0, currentIndex: 0, pageCount: 1 };

      const pageSize = Math.max(1, Number(tvGroupsPerPage) || 3);
      const groupHasProgress = group => {
        if ((group.advanceIds || []).length > 0) return true;
        if (target?.stageType === "points") {
          return Object.values(group.points || {}).some(value => value !== "" && value != null && Number(value) >= 0);
        }
        return false;
      };
      const lastProgressIndex = groups.reduce((last, group, index) => groupHasProgress(group) ? index : last, -1);
      const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));

      if (lastProgressIndex < 0) {
        tvPage = Math.max(0, Math.min(tvPage || 0, pageCount - 1));
        const startIndex = tvPage * pageSize;
        return {
          groups: groups.slice(startIndex, startIndex + pageSize),
          mode: "pending",
          startIndex,
          currentIndex: startIndex,
          pageCount
        };
      }

      let startIndex = lastProgressIndex;
      if (startIndex + pageSize > groups.length) startIndex = Math.max(0, groups.length - pageSize);
      return {
        groups: groups.slice(startIndex, startIndex + pageSize),
        mode: "focus",
        startIndex,
        currentIndex: Math.min(lastProgressIndex + 1, groups.length - 1),
        pageCount
      };
    }

    function getTv90NameClass(name) {
      const text = String(name || "").trim();
      const length = Array.from(text).length;
      if (text.includes("..")) return "is-truncated";
      if (length <= 2) return "is-short";
      if (length <= 4) return "is-medium";
      return "is-truncated";
    }

    function renderTv90Lane(player, group, isFinal, stageType = "normal", pointTotalsMap = {}) {
      const lane = Number(player?.lane || 0) || "";
      if (!player || player.isEmptyLane) {
        return `
          <div class="tv90-lane is-empty">
            <div class="tv90-lane-meta"><div class="tv90-lane-main"><span class="tv90-lane-no">${escapeHtml(lane || "-")}</span><span class="tv90-lane-word">LANE</span></div><div class="tv90-rate">오늘 -</div></div>
            <div class="tv90-player"><div class="tv90-name is-long">빈 레인</div><div class="tv90-team">대기</div></div>
            <div class="tv90-h2h"><div class="tv90-h2h-title">최근전적</div><div class="tv90-h2h-row">-</div></div>
            <div class="tv90-result"></div>
          </div>`;
      }
      const selected = (group?.advanceIds || []).includes(player.id);
      const pointValue = Number(pointTotalsMap?.[player.id] ?? (group?.points || {})[player.id] ?? 0);
      const resultText = stageType === "points" ? `${pointValue}P` : "";
      const stats = getGroupMatchStatsForPlayer(player, group || {});
      const rows = (stats.h2h || []).slice(0, 2).map(item => {
        const label = item.matches ? `${item.name} ${item.wins}-${item.losses}` : `${item.name} -`;
        return `<div class="tv90-h2h-row" title="${escapeAttr(label)}">${escapeHtml(label)}</div>`;
      }).join("") || `<div class="tv90-h2h-row">상대전적 없음</div>`;
      const displayName = String(player.name || "").trim();
      return `
        <div class="tv90-lane ${selected ? "is-selected" : ""}">
          <div class="tv90-lane-meta"><div class="tv90-lane-main"><span class="tv90-lane-no">${escapeHtml(lane)}</span><span class="tv90-lane-word">LANE</span></div><div class="tv90-rate">오늘 ${escapeHtml(getDisplayLaneWinRate(lane, player))}</div></div>
          <div class="tv90-player"><div class="tv90-name ${getTv90NameClass(displayName)}" title="${escapeAttr(player.name || "")}">${escapeHtml(displayName || "-")}</div>${player.team ? `<div class="tv90-team" title="${escapeAttr(player.team)}">${escapeHtml(player.team)}</div>` : `<div class="tv90-team">팀명 없음</div>`}</div>
          <div class="tv90-h2h"><div class="tv90-h2h-title">최근전적</div>${rows}</div>
          <div class="tv90-result ${stageType === "points" ? "is-point-v143" : ""}">${escapeHtml(resultText)}</div>
        </div>`;
    }

function renderTvStage() {
      setUiSurfaceV149("tv-live");
      resetMetricCacheV122();
      const target = getBroadcastTarget(tvState);
      document.body.classList.add("tv-mode");
      if (!target) {
        app.innerHTML = `
          <div class="tv-wrap tv90-screen">
            <header class="tv90-header">
              <div class="tv90-brand">
                <div class="tv90-kicker"><small>MINI4WD TOURNAMENT MAKER</small><span class="tv90-mode-pill">LIVE 대기</span></div>
                <h1 class="tv90-title">대진표 없음</h1>
                <div class="tv90-subtitle">현재 송출할 라운드가 없습니다.</div>
              </div>
              ${logoMarkup("tv90-logo")}
            </header>
            <section class="tv90-empty-screen"><div><h2>LIVE 대기중</h2><p>운영 화면에서 경기를 시작하면 자동으로 표시됩니다.</p></div></section>
            <footer class="tv90-foot"><span>MINI4WD TOURNAMENT MAKER</span><span>${escapeHtml(mini4wdBuildLabel())}</span></footer>
          </div>`;
        return;
      }
      const windowInfo = getTvWindowGroups(target);
      const currentGroups = [...(windowInfo.groups || [])];
      const laneCount = Number(target.laneCount || state?.settings?.groupSize || 3) || 3;
      while (currentGroups.length < 3) {
        const nextNo = (windowInfo.startIndex || 0) + currentGroups.length + 1;
        currentGroups.push({ id: `tv-placeholder-${currentGroups.length}`, name: `대기 ${nextNo}조`, slots: [], advanceIds: [], isPlaceholder: true, laneCount });
      }
      const shownCount = Math.min((windowInfo.groups || []).length || 0, 3);
      const modeLabel = windowInfo.mode === "pending"
        ? `진행 대기 · ${(windowInfo.startIndex || 0) + 1}-${(windowInfo.startIndex || 0) + Math.max(shownCount, 1)}조`
        : `진행 포커스 · ${(windowInfo.startIndex || 0) + 1}-${(windowInfo.startIndex || 0) + Math.max(shownCount, 1)}조`;
      const tvTournamentName = target.tournamentName || tvState?.tournament?.name || "";
      const title = tvTournamentName || target.title || "LIVE";
      const subtitle = tvTournamentName ? target.title : "LIVE 자동 송출";
      app.innerHTML = `
        <div class="tv-wrap tv90-screen" data-tv-lanes="${laneCount}">
          <header class="tv90-header">
            <div class="tv90-brand">
              <div class="tv90-kicker"><small>MINI4WD TOURNAMENT MAKER</small><span class="tv90-mode-pill">${escapeHtml(modeLabel)}</span></div>
              <h1 class="tv90-title" title="${escapeAttr(title)}">${escapeHtml(title)}</h1>
              <div class="tv90-subtitle" title="${escapeAttr(subtitle)}">${escapeHtml(subtitle)}</div>
            </div>
            ${logoMarkup("tv90-logo")}
          </header>
          <main class="tv90-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
            ${currentGroups.slice(0, 3).map(group => renderTvGroup(group, target.isFinal, target.stageType, target.pointTotalsMap, laneCount)).join("")}
          </main>
          ${renderTvPointLeaders(target)}
          <footer class="tv90-foot"><span>${escapeHtml(laneCount)} LANE · ${escapeHtml((target.groups || []).length)} GROUPS · LIVE 자동 송출</span><span>${escapeHtml(mini4wdBuildLabel())}</span></footer>
        </div>`;
    }


    function renderTvGroup(group, isFinal, stageType = "normal", pointTotalsMap = {}, laneCountOverride = null) {
      const laneCount = Number(laneCountOverride || group?.laneCount || state?.settings?.groupSize || 3) || 3;
      if (group?.isPlaceholder) {
        return `
          <article class="tv90-group tv90-placeholder" data-lanes="${laneCount}">
            <div class="tv90-group-head"><div class="tv90-group-title">${escapeHtml(group.name || "대기")}</div><span class="tv90-badge">대기</span></div>
            <div class="tv90-placeholder-body"><div>다음 경기 대기</div></div>
          </article>`;
      }
      const slots = Array.isArray(group?.slots) ? group.slots.slice(0, laneCount) : [];
      while (slots.length < laneCount) slots.push({ id: `empty-${group?.id || "group"}-${slots.length + 1}`, lane: slots.length + 1, isEmptyLane: true, name: "빈 레인" });
      const activeCount = slots.filter(slot => slot && !slot.isEmptyLane).length;
      return `
        <article class="tv90-group tv90-group-${escapeAttr(stageType || "stage")}" data-lanes="${laneCount}">
          <div class="tv90-group-head">
            <div class="tv90-group-title" title="${escapeAttr(group?.name || "")}">${escapeHtml(group?.name || "경기")}</div>
            <span class="tv90-badge">${activeCount}명 경기</span>
          </div>
          ${slots.map(player => renderTv90Lane(player, group, isFinal, stageType, pointTotalsMap)).join("")}
        </article>`;
    }

function renderReadOnlyPointGroup(group, stage, pointTotalsMap) {
      const pointMap = group.points || {};
      const scoredValues = (group.slots || [])
        .filter(player => player && !player.isEmptyLane && Object.prototype.hasOwnProperty.call(pointMap, player.id))
        .map(player => Number(pointMap[player.id]))
        .filter(Number.isFinite);
      const topScore = scoredValues.length ? Math.max(...scoredValues) : null;
      const topScoreCount = topScore == null ? 0 : scoredValues.filter(score => score === topScore).length;
      return `
        <article class="group">
          <div class="group-title"><strong>${escapeHtml(group.name)}</strong><span class="badge">포인트전</span></div>
          ${group.slots.map(player => {
            if (player.isEmptyLane) {
              return `
                <div class="slot empty-lane" style="cursor:default;">
                  <div class="slot-inner slot-inner-name-first">
                    ${renderPlayerCardMain(player, group)}
                  </div>
                </div>
              `;
            }
            const rawScore = pointMap[player.id];
            const hasHeatScore = Object.prototype.hasOwnProperty.call(pointMap, player.id) && rawScore !== "" && rawScore != null;
            const heatScore = hasHeatScore ? Number(rawScore) : null;
            const totalScore = Number(pointTotalsMap?.[player.id] ?? heatScore ?? 0);
            const hasValidHeatScore = Number.isFinite(heatScore);
            const isTopPoint = hasValidHeatScore && topScore != null && heatScore === topScore && topScoreCount === 1 && heatScore > 0;
            const totalText = pointTotalsMap && Number.isFinite(totalScore) && hasValidHeatScore && totalScore !== heatScore ? `<small>누적 ${escapeHtml(totalScore)}P</small>` : "";
            const scoreBadge = hasValidHeatScore ? `<span class="mobile-point-result-v175 ${isTopPoint ? "is-top-v175" : ""}"><b>${escapeHtml(heatScore)}P</b>${isTopPoint ? "<em>1위</em>" : ""}${totalText}</span>` : "";
            return `
              <div class="slot ${isTopPoint ? "is-point-winner-v175" : ""}" style="cursor:default;">
                <div class="slot-inner slot-inner-name-first">
                  ${renderPlayerCardMain(player, group)}
                  ${scoreBadge}
                </div>
              </div>
            `;
          }).join("")}
        </article>
      `;
    }

    function renderReadOnlyGroup(group, isFinal) {
      return `
        <article class="group">
          <div class="group-title"><strong>${escapeHtml(group.name)}</strong><span class="badge">${group.slots.filter(slot => !slot.isEmptyLane).length}명 경기</span></div>
          ${group.slots.map(player => {
            if (player.isEmptyLane) {
              return `
                <div class="slot empty-lane" style="cursor:default;">
                  <div class="slot-inner slot-inner-name-first">
                    ${renderPlayerCardMain(player, group)}
                  </div>
                </div>
              `;
            }

            const selected = (group.advanceIds || []).includes(player.id);
            return `
              <div class="slot ${selected ? "selected" : ""}" style="cursor:default;">
                <div class="slot-inner slot-inner-name-first">
                  ${renderPlayerCardMain(player, group)}
                  ${selected ? `<span class="mobile-advance-result-v175">진출</span>` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </article>
      `;
    }

    // 보안/안정성 공통 헬퍼
    // slugId: 사용자 입력 이름을 ID에 안전한 문자셋으로 살균 (인라인 핸들러 XSS 차단)
    function slugId(value) {
      return String(value ?? "")
        .replace(/[^0-9A-Za-z\uAC00-\uD7A3-]/g, "_")  // 영숫자/한글/하이픈만 허용
        .slice(0, 40) || "x";
    }
    // safeSetItem: localStorage 용량초과(QuotaExceededError) 시에도 앱이 멈추지 않도록 래핑
    function safeSetItem(key, val) {
      try {
        localStorage.setItem(key, val);
        return true;
      } catch (e) {
        try { console.warn("localStorage 저장 실패(용량 초과 가능):", e && e.name); } catch (_) {}
        return false;
      }
    }
    function persistCurrentState() {
      return safeSetItem(STORAGE_KEY, JSON.stringify(exportState()));
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#096;");
    }

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !document.body.classList.contains("tv-mode")) return;
      try {
        tvState = JSON.parse(event.newValue);
        tvPage = 0;
        renderTvStage();
      } catch (error) {}
    });


    function openDbPage() {
      location.hash = "view=db";
      renderDbPage();
    }



function toggleRosterField(key, field) {
      const roster = loadRoster();
      let changedPlayer = null;
      const nextRoster = roster.map(player => {
        if (!rosterKeyMatches(player, key)) return player;
        changedPlayer = normalizeRosterPlayer({ ...player, [field]: !player[field] });
        return changedPlayer;
      });
      if (!changedPlayer) return;
      saveRoster(nextRoster);
      if (isAdminUser()) persistAdminRosterPlayer(changedPlayer);
      renderDbPage();
    }

    function deleteRosterPlayer(key) {
      const roster = loadRoster();
      const target = getRosterPlayerByKey(key, roster);
      if (!target) return alert("삭제할 선수를 찾지 못했습니다.");
      const label = `${target.venueName || target.venueId || "경기장"} · ${target.nickname || target.realName || target.name || "선수"}`;
      if (!confirm(`${label} 선수를 명부에서 삭제할까요?`)) return;
      const nextRoster = roster.filter(player => !rosterKeyMatches(player, key));
      dbSelectedIds.delete(rosterRecordKey(target));
      if (!String(key || "").includes("::")) dbSelectedIds.delete(String(key));
      saveRoster(nextRoster);
      if (isAdminUser()) removeAdminRosterPlayer(target);
      renderDbPage();
    }
function toggleDbSelected(key, checked) {
      if (checked) dbSelectedIds.add(key);
      else dbSelectedIds.delete(key);
      updateSelectedPreview();
    }
function selectFavoritePlayers() {
      dbSelectedIds = new Set(loadRoster().filter(player => player.favorite && player.active).map(rosterRecordKey));
      renderDbPage();
    }

    function selectRecentPlayers() {
      let ids = [];
      try {
        ids = JSON.parse(localStorage.getItem(RECENT_PARTICIPANTS_KEY) || "[]");
      } catch (error) {
        ids = [];
      }
      const roster = loadRoster();
      dbSelectedIds = new Set(ids.map(id => {
        const found = roster.find(player => rosterRecordKey(player) === id || player.id === id);
        return found ? rosterRecordKey(found) : id;
      }));
      renderDbPage();
    }

    function clearSelectedPlayers() {
      dbSelectedIds = new Set();
      renderDbPage();
    }




function setDbSearch(value) {
      dbSearchText = value;
      renderDbPage();
    }

    function setDbTeamFilter(value) {
      dbTeamFilter = value;
      renderDbPage();
    }

    function setDbStatusFilter(value) {
      dbStatusFilter = value;
      renderDbPage();
    }

    function setDbSort(field) {
      if (dbSortField === field) {
        dbSortDir = dbSortDir === "asc" ? "desc" : "asc";
      } else {
        dbSortField = field;
        dbSortDir = field === "createdAt" ? "desc" : "asc";
      }
      safeSetItem("mini4wdDbSortField", dbSortField);
      safeSetItem("mini4wdDbSortDir", dbSortDir);
      renderDbPage();
    }

    function rosterSortValue(player, field) {
      if (field === "favorite") return player.favorite ? 1 : 0;
      if (field === "active") return player.active ? 1 : 0;
      if (field === "venue") return String(player.venueName || player.venueId || "").toLowerCase();
      return String(player[field] || "").toLowerCase();
    }

    function getDbFilteredRoster(roster = loadRoster()) {
      const search = dbSearchText.trim().toLowerCase();
      const filtered = roster.filter(player => {
        const matchesSearch = !search || [player.realName, player.contact, player.name, player.team, player.nickname, player.memo, player.venueName, player.venueId].some(value => String(value || "").toLowerCase().includes(search));
        const matchesTeam = dbTeamFilter === "전체" || (player.team || "") === dbTeamFilter;
        const matchesStatus = dbStatusFilter === "전체"
          || (dbStatusFilter === "활성" && player.active)
          || (dbStatusFilter === "비활성" && !player.active)
          || (dbStatusFilter === "즐겨찾기" && player.favorite)
          || (dbStatusFilter === "연락처 있음" && contactStatusOf(player) === "verified")
          || (dbStatusFilter === "연락처 없음" && contactStatusOf(player) === "missing");
        return matchesSearch && matchesTeam && matchesStatus;
      });
      const dir = dbSortDir === "desc" ? -1 : 1;
      return filtered.sort((a, b) => {
        const av = rosterSortValue(a, dbSortField);
        const bv = rosterSortValue(b, dbSortField);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return String(a.nickname || a.realName || "").localeCompare(String(b.nickname || b.realName || ""), "ko");
      });
    }

    function selectVisiblePlayers() {
      getDbFilteredRoster().forEach(player => { if (player.active) dbSelectedIds.add(rosterRecordKey(player)); });
      renderDbPage();
    }

    function deselectVisiblePlayers() {
      getDbFilteredRoster().forEach(player => dbSelectedIds.delete(rosterRecordKey(player)));
      renderDbPage();
    }

    function selectAllActivePlayers() {
      dbSelectedIds = new Set(loadRoster().filter(player => player.active).map(rosterRecordKey));
      renderDbPage();
    }

    function toggleVisibleSelectAll(checked) {
      if (checked) selectVisiblePlayers();
      else deselectVisiblePlayers();
    }

    function dbSortButton(field, label) {
      const active = dbSortField === field;
      const mark = active ? (dbSortDir === "asc" ? " ▲" : " ▼") : "";
      return `<button class="${active ? "primary" : "ghost"}" onclick="setDbSort('${field}')">${label}${mark}</button>`;
    }

    function toCsv(rows) {
      return rows.map(row => row.map(value => {
        const text = String(value ?? "");
        return `"${text.replace(/"/g, '""')}"`;
      }).join(",")).join("\n");
    }

    function downloadTextFile(filename, text) {
      const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

function getTournamentMeta() {
      ensureStateDefaults();
      return {
        경기일시: state.tournament.startedAtDisplay || "",
        대회명: state.tournament.name || "",
        경기장: state.tournament.venue || "",
        클래스: normalizeRaceClassName(state.tournament.raceClass),
        경기방식: matchModeLabel(),
        레인수: `${state.settings.laneCount}레인`,
        대회상태: statusLabel(),
        종료일시: state.tournament.endedAtDisplay || ""
      };
    }

function exportTournamentJson() {
      ensureTournamentStarted();
      const payload = {
        meta: getTournamentMeta(),
        state: exportState(),
        rows: getStageResultRows()
      };
      downloadTextFile(`tournament_record_${Date.now()}.json`, JSON.stringify(payload, null, 2));
    }
function openPrintView() {
      saveLiveState();
      window.open(`${location.origin}${location.pathname}#view=print`, "_blank", "noopener,noreferrer");
    }

    function exportPrintExcel() {
      let payload = null;
      try {
        payload = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      } catch (error) {
        payload = exportState();
      }
      if (!payload) payload = exportState();

      const printable = getCurrentStageForPrint(payload);
      if (!printable || !printable.groups?.length) {
        alert("엑셀로 저장할 출력용 대진표가 없습니다.");
        return;
      }

      const meta = payload.tournament || {};
      const settings = payload.settings || {};
      const rows = [
        ["대회명", meta.name || ""],
        ["경기장", meta.venue || ""],
        ["클래스", normalizeRaceClassName(meta.raceClass)],
        ["경기일시", meta.startedAtDisplay || ""],
        ["경기방식", matchModeLabel(settings.matchMode)],
        ["레인수", `${settings.laneCount || 3}레인`],
        ["단계", printable.title || ""],
        [],
        ["조", "레인", "선수명"]
      ];

      printable.groups.forEach(group => {
        group.slots.forEach(slot => {
          rows.push([group.name, `${slot.lane}LANE`, slot.isEmptyLane ? "빈 레인" : slot.name]);
        });
      });

      const filename = `print_bracket_${Date.now()}.xlsx`;

      if (window.XLSX) {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 28 }];
        XLSX.utils.book_append_sheet(wb, ws, "출력용대진표");
        XLSX.writeFile(wb, filename);
      } else {
        downloadTextFile(filename.replace(".xlsx", ".csv"), toCsv(rows));
      }
    }

    function renderPrintView() {
      setUiSurfaceV149("print");
      document.body.classList.remove("tv-mode");
      document.body.classList.remove("operator-light-page-v95");
      let payload = null;
      try {
        payload = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
      } catch (error) {
        payload = exportState();
      }
      if (!payload) payload = exportState();

      const printable = getCurrentStageForPrint(payload);
      const meta = payload.tournament || {};
      const settings = payload.settings || {};
      const groups = printable?.groups || [];
      const actualCount = groups.reduce((sum, group) => sum + group.slots.filter(slot => !slot.isEmptyLane).length, 0);
      const densityClass = groups.length >= 36 ? "print-ultra" : groups.length >= 24 ? "print-compact" : groups.length >= 12 ? "print-medium" : "print-wide";

      app.innerHTML = `
        <div class="print-page ${densityClass}">
          <div class="print-controls">
            <button onclick="window.print()">인쇄</button>
            <button onclick="exportPrintExcel()">엑셀 다운로드</button>
            <button onclick="location.hash=''; bootV33()">운영 화면</button>
          </div>

          <header class="print-header">
            <div>
              <h1>${escapeHtml(meta.name || "대회명 미입력")}</h1>
              <p>${escapeHtml(meta.venue || "경기장 미입력")} · ${escapeHtml(normalizeRaceClassName(meta.raceClass))} · ${escapeHtml(meta.startedAtDisplay || "")} · ${escapeHtml(matchModeLabel(settings.matchMode))} · ${settings.laneCount || 3}레인</p>
            </div>
            <strong>${escapeHtml(printable?.title || "출력할 대진 없음")}</strong>
          </header>

          <div class="print-summary">
            참가 ${actualCount}명 · ${groups.length}개 조 · 팀명 미표기 · 빈 레인 표시
          </div>

          <main class="print-grid">
            ${groups.map(group => `
              <section class="print-group">
                <h2>${escapeHtml(group.name)}</h2>
                <table>
                  <tbody>
                    ${group.slots.map(slot => `
                      <tr class="${slot.isEmptyLane ? "print-empty" : ""}">
                        <td>${slot.lane}LANE</td>
                        <td>${escapeHtml(slot.isEmptyLane ? "빈 레인" : slot.name)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </section>
            `).join("")}
          </main>
        </div>
      `;
    }
function parseBooleanCell(value, defaultValue = false) {
      if (value === undefined || value === null || value === "") return defaultValue;
      const text = String(value).trim().toLowerCase();
      return ["true", "y", "yes", "1", "활성", "사용", "예"].includes(text);
    }
    /* v33 login, venue roster, dashboard */
    const ADMIN_EMAILS = ["chaser.escane@gmail.com"];
    const USER_PROFILE_PATH = "userProfiles";
    const RESULT_LOGS_PATH = "privateResultLogs";
    const PUBLIC_LIVE_PATH = "publicLive";
    const PUBLIC_HISTORY_PATH = "publicHistory";
    const PUBLIC_VENUES_PATH = "publicVenues";
    const PUBLIC_VENUE_DIRECTORY_PATH = "publicVenueDirectory";
    const LIVE_LOBBY_SLOT_COUNT = 20;
    const LIVE_STALE_MS = 3 * 60 * 60 * 1000;
    const OPERATION_LOCK_PATH = "operationLocks";
    const ACTION_LOG_PATH = "actionLogs";
    const ACTION_LOG_MAX_PER_TOURNAMENT = 120;
    const ACTION_LOG_PRUNE_DEBOUNCE_MS = 45000;
    const PUBLIC_HISTORY_RECENT_LIMIT = 160;
    const DASHBOARD_PUBLIC_HISTORY_LIMIT = 300;
    const PUBLIC_LIVE_RECENT_LIMIT = 60;
    const LOCAL_SNAPSHOT_KEY = "mini4wdSnapshotsV44";
    const OPERATOR_UNDO_STORAGE_KEY_V266 = "mini4wdOperatorUndoV266";
    const LOCAL_RESULT_LOGS_KEY = "mini4wdResultLogsV33";
    const DB_VENUE_KEY = "mini4wdDbVenueId";
    const OPERATOR_SESSION_STORAGE_KEY_V178 = "mini4wdOperatorSessionIdV178";
    const OPERATOR_SESSION_HEARTBEAT_MS_V178 = 10000;
    const OPERATION_LEASE_MS_V178 = 45000;
    let firebaseAuth = null;
    let firebaseAuthReadyPromise = null;
    let currentAuthUser = null;
    let currentUserProfile = null;
    let dbVenueIdDraft = localStorage.getItem(DB_VENUE_KEY) || "";
    let dbCloudLoadedVenueId = "";
    let dashboardFilter = { from: "", to: "", venue: "전체", raceClass: "전체", keyword: "" };
    const actionLogPruneTimers = new Map();
    const CLASS_OPTIONS = ["오픈", "스톡", "어드&비맥스", "기타 클래스"];

    function normalizeRaceClassName(value) {
      const text = String(value || "").trim();
      if (!text) return "오픈";
      if (text === "어드벤스드" || text === "어드밴스드" || text === "어드&비맥스") return "어드&비맥스";
      if (text === "기타") return "기타 클래스";
      return text;
    }

    function normalizeKey(text) {
      const raw = String(text || "").trim().toLowerCase();
      const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
      return normalized
        .replace(/[^a-z0-9가-힣]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "default";
    }

    function normalizePhone(contact) {
      return String(contact || "").replace(/\D/g, "");
    }

    function playerIdentityKey(realName, contact, nickname = "", team = "") {
      const phone = normalizePhone(contact);
      if (phone) return `phone-${phone}`;
      return normalizeKey(`missing-${realName || ""}-${nickname || ""}-${team || ""}`);
    }

    function rosterIdentityId(realName, contact, nickname = "", team = "") {
      const phone = normalizePhone(contact);
      if (phone) return `player-phone-${phone}`;
      return `player-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function contactStatusOf(player = {}) {
      return normalizePhone(player.contact) ? "verified" : "missing";
    }

    function contactStatusLabel(status) {
      return status === "verified" ? "연락처 있음" : "연락처 미등록";
    }

    function isPossibleRosterDuplicate(a = {}, b = {}) {
      const aPhone = normalizePhone(a.contact);
      const bPhone = normalizePhone(b.contact);
      if (aPhone && bPhone && aPhone === bPhone) return true;
      const aNick = normalizeKey(a.nickname || a.name || "");
      const bNick = normalizeKey(b.nickname || b.name || "");
      const aTeam = normalizeKey(a.team || "");
      const bTeam = normalizeKey(b.team || "");
      const aReal = normalizeKey(a.realName || "");
      const bReal = normalizeKey(b.realName || "");
      return Boolean(aNick && aNick !== "default" && aNick === bNick && ((aTeam !== "default" && aTeam === bTeam) || (aReal !== "default" && aReal === bReal)));
    }

    function profileFromAdminEmail(user) {
      return user && ADMIN_EMAILS.includes(String(user.email || "").toLowerCase())
        ? { uid: user.uid, email: user.email, role: "admin", venueId: "all", venueName: "전체", approved: true }
        : null;
    }

    function isPublicViewerRoute() {
      try {
        const params = getHashParams();
        const view = params.get("view") || "";
        if (view === "tv-live" || view === "mobile-live" || view === "live") return true;
        if (view === "live-list" || view === "live-lobby" || view === "lobby") return true;
        if ((view === "tv" || view === "mobile") && params.has("data")) return true;
      } catch (error) {
        return false;
      }
      return false;
    }

    function initAuthState() {
      if (firebaseAuthReadyPromise) return firebaseAuthReadyPromise;
      initFirebase();
      firebaseAuthReadyPromise = new Promise(resolve => {
        if (!window.firebase || !firebase.auth) {
          currentAuthUser = null;
          currentUserProfile = null;
          resolve(false);
          return;
        }
        firebaseAuth = firebase.auth();
        let initialResolved = false;
        firebaseAuth.onAuthStateChanged(async user => {
          currentAuthUser = user;
          currentUserProfile = user ? await loadUserProfile(user) : null;
          if (!initialResolved) {
            initialResolved = true;
            resolve(true);
          } else {
            applyResponsiveUxModeV83();
            if (!document.body.classList.contains("tv-mode") && !isPublicViewerRoute()) setTimeout(() => bootV33().catch(console.warn), 0);
          }
        });
      });
      return firebaseAuthReadyPromise;
    }

    async function loadUserProfile(user) {
      const adminProfile = profileFromAdminEmail(user);
      const db = initFirebase();
      if (!db) return adminProfile || { uid: user.uid, email: user.email, role: "pending", venueId: "", venueName: "", approved: false };
      try {
        const snap = await db.ref(`${USER_PROFILE_PATH}/${user.uid}`).get();
        const stored = snap.val();
        if (adminProfile) {
          await db.ref(`${USER_PROFILE_PATH}/${user.uid}`).update({ ...adminProfile, lastLoginAt: new Date().toISOString() }).catch(() => {});
          return { ...(stored || {}), ...adminProfile };
        }
        if (stored) {
          await db.ref(`${USER_PROFILE_PATH}/${user.uid}`).update({ email: user.email, lastLoginAt: new Date().toISOString() }).catch(() => {});
          return { uid: user.uid, email: user.email, role: stored.role || "pending", venueId: stored.venueId || "", venueName: stored.venueName || "", approved: stored.approved === true, ...stored };
        }
        const pending = { uid: user.uid, email: user.email, role: "pending", venueId: "", venueName: "", approved: false, requestedAt: new Date().toISOString() };
        await db.ref(`${USER_PROFILE_PATH}/${user.uid}`).set(pending).catch(() => {});
        return pending;
      } catch (error) {
        return adminProfile || { uid: user.uid, email: user.email, role: "pending", venueId: "", venueName: "", approved: false };
      }
    }

    function profilePermissionFlags(profile = currentUserProfile || {}) {
      const role = profile?.role || "pending";
      const approved = profile?.approved === true;
      const permissions = profile?.permissions || {};
      const admin = role === "admin" && approved;
      const suspended = role === "suspended";
      const operate = admin ? true : role === "venue" && approved ? permissions.operate !== false : false;
      const dashboard = admin ? true : role === "venue" && approved ? permissions.dashboard !== false : false;
      return { role, approved, suspended, admin, operate, dashboard };
    }

    function isAdminUser() {
      return Boolean(currentAuthUser && (ADMIN_EMAILS.includes(String(currentAuthUser.email || "").toLowerCase()) || currentUserProfile?.role === "admin"));
    }

    function isVenueUser() {
      const flags = profilePermissionFlags(currentUserProfile);
      return Boolean(currentAuthUser && flags.role === "venue" && flags.approved);
    }

    function canOperate() {
      const flags = profilePermissionFlags(currentUserProfile);
      return isAdminUser() || flags.operate === true;
    }

    function canViewDashboard() {
      const flags = profilePermissionFlags(currentUserProfile);
      return isAdminUser() || flags.dashboard === true;
    }

    function currentVenueName() {
      if (isVenueUser()) return currentUserProfile.venueName || currentUserProfile.venueId || "경기장";
      return state?.tournament?.venue || dbVenueIdDraft || "GEEKS";
    }

    function currentVenueId() {
      if (isVenueUser()) return currentUserProfile.venueId || normalizeKey(currentUserProfile.venueName || currentUserProfile.email);
      return normalizeKey(dbVenueIdDraft || state?.tournament?.venue || "GEEKS");
    }

    function goHome() {
      location.hash = "";
      bootV33();
    }

    /* v48 9강 + mobile live link fix overrides */
























/* boot deferred to v49 final call */

    function goBack() {
      if (history.length > 1) history.back();
      else goHome();
    }

    function renderPageNav() {
      return `<nav class="page-nav ui-actionbar-v211 ui-commandbar-v212 page-commandbar-v212" aria-label="페이지 이동">
        ${renderUiActionGroupV211("", [
          { label: "뒤로가기", onClick: "goBack()" },
          { label: "홈", onClick: "goHome()" }
        ], "page-nav-group-v212")}
      </nav>`;
    }

    function accountBadge() {
      if (!currentAuthUser) return "";
      const flags = profilePermissionFlags(currentUserProfile);
      const role = isAdminUser() ? "관리자" : flags.approved ? "경기장" : flags.suspended ? "사용 중지" : "승인 대기";
      const venue = isVenueUser() ? currentVenueName() : "";
      const adminAction = isAdminUser() ? { label: "관리자", onClick: "openAdminPage()" } : null;
      const secondRowClass = isAdminUser() ? "dashboard-account-row-v207" : "dashboard-account-row-v207 dashboard-account-row-single-v207";
      const accountText = `${role}${venue ? ` · ${venue}` : ""} · ${currentAuthUser.email || ""}`;
      return `<nav class="account-strip dashboard-account-strip-v207 ui-actionbar-v211 ui-commandbar-v212 dashboard-commandbar-v212" aria-label="대시보드 작업">
        <div class="dashboard-account-buttons-v207 ui-commandbar-groups-v212">
          ${renderUiActionGroupV211("", [
            { label: "뒤로가기", onClick: "goBack()" },
            { label: "홈", onClick: "goHome()" }
          ], "dashboard-account-row-v207 dashboard-nav-group-v212")}
          ${renderUiActionGroupV211("", [
            { label: "전체 경기장", onClick: "dashboardFilter.venue='전체'; renderDashboardWithRecords(window.__dashboardRecords||[])" },
            { label: "새로고침", onClick: "openDashboardPage()" },
            adminAction
          ], `${secondRowClass} dashboard-tool-group-v212`)}
        </div>
        <div class="ui-action-group-v211 ui-action-account-v211 dashboard-account-group-v212">
          <span class="pill dashboard-account-pill-v207">${escapeHtml(accountText)}</span>
          <button class="ghost dashboard-account-wide-v207 dashboard-logout-v207" onclick="logoutUser()">로그아웃</button>
        </div>
      </nav>`;
    }

    function renderUnifiedHeaderMetaV173(items = []) {
      const rows = items.filter(item => item && (item.value || item.value === 0));
      if (!rows.length) return "";
      return `<div class="unified-header-meta-v173">${rows.map(item => `<div class="unified-header-stat-v173"><span>${escapeHtml(item.label || "")}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>`;
    }

    function renderUnifiedHeaderActionsV173(actions = []) {
      const buttons = actions.filter(Boolean).map(action => {
        if (action.html) return action.html;
        const label = action.label || "";
        if (!label) return "";
        const className = action.className || action.kind || "ghost";
        const attrs = [
          `type="${escapeAttr(action.type || "button")}"`,
          `class="${escapeAttr(className)}"`,
          action.onClick ? `onclick="${escapeAttr(action.onClick)}"` : "",
          action.ariaLabel ? `aria-label="${escapeAttr(action.ariaLabel)}"` : ""
        ].filter(Boolean).join(" ");
        return `<button ${attrs}>${escapeHtml(label)}</button>`;
      }).filter(Boolean);
      return buttons.length ? `<div class="unified-header-actions-v173">${buttons.join("")}</div>` : "";
    }

    function renderUnifiedPageHeaderV173(options = {}) {
      const className = ["header", "app-titlebar-v132", "unified-titlebar-v173", options.className || ""].filter(Boolean).join(" ");
      const kicker = options.kicker ? `<div class="maker unified-header-kicker-v173">${escapeHtml(options.kicker)}</div>` : "";
      const description = options.description ? `<p class="desc">${escapeHtml(options.description)}</p>` : "";
      return `<header class="${escapeAttr(className)}">
        <div class="header-copy">
          <div class="brand-line"><div class="eyebrow">MINI4WD TOURNAMENT MAKER</div>${kicker}</div>
          <h1>${escapeHtml(options.title || "")}</h1>
          ${description}
          ${renderUnifiedHeaderMetaV173(options.stats || [])}
        </div>
        ${renderUnifiedHeaderActionsV173(options.actions || [])}
        ${logoMarkup(options.logoClass || "header-logo")}
      </header>`;
    }

    function renderUiActionGroupV211(label = "", actions = [], className = "") {
      const buttons = actions.filter(Boolean).map(action => {
        if (action.html) return action.html;
        const attrs = [
          `type="${escapeAttr(action.type || "button")}"`,
          `class="${escapeAttr(action.className || "ghost")}"`,
          action.onClick ? `onclick="${escapeAttr(action.onClick)}"` : "",
          action.ariaLabel ? `aria-label="${escapeAttr(action.ariaLabel)}"` : ""
        ].filter(Boolean).join(" ");
        return `<button ${attrs}>${escapeHtml(action.label || "")}</button>`;
      }).join("");
      if (!buttons) return "";
      const labelHtml = label ? `<span class="ui-action-label-v211">${escapeHtml(label)}</span>` : "";
      return `<div class="ui-action-group-v211 ${escapeAttr(className)}">${labelHtml}${buttons}</div>`;
    }

    function renderOperatorCommandBarV211() {
      const navActions = [
        { label: "라이브", onClick: "openLiveLobbyPage()" },
        { label: "선수 명단", onClick: "openDbPage()" },
        { label: "기록", onClick: "openDashboardPage()" },
        isAdminUser() ? { label: "관리", onClick: "openAdminPage()" } : null
      ].filter(Boolean);
      const toolActions = [
        { label: "출력", onClick: "openPrintView()" }
      ];
      const role = isAdminUser() ? "관리자" : isVenueUser() ? "경기장" : "운영";
      const venue = currentVenueName();
      const accountText = currentAuthUser?.email
        ? `${role}${venue ? ` · ${venue}` : ""} · ${currentAuthUser.email}`
        : `${role}${venue ? ` · ${venue}` : ""}`;
      return `<nav class="ui-actionbar-v211 operator-commandbar-v211" aria-label="운영 화면 작업">
        ${renderUiActionGroupV211("이동", navActions, "operator-nav-group-v211")}
        ${renderUiActionGroupV211("기타", toolActions, "operator-tool-group-v211")}
        <div class="ui-action-group-v211 ui-action-account-v211 operator-account-group-v211">
          <span class="pill operator-account-pill-v211">${escapeHtml(accountText)}</span>
          <button type="button" class="ghost" onclick="logoutUser()">로그아웃</button>
        </div>
      </nav>`;
    }

    function renderAdminUnifiedToolbarV145(activeView = "users") {
      const refreshAction = activeView === "matches" ? "renderAdminMatchDataPage()" : "renderAdminPage()";
      return `<nav class="toolbar admin-unified-toolbar-v145 admin-command-bar-v204 ui-actionbar-v211 ui-commandbar-v212 admin-commandbar-v212" aria-label="관리자 작업">
        <div class="admin-toolbar-buttons-v204 ui-commandbar-groups-v212">
          ${renderUiActionGroupV211("", [
            { label: "뒤로가기", onClick: "goBack()" },
            { label: "홈", onClick: "goHome()" },
            { label: "새로고침", onClick: refreshAction }
          ], "admin-toolbar-row-v204 admin-toolbar-nav-v212")}
          ${renderUiActionGroupV211("", [
            { label: "대시보드", onClick: "openDashboardPage()" },
            { label: "경기장 계정", className: activeView === "users" ? "primary" : "ghost", onClick: "openAdminPage()" },
            { label: "대회 기록", className: activeView === "matches" ? "primary" : "ghost", onClick: "renderAdminMatchDataPage()" }
          ], "admin-toolbar-row-v204 admin-toolbar-view-v212")}
          ${renderUiActionGroupV211("", [
            { label: "동명이인 정리", onClick: "runDuplicateNameMigration()" }
          ], "admin-toolbar-row-v204 admin-toolbar-row-end-v204 admin-toolbar-tools-v212")}
        </div>
        <div class="ui-action-group-v211 ui-action-account-v211 admin-account-group-v212">
          <span class="pill admin-account-pill-v204">관리자 · ${escapeHtml(currentAuthUser?.email || "")}</span>
          <button class="ghost admin-logout-v204" onclick="logoutUser()">로그아웃</button>
        </div>
      </nav>`;
    }

    function renderDbCommandBarV212(fixedVenueName = "") {
      return `<nav class="db-topline-v130 db-topline-v131 db-toolbar-v146 db-command-bar-v202 ui-actionbar-v211 ui-commandbar-v212 db-commandbar-v212" aria-label="선수 명단 작업">
        ${renderUiActionGroupV211("", [
          { label: "뒤로", onClick: "goBack()" },
          { label: "홈", onClick: "goHome()" },
          { label: "새로고침", onClick: "renderDbPage()" },
          { label: "대시보드", onClick: "openDashboardPage()" },
          isAdminUser() ? { label: "관리자", onClick: "openAdminPage()" } : null
        ], "db-toolbar-group-v202 db-toolbar-nav-v202")}
        ${renderUiActionGroupV211("", [
          { label: "CSV", onClick: "exportRosterCsv()" },
          { label: "양식", onClick: "downloadRosterTemplate()" },
          { html: `<label class="upload-button ghost">업로드<input type="file" accept=".xlsx,.xls,.csv,.tsv" onchange="importRosterExcel(event)" hidden /></label>` }
        ], "db-toolbar-group-v202 db-toolbar-file-v202")}
        <div class="ui-action-group-v211 ui-action-account-v211 db-toolbar-group-v202 db-toolbar-account-v202">
          <span class="pill db-venue-pill-v202">경기장 · ${escapeHtml(fixedVenueName || "-")}</span>
          <span class="pill db-email-pill-v131">${escapeHtml(currentAuthUser?.email || "")}</span>
          <button class="ghost" onclick="logoutUser()">로그아웃</button>
        </div>
      </nav>`;
    }

    function renderLoginPage(message = "운영자 화면은 로그인이 필요합니다.") {
      setUiSurfaceV149("login");
      document.body.classList.remove("tv-mode");
      app.innerHTML = `
        <div class="wrap app-shell-v212 auth-shell-v212">
          ${renderUnifiedPageHeaderV173({
            kicker: "계정",
            title: "운영자 로그인",
            description: "일반 방문자는 라이브를 로그인 없이 볼 수 있고, 운영과 선수 명단 관리는 승인된 계정이 필요합니다."
          })}
          ${renderPageNav()}<section class="card auth-card ui-panel-v212">
            <h2>로그인</h2>
            <p class="hint">${escapeHtml(message)}</p>
            <label>이메일</label><input class="mini-input" id="loginEmail" type="email" autocomplete="username" />
            <label for="loginPassword">비밀번호</label><input class="mini-input" id="loginPassword" type="password" autocomplete="current-password" />
            <div class="auth-actions">
              <button class="primary" onclick="loginWithEmailPassword()">로그인</button>
              <button class="ghost" onclick="requestVenueAccount()">경기장 계정 신청</button>
            </div>
            <p class="privacy-note" style="margin-top:12px;">경기장 계정 신청 후 관리자가 승인해야 운영자 화면에 들어갈 수 있습니다.</p>
            <div class="auth-secondary-actions-v212"><button class="ghost" onclick="openDashboardPage()">기록 보기</button><button class="ghost" onclick="openLiveLobbyPage()">라이브</button></div>
          </section>
        </div>`;
    }    async function loginWithEmailPassword() {
      const email = document.getElementById("loginEmail")?.value.trim();
      const password = document.getElementById("loginPassword")?.value;
      if (!email || !password) return alert("이메일과 비밀번호를 입력하세요.");
      const loginButton = document.querySelector('.auth-actions .primary');
      const originalText = loginButton ? loginButton.textContent : "";
      try {
        if (loginButton) { loginButton.disabled = true; loginButton.textContent = "로그인 중"; }
        await initAuthState();
        const credential = await firebaseAuth.signInWithEmailAndPassword(email, password);
        currentAuthUser = credential.user || firebaseAuth.currentUser;
        currentUserProfile = currentAuthUser ? await loadUserProfile(currentAuthUser) : null;
        firebaseAuthReadyPromise = null;
        location.hash = "";
        applyResponsiveUxModeV83();
        await bootV33();
      } catch (error) {
        alert(`로그인 실패: ${error.message || error}`);
        if (loginButton) { loginButton.disabled = false; loginButton.textContent = originalText || "로그인"; }
      }
    }


    async function requestVenueAccount() {
      const email = document.getElementById("loginEmail")?.value.trim();
      const password = document.getElementById("loginPassword")?.value;
      const venueName = prompt("신청할 경기장명을 입력하세요.");
      if (!email || !password || !venueName) return alert("이메일, 비밀번호, 경기장명이 필요합니다.");
      try {
        await initAuthState();
        const credential = await firebaseAuth.createUserWithEmailAndPassword(email, password);
        const user = credential.user;
        const profile = { uid: user.uid, email, role: "pending", venueId: normalizeKey(venueName), venueName, approved: false, requestedAt: new Date().toISOString() };
        const db = initFirebase();
        if (db) await db.ref(`${USER_PROFILE_PATH}/${user.uid}`).set(profile);
        currentAuthUser = user;
        currentUserProfile = profile;
        renderPendingPage();
      } catch (error) {
        alert(`계정 신청 실패: ${error.message || error}`);
      }
    }

    async function logoutUser() {
      if (firebaseAuth) await firebaseAuth.signOut().catch(() => {});
      currentAuthUser = null;
      currentUserProfile = null;
      firebaseAuthReadyPromise = null;
      location.hash = "view=login";
      renderLoginPage("로그아웃되었습니다.");
    }

    function renderPendingPage() {
      setUiSurfaceV149("restricted");
      document.body.classList.remove("tv-mode");
      app.innerHTML = `<div class="wrap app-shell-v212 auth-shell-v212">${renderPageNav()}<section class="card auth-card ui-panel-v212"><h2>승인 대기</h2><p class="hint">관리자 승인이 필요합니다.</p><p class="privacy-note">계정: ${escapeHtml(currentAuthUser?.email || "")}<br>신청 경기장: ${escapeHtml(currentUserProfile?.venueName || "")}</p><button class="ghost" onclick="logoutUser()">로그아웃</button></section></div>`;
    }

    function renderRestrictedPage(title = "권한 없음", message = "접근 권한이 없습니다.") {
      setUiSurfaceV149("restricted");
      document.body.classList.remove("tv-mode");
      app.innerHTML = `<div class="wrap app-shell-v212 auth-shell-v212">${renderPageNav()}<section class="card auth-card ui-panel-v212"><h2>${escapeHtml(title)}</h2><p class="hint">${escapeHtml(message)}</p><div class="section-toolbar"><button class="ghost" onclick="goHome()">운영 홈</button>${canViewDashboard() ? `<button class="ghost" onclick="openDashboardPage()">기록</button>` : ``}${canOperate() ? `<button class="ghost" onclick="location.hash='view=db'; renderDbPage();">선수 명단</button>` : ``}</div></section></div>`;
    }

    function openDashboardPage() {
      location.hash = "view=dashboard";
      if (!currentAuthUser) return renderLoginPage("대시보드는 로그인 후 이용할 수 있습니다.");
      if (!canViewDashboard()) return renderRestrictedPage("대시보드 권한 없음", "관리자가 대시보드 권한을 부여해야 합니다.");
      renderDashboardPage();
    }
    function openAdminPage() { location.hash = "view=admin"; renderAdminPage(); }


    function renderPermissionToggleV204({ uid, label, enabled, action, tone = "", disabled = false }) {
      const stateClass = enabled ? "on" : "off";
      const title = `${label} ${enabled ? "해제" : "부여"}`;
      return `<button type="button" class="permission-flag permission-toggle-v204 ${stateClass} ${escapeAttr(tone)}" ${disabled ? "disabled" : ""} title="${escapeAttr(title)}" onclick="${action}">${escapeHtml(label)} ${enabled ? "ON" : "OFF"}</button>`;
    }

    function renderPermissionCell(profile = {}, uid = "") {
      const flags = profilePermissionFlags(profile);
      const uidAttr = escapeAttr(uid);
      const isSelf = uid === currentAuthUser?.uid;
      const toggles = [
        renderPermissionToggleV204({ uid, label: "운영", enabled: flags.operate, action: flags.operate ? `revokeOperatePermission('${uidAttr}')` : `grantVenuePermission('${uidAttr}')` }),
        renderPermissionToggleV204({ uid, label: "대시보드", enabled: flags.dashboard, action: `setDashboardPermission('${uidAttr}', ${flags.dashboard ? "false" : "true"})` }),
        renderPermissionToggleV204({ uid, label: "관리자", enabled: flags.admin, tone: "admin", disabled: isSelf && flags.admin, action: flags.admin ? `demoteAdminToVenue('${uidAttr}')` : `grantAdminRole('${uidAttr}')` }),
        renderPermissionToggleV204({ uid, label: "중지", enabled: flags.suspended, tone: "danger", action: flags.suspended ? `unsuspendUser('${uidAttr}')` : `suspendUser('${uidAttr}')` })
      ];
      return `<div class="admin-permission-stack-v186 admin-permission-stack-v204"><div class="permission-flags permission-flags-v204">${toggles.join("")}</div></div>`;
    }

    function renderApprovedCell(profile = {}) {
      const flags = profilePermissionFlags(profile);
      if (flags.admin) return "승인됨 · 관리자";
      if (flags.role === "venue" && flags.approved) return "승인됨 · 경기장";
      if (flags.suspended) return "중지됨";
      return "미승인";
    }

    function adminStatusToneV186(profile = {}) {
      const flags = profilePermissionFlags(profile);
      if (flags.admin) return { tone: "admin", label: "관리자", note: "전체 권한" };
      if (flags.suspended) return { tone: "danger", label: "중지", note: "접근 차단" };
      if (flags.role === "venue" && flags.approved && flags.operate) return { tone: "ok", label: "운영 가능", note: "경기장 운영" };
      if (flags.role === "venue" && flags.approved) return { tone: "soft", label: "조회 계정", note: "제한 권한" };
      return { tone: "warn", label: "승인 대기", note: "처리 필요" };
    }

    function renderAdminOverviewV186(items = []) {
      return `<section class="admin-overview-v186">${items.map(item => `<div class="admin-overview-item-v186 tone-${escapeAttr(item.tone || "soft")}"><small>${escapeHtml(item.label || "")}</small><strong>${escapeHtml(item.value || "")}</strong><span>${escapeHtml(item.note || "")}</span></div>`).join("")}</section>`;
    }

    function adminVenueTextV186(profile = {}) {
      return profile.venueName || profile.venueId || "미지정";
    }

    function renderAdminAccountCellV205(profile = {}) {
      return `<div class="admin-account-main-v186 admin-account-main-v205"><span class="admin-account-venue-v205">${escapeHtml(adminVenueTextV186(profile))}</span><strong>${escapeHtml(profile.email || "")}</strong></div>`;
    }

    function tagAdminRecordSourceV186(items = [], source = "record") {
      return (items || []).map(item => item && typeof item === "object" ? { ...item, adminSourceV186: item.adminSourceV186 || source } : item);
    }

    function renderAdminPage() {
      setUiSurfaceV149("admin-accounts");
      if (!isAdminUser()) return renderLoginPage("관리자 권한이 필요합니다.");
      document.body.classList.remove("tv-mode");
      app.innerHTML = `<div class="db-page admin-light-page admin-list-page-v177 admin-command-page-v186 app-shell-v212 admin-shell-v212">${renderUnifiedPageHeaderV173({ className: "admin-titlebar-v177", kicker: "ADMIN", title: "계정 · 경기장 관리", description: "경기장 계정 승인과 화면 접근 권한을 관리합니다." })}${renderAdminUnifiedToolbarV145("users")}<section class="card ui-panel-v212 admin-list-card-v177 admin-list-card-v186"><h2>불러오는 중</h2></section></div>`;
      const db = initFirebase();
      if (!db) return;
      db.ref(USER_PROFILE_PATH).get().then(snapshot => {
        const profiles = snapshot.val() || {};
        syncPublicVenuesFromProfiles(profiles);
        const rows = Object.entries(profiles).sort((a,b) => String(a[1].email || "").localeCompare(String(b[1].email || "")));
        const profileList = rows.map(([, p]) => p || {});
        const venueCount = new Set(profileList.map(p => normalizeKey(p.venueName || p.venueId || "")).filter(key => key && key !== "all")).size;
        const pendingCount = profileList.filter(p => {
          const flags = profilePermissionFlags(p);
          return !flags.admin && !flags.suspended && !(flags.role === "venue" && flags.approved);
        }).length;
        const suspendedCount = profileList.filter(p => profilePermissionFlags(p).suspended).length;
        const adminCount = profileList.filter(p => profilePermissionFlags(p).admin).length;
        const activeVenueCount = profileList.filter(p => {
          const flags = profilePermissionFlags(p);
          return flags.role === "venue" && flags.approved && !flags.suspended;
        }).length;
        const overviewHtml = renderAdminOverviewV186([
          { label: "승인 대기", value: `${pendingCount}개`, note: pendingCount ? "먼저 확인" : "대기 없음", tone: pendingCount ? "warn" : "ok" },
          { label: "운영 계정", value: `${activeVenueCount}개`, note: `${venueCount}곳 연결`, tone: "soft" },
          { label: "관리자", value: `${adminCount}개`, note: "전체 권한", tone: "admin" },
          { label: "중지", value: `${suspendedCount}개`, note: suspendedCount ? "접근 차단" : "차단 없음", tone: suspendedCount ? "danger" : "ok" }
        ]);
        const tableRows = rows.map(([uid, p]) => {
          const status = adminStatusToneV186(p);
          return `<tr class="admin-account-row-v177 admin-account-row-v186 tone-${escapeAttr(status.tone)}"><td data-label="계정" class="admin-primary-cell-v177">${renderAdminAccountCellV205(p)}</td><td data-label="상태"><span class="admin-status-text-v177 admin-status-v186 tone-${escapeAttr(status.tone)}">${escapeHtml(status.label)}</span></td><td data-label="권한" class="admin-permission-cell-v204">${renderPermissionCell(p, uid)}</td></tr>`;
        }).join("") || `<tr class="admin-empty-row-v177"><td colspan="3">사용자가 없습니다.</td></tr>`;
        app.innerHTML = `<div class="db-page admin-light-page admin-list-page-v177 admin-command-page-v186 app-shell-v212 admin-shell-v212">${renderUnifiedPageHeaderV173({ className: "admin-titlebar-v177", kicker: "ADMIN", title: "계정 · 경기장 관리", description: "경기장 계정 승인과 화면 접근 권한을 관리합니다.", stats: [{ label: "계정", value: `${rows.length}개` }, { label: "경기장", value: `${venueCount}곳` }, { label: "승인 대기", value: `${pendingCount}개` }, { label: "중지", value: `${suspendedCount}개` }] })}${renderAdminUnifiedToolbarV145("users")}<main class="admin-workspace-v186 ui-workspace-v212 admin-workspace-v212">${overviewHtml}<section class="card ui-panel-v212 admin-list-card-v177 admin-list-card-v186"><div class="admin-list-head-v177 admin-list-head-v186"><div><h2>경기장 계정 리스트</h2><p class="meta">경기장명은 계정 위에 두고, 권한 칩은 맨 오른쪽에서 바로 변경합니다.</p></div><span class="pill">${rows.length}개 계정</span></div><div class="roster-table-wrap admin-table-wrap-v177"><table class="admin-table admin-table-v177 admin-table-v186 admin-account-table-v204"><thead><tr><th>계정</th><th>상태</th><th>권한</th></tr></thead><tbody>${tableRows}</tbody></table></div><p class="privacy-note admin-list-note-v177">현재 권한 칩을 누르면 해당 계정의 권한이 바로 반영됩니다.</p></section></main><div class="admin-build-mark">${escapeHtml(mini4wdBuildLabel())}</div></div>`;
      }).catch(error => alert(`사용자 목록 로드 실패: ${error.message || error}`));
    }

    /* v144 항목8: 어드민 경기 데이터 관리 — 전 경기장 대회 기록 조회 + 개별 삭제 */
    function formatRecordDateV144(record) {
      const iso = record.endedAtISO || record.createdAt || record.startedAtISO || "";
      if (!iso) return "-";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return escapeHtml(String(iso));
      const p = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function renderAdminMatchDataPage() {
      setUiSurfaceV149("admin-matches");
      if (!isAdminUser()) return renderLoginPage("관리자 권한이 필요합니다.");
      document.body.classList.remove("tv-mode");
      location.hash = "view=admin-matches";
      app.innerHTML = `<div class="db-page admin-light-page admin-list-page-v177 admin-command-page-v186 app-shell-v212 admin-shell-v212">${renderUnifiedPageHeaderV173({ className: "admin-titlebar-v177", kicker: "ADMIN", title: "대회 기록 관리", description: "전 경기장의 저장된 대회 기록을 불러오는 중입니다." })}${renderAdminUnifiedToolbarV145("matches")}<section class="card ui-panel-v212 admin-list-card-v177 admin-list-card-v186"><h2>불러오는 중</h2></section></div>`;
      const db = initFirebase();
      const local = (typeof loadLocalResultLogs === "function") ? loadLocalResultLogs() : [];
      if (!db) { renderAdminMatchDataWithRecords(tagAdminRecordSourceV186(local, "local")); return; }
      Promise.all([
        db.ref(RESULT_LOGS_PATH).get().then(s => flattenPrivateResultLogs(s.val() || {})).catch(() => []),
        db.ref(PUBLIC_HISTORY_PATH).get().then(s => s.val() ? Object.values(s.val()) : []).catch(() => [])
      ]).then(([priv, pub]) => {
        const merged = [
          ...tagAdminRecordSourceV186(local, "local"),
          ...tagAdminRecordSourceV186(priv, "private"),
          ...tagAdminRecordSourceV186(pub, "public")
        ].filter((item, idx, arr) => item && item.id && arr.findIndex(x => x && x.id === item.id) === idx);
        merged.sort((a, b) => String(b.endedAtISO || b.createdAt || "").localeCompare(String(a.endedAtISO || a.createdAt || "")));
        renderAdminMatchDataWithRecords(merged);
      }).catch(error => alert("경기 데이터 로드 실패: " + (error?.message || error)));
    }

    function renderAdminMatchDataWithRecords(records) {
      setUiSurfaceV149("admin-matches");
      const list = Array.isArray(records) ? records : [];
      const venueCount = new Set(list.map(record => normalizeKey(record.venueName || record.venueId || "")).filter(Boolean)).size;
      const classCount = new Set(list.map(record => normalizeRaceClassName(record.raceClass || "")).filter(Boolean)).size;
      const rowTotal = list.reduce((sum, record) => sum + (Array.isArray(record.rows) ? record.rows.length : 0), 0);
      const publicCount = list.filter(record => String(record.adminSourceV186 || "").toLowerCase() === "public").length;
      const privateCount = list.filter(record => String(record.adminSourceV186 || "").toLowerCase() === "private").length;
      const localCount = list.filter(record => String(record.adminSourceV186 || "").toLowerCase() === "local").length;
      const latestRecordText = list.length ? formatRecordDateV144(list[0]) : "-";
      const overviewHtml = renderAdminOverviewV186([
        { label: "총 기록", value: `${list.length}건`, note: `${rowTotal}행`, tone: "soft" },
        { label: "경기장", value: `${venueCount}곳`, note: `${classCount}개 클래스`, tone: "ok" },
        { label: "저장 기록", value: `${publicCount + privateCount}건`, note: localCount ? `로컬 ${localCount}건` : "Firebase 기록", tone: "admin" },
        { label: "최근 저장", value: latestRecordText, note: "최신순 정렬", tone: "soft" }
      ]);
      const rowsHtml = list.length
        ? list.map(record => {
            const rowCount = Array.isArray(record.rows) ? record.rows.length : 0;
            return `<tr class="admin-record-row-v177 admin-record-row-v186">
              <td data-label="대회" class="admin-primary-cell-v177"><div class="admin-record-main-v186"><strong>${escapeHtml(record.tournamentName || "(이름 없음)")}</strong></div></td>
              <td data-label="경기장">${escapeHtml(record.venueName || record.venueId || "-")}</td>
              <td data-label="클래스">${escapeHtml(record.raceClass || "-")}</td>
              <td data-label="저장 시각">${escapeHtml(formatRecordDateV144(record))}</td>
              <td data-label="기록행" class="admin-number-cell-v177">${rowCount}</td>
              <td data-label="관리" class="admin-action-cell-v177"><button class="danger" onclick="deleteAdminTournamentRecord('${escapeAttr(record.id)}','${escapeAttr(record.venueId || "")}')">삭제</button></td>
            </tr>`;
          }).join("")
        : `<tr class="admin-empty-row-v177"><td colspan="6">저장된 경기 기록이 없습니다.</td></tr>`;
      app.innerHTML = `<div class="db-page admin-light-page admin-list-page-v177 admin-command-page-v186 app-shell-v212 admin-shell-v212">${renderUnifiedPageHeaderV173({ className: "admin-titlebar-v177", kicker: "ADMIN", title: "대회 기록 관리", description: "전 경기장의 저장된 대회 기록을 조회하고 정리합니다.", stats: [{ label: "대회 기록", value: `${list.length}건` }, { label: "경기장", value: `${venueCount}곳` }, { label: "클래스", value: `${classCount}개` }, { label: "기록행", value: `${rowTotal}행` }] })}${renderAdminUnifiedToolbarV145("matches")}<main class="admin-workspace-v186 ui-workspace-v212 admin-workspace-v212">${overviewHtml}<section class="card ui-panel-v212 admin-list-card-v177 admin-list-card-v186"><div class="admin-list-head-v177 admin-list-head-v186"><div><h2>대회 기록 리스트</h2><p class="meta">기록행 수와 저장 시각을 기준으로 기록을 정리합니다.</p></div><span class="pill">${list.length}건</span></div><div class="roster-table-wrap admin-table-wrap-v177"><table class="admin-table admin-table-v177 admin-table-v186"><thead><tr><th>대회</th><th>경기장</th><th>클래스</th><th>저장 시각</th><th style="text-align:right;">기록행</th><th>관리</th></tr></thead><tbody>${rowsHtml}</tbody></table></div><p class="privacy-note admin-list-note-v177">삭제 시 관리자 보관 기록(privateResultLogs), 공개 기록(publicHistory), 로컬 기록에서 함께 제거됩니다. 되돌릴 수 없습니다.</p></section></main><div class="admin-build-mark">${escapeHtml(mini4wdBuildLabel())}</div></div>`;
    }

    function deleteAdminTournamentRecord(id, venueId) {
      if (!isAdminUser()) return;
      if (!id) return;
      if (!confirm("이 경기 기록을 삭제할까요?\n관리자 보관·공개·로컬 기록에서 모두 제거되며 되돌릴 수 없습니다.")) return;
      try {
        const local = (typeof loadLocalResultLogs === "function" ? loadLocalResultLogs() : []).filter(item => item && item.id !== id);
        safeSetItem(LOCAL_RESULT_LOGS_KEY, JSON.stringify(local));
      } catch (error) {}
      const db = initFirebase();
      if (db && currentAuthUser) {
        const tasks = [];
        if (venueId) tasks.push(db.ref(`${RESULT_LOGS_PATH}/${venueId}/${id}`).remove().catch(() => {}));
        tasks.push(db.ref(`${PUBLIC_HISTORY_PATH}/${id}`).remove().catch(() => {}));
        Promise.all(tasks).then(() => renderAdminMatchDataPage());
      } else {
        renderAdminMatchDataPage();
      }
    }
    try {
      window.renderAdminMatchDataPage = renderAdminMatchDataPage;
      window.deleteAdminTournamentRecord = deleteAdminTournamentRecord;
    } catch (error) {}

    async function fetchUserProfileForAdmin(uid) {
      const db = initFirebase();
      const snap = await db.ref(`${USER_PROFILE_PATH}/${uid}`).get();
      return { db, profile: snap.val() || {} };
    }

    async function grantVenuePermission(uid) {
      if (!isAdminUser()) return;
      const { db, profile } = await fetchUserProfileForAdmin(uid);
      let venueName = profile.venueName && profile.venueName !== '전체' ? profile.venueName : '';
      venueName = prompt('운영 권한을 부여할 경기장명', venueName || '') || '';
      if (!venueName) return;
      const permissions = { ...(profile.permissions || {}), operate: true, dashboard: profile.permissions?.dashboard !== false };
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'venue', approved: true, venueName, venueId: normalizeKey(venueName), permissions, approvedAt: new Date().toISOString() });
      renderAdminPage();
    }

    async function revokeOperatePermission(uid) {
      if (!isAdminUser() || !confirm('운영 권한을 해제할까요?')) return;
      const { db, profile } = await fetchUserProfileForAdmin(uid);
      const permissions = { ...(profile.permissions || {}), operate: false };
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'venue', approved: true, permissions });
      renderAdminPage();
    }

    async function setDashboardPermission(uid, enabled) {
      if (!isAdminUser()) return;
      const { db, profile } = await fetchUserProfileForAdmin(uid);
      const permissions = { ...(profile.permissions || {}), dashboard: Boolean(enabled), operate: profile.permissions?.operate !== false };
      const updates = { permissions };
      if (!profile.role || profile.role === 'pending') {
        let venueName = profile.venueName || prompt('대시보드 권한을 줄 경기장명', '') || '';
        if (!venueName) return;
        updates.role = 'venue';
        updates.approved = true;
        updates.venueName = venueName;
        updates.venueId = normalizeKey(venueName);
      }
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update(updates);
      renderAdminPage();
    }

    async function grantAdminRole(uid) {
      if (!isAdminUser() || !confirm('관리자 권한을 부여할까요?')) return;
      const { db } = await fetchUserProfileForAdmin(uid);
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'admin', approved: true, venueName: '전체', venueId: 'all', permissions: { operate: true, dashboard: true }, approvedAt: new Date().toISOString() });
      renderAdminPage();
    }

    async function demoteAdminToVenue(uid) {
      if (!isAdminUser()) return;
      if (uid === currentAuthUser?.uid) return alert('현재 로그인한 본인 계정의 관리자 권한은 여기서 해제할 수 없습니다.');
      const { db, profile } = await fetchUserProfileForAdmin(uid);
      let venueName = profile.venueName && profile.venueName !== '전체' ? profile.venueName : '';
      venueName = prompt('관리자 해제 후 부여할 경기장명', venueName || '') || '';
      if (!venueName) return;
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'venue', approved: true, venueName, venueId: normalizeKey(venueName), permissions: { operate: true, dashboard: true } });
      renderAdminPage();
    }

    async function suspendUser(uid) {
      if (!isAdminUser() || !confirm('이 계정을 중지할까요?')) return;
      const { db } = await fetchUserProfileForAdmin(uid);
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'suspended', approved: false, permissions: { operate: false, dashboard: false } });
      renderAdminPage();
    }

    async function unsuspendUser(uid) {
      if (!isAdminUser()) return;
      const { db, profile } = await fetchUserProfileForAdmin(uid);
      const venueName = profile.venueName && profile.venueName !== '전체' ? profile.venueName : (prompt('중지 해제 후 지정할 경기장명', '') || '');
      if (!venueName) return;
      await db.ref(`${USER_PROFILE_PATH}/${uid}`).update({ role: 'venue', approved: true, venueName, venueId: normalizeKey(venueName), permissions: { operate: false, dashboard: false } });
      renderAdminPage();
    }

    function getRosterStorageKey() {
      return `${ROSTER_KEY}_${currentVenueId()}`;
    }

    function loadRoster() {
      try {
        const raw = localStorage.getItem(getRosterStorageKey()) || localStorage.getItem(ROSTER_KEY);
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data.map(normalizeRosterPlayer) : [];
      } catch (error) { return []; }
    }

    function normalizeRosterPlayer(player) {
      const realName = String(player.realName || "").trim();
      const contact = String(player.contact || "").trim();
      const team = String(player.team || "").trim();
      const nickname = String(player.nickname || player.name || realName || "").trim();
      const id = player.id ? String(player.id) : rosterIdentityId(realName, contact, nickname, team);
      const contactStatus = contactStatusOf({ contact });
      const venueId = player.venueId ? String(player.venueId) : currentVenueId();
      const venueName = player.venueName ? String(player.venueName) : currentVenueName();
      return { ...player, id, realName, contact, contactStatus, name: nickname, team, nickname, memo: String(player.memo || "").trim(), favorite: Boolean(player.favorite), active: player.active !== false, venueId, venueName, createdAt: player.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    }

    function rosterRecordKey(player) {
      if (typeof player === "string") return player;
      if (!player) return "";
      return `${player.venueId || currentVenueId()}::${player.id}`;
    }

    function rosterKeyMatches(player, key) {
      if (!player) return false;
      if (String(key || "").includes("::")) return rosterRecordKey(player) === key;
      return String(player.id) === String(key);
    }

    function getRosterPlayerByKey(key, roster = loadRoster()) {
      return roster.find(player => rosterKeyMatches(player, key));
    }

    function persistAdminRosterPlayer(player) {
      const db = initFirebase();
      const normalized = normalizeRosterPlayer(player);
      const venueId = normalized.venueId || currentVenueId();
      normalized.venueId = venueId;
      if (!normalized.venueName) normalized.venueName = venueId;
      if (db && currentAuthUser) {
        db.ref(`venues/${venueId}/players/${normalized.id}`).set(normalized).catch(error => console.warn("admin roster player save failed", error));
      }
      return normalized;
    }

    function removeAdminRosterPlayer(player) {
      const db = initFirebase();
      const venueId = player?.venueId || currentVenueId();
      const id = player?.id;
      if (db && currentAuthUser && venueId && id) {
        db.ref(`venues/${venueId}/players/${id}`).remove().catch(error => console.warn("admin roster player remove failed", error));
      }
    }

    function saveRoster(roster) {
      const normalized = roster.map(normalizeRosterPlayer);
      safeSetItem(getRosterStorageKey(), JSON.stringify(normalized));
      const db = initFirebase();
      if (!db || !currentAuthUser) return;
      if (isAdminUser()) {
        // 관리자 전체명부에서는 현재 경기장 경로에 통째로 덮어쓰지 않는다.
        return;
      }
      db.ref(`venues/${currentVenueId()}/players`).set(Object.fromEntries(normalized.map(player => [player.id, player]))).catch(error => console.warn("roster cloud save failed", error));
    }

    function requestRosterCloudLoad() {
      const venueId = currentVenueId();
      const loadKey = isAdminUser() ? ("__admin_all__:" + venueId) : venueId;
      if (dbCloudLoadedVenueId === loadKey) return;
      dbCloudLoadedVenueId = loadKey;
      const db = initFirebase();
      if (!db || !currentAuthUser) return;
      // [v113 관리자 전체 명부] 관리자는 모든 경기장 선수를 병합 로드 (실제 venueId 보존)
      if (isAdminUser()) {
        db.ref("venues").get().then(snapshot => {
          const allVenues = snapshot.val() || {};
          const merged = [];
          Object.keys(allVenues).forEach(vId => {
            const node = allVenues[vId] || {};
            const players = node.players || {};
            Object.values(players).forEach(p => {
              const np = normalizeRosterPlayer(p);
              np.venueId = vId;                       // 자기 경기장으로 덮어쓴 값 복원
              np.venueName = node.name || node.venueName || vId;
              merged.push(np);
            });
          });
          safeSetItem(getRosterStorageKey(), JSON.stringify(merged));
          renderDbPage();
        }).catch(() => {});
        return;
      }
      db.ref(`venues/${venueId}/players`).get().then(snapshot => {
        const raw = snapshot.val();
        if (!raw) return;
        const cloud = Object.values(raw).map(normalizeRosterPlayer);
        safeSetItem(getRosterStorageKey(), JSON.stringify(cloud));
        renderDbPage();
      }).catch(() => {});
    }

    function findRosterMatch(displayName, team) {
      const nameKey = String(displayName || "").trim();
      const teamKey = String(team || "").trim();
      return loadRoster().find(player => player.active && (player.name === nameKey || player.nickname === nameKey || player.realName === nameKey) && String(player.team || "") === teamKey)
        || loadRoster().find(player => player.active && (player.name === nameKey || player.nickname === nameKey || player.realName === nameKey));
    }

    function parseParticipants(text = state.inputText) {
      return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const parts = line.includes("/") ? line.split("/") : line.includes("\t") ? line.split("\t") : line.split(",");
          const name = (parts[0] || `참가자 ${index + 1}`).trim();
          const team = (parts[1] || "").trim();
          const roster = findRosterMatch(name, team);
          if (roster) return { id: roster.id, name, team, realName: roster.realName, contact: roster.contact, contactStatus: roster.contactStatus, venueId: roster.venueId, venueName: roster.venueName };
          return { id: `p-${index + 1}-${slugId(name)}`, name, team, realName: "", contact: "", contactStatus: "missing", venueId: currentVenueId(), venueName: currentVenueName() };
        });
    }

    function addRosterPlayer() {
      const realName = document.getElementById("dbRealName")?.value.trim();
      const contact = document.getElementById("dbContact")?.value.trim();
      const nickname = document.getElementById("dbNickname")?.value.trim();
      const team = document.getElementById("dbTeam")?.value.trim();
      const memo = document.getElementById("dbMemo")?.value.trim();
      const adminVenueName = document.getElementById("dbAdminVenueName")?.value.trim();
      if (!nickname) return alert("닉네임/선수명은 필수입니다. 실명과 연락처는 나중에 보완할 수 있습니다.");
      if (isAdminUser() && !adminVenueName) return alert("관리자 전체 명부에서 선수 추가 시 등록 경기장을 입력해야 합니다.");
      const venueName = isAdminUser() ? adminVenueName : currentVenueName();
      const venueId = isAdminUser() ? normalizeKey(adminVenueName) : currentVenueId();
      const roster = loadRoster();
      const draft = { realName, contact, nickname, team, venueId, venueName };
      const duplicated = roster.find(player => isPossibleRosterDuplicate(player, draft) && (!isAdminUser() || player.venueId === venueId));
      if (duplicated && !confirm(`중복 의심 선수가 있습니다: ${duplicated.nickname || duplicated.realName || "이름 없음"}. 그래도 새 선수로 등록할까요?`)) return;
      const player = normalizeRosterPlayer({ id: rosterIdentityId(realName, contact, nickname, team), realName, contact, nickname, team, memo, favorite: false, active: true, venueId, venueName, createdAt: new Date().toISOString() });
      roster.push(player);
      saveRoster(roster);
      if (isAdminUser()) persistAdminRosterPlayer(player);
      renderDbPage();
      requestAnimationFrame(() => {
        const input = document.getElementById("dbNickname");
        input?.focus({ preventScroll: true });
        document.getElementById("dbQuickAddPanel")?.scrollIntoView({ block: "nearest" });
      });
    }

    function updateRosterInline(key, field, value) {
      const roster = loadRoster();
      const target = getRosterPlayerByKey(key, roster);
      if (!target) return;
      const oldRealName = String(target.realName || "").trim();
      const syncFields = ["realName", "contact", "team", "memo"];
      const shouldSync = isAdminUser() && syncFields.includes(field) && oldRealName;
      const changed = [];
      const nextRoster = roster.map(player => {
        const sameRecord = rosterKeyMatches(player, key);
        const samePerson = shouldSync && String(player.realName || "").trim() === oldRealName;
        if (!sameRecord && !samePerson) return player;
        const next = normalizeRosterPlayer({ ...player, [field]: value });
        changed.push(next);
        return next;
      });
      saveRoster(nextRoster);
      if (isAdminUser()) changed.forEach(persistAdminRosterPlayer);
      renderDbPage();
    }

    function updateSelectedPreview() {
      const roster = loadRoster();
      const selected = roster.filter(player => dbSelectedIds.has(rosterRecordKey(player)) || dbSelectedIds.has(rosterRecordKey(player)));
      const el = document.getElementById("selectedPreview");
      const count = document.getElementById("selectedCount");
      if (count) count.textContent = selected.length;
      if (!el) return;
      if (!selected.length) { el.innerHTML = `<div class="hint">선택된 선수가 없습니다.</div>`; return; }
      el.innerHTML = selected.map(player => `<div class="finalist-item selected-nickname-v145"><b>${escapeHtml(player.nickname || player.name || player.realName)}</b></div>`).join("");
    }

    function applySelectedPlayersToTournament() {
      const roster = loadRoster();
      const selected = roster.filter(player => (dbSelectedIds.has(rosterRecordKey(player)) || dbSelectedIds.has(rosterRecordKey(player))) && player.active);
      if (!selected.length) return alert("참가자를 선택하세요.");
      const text = selected.map(player => `${player.nickname || player.name || player.realName}/${player.team || ""}`).join("\n");
      safeSetItem(PENDING_PARTICIPANTS_KEY, text);
      safeSetItem(RECENT_PARTICIPANTS_KEY, JSON.stringify(selected.map(rosterRecordKey)));
      state.inputText = text;
      if (isVenueUser()) state.tournament.venue = currentVenueName();
      saveLiveState();
      location.hash = "";
      renderOperator();
    }

    function exportRosterCsv() {
      const roster = loadRoster();
      const rows = [["경기장", "실명", "연락처", "연락처상태", "닉네임", "팀명", "즐겨찾기", "활성", "메모", "등록일"]];
      roster.forEach(player => rows.push([player.venueName || currentVenueName(), player.realName || "", player.contact || "", contactStatusLabel(player.contactStatus), player.nickname || "", player.team || "", player.favorite ? "Y" : "N", player.active ? "Y" : "N", player.memo || "", player.createdAt || ""]));
      downloadTextFile(`mini4wd_roster_${currentVenueId()}.csv`, toCsv(rows));
    }

    function downloadRosterTemplate() {
      const rows = [["실명", "연락처", "닉네임", "팀명", "메모", "활성여부", "즐겨찾기"], ["김철수", "", "마이", "GEEKS", "연락처는 선택값", "TRUE", "TRUE"]];
      if (window.XLSX) { const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(rows); XLSX.utils.book_append_sheet(wb, ws, "선수등록양식"); XLSX.writeFile(wb, "mini4wd_player_upload_template.xlsx"); }
      else downloadTextFile("mini4wd_player_upload_template.csv", toCsv(rows));
    }

    function importRosterExcel(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      const ext = file.name.split(".").pop().toLowerCase();
      const reader = new FileReader();
      reader.onload = e => {
        try {
          let rows = [];
          if ((ext === "xlsx" || ext === "xls") && window.XLSX) {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
          } else {
            const lines = e.target.result.split(/\r?\n/).filter(Boolean);
            const headers = lines.shift().split(/,|\t/).map(h => h.replace(/^"|"$/g, "").trim());
            rows = lines.map(line => { const cells = line.split(/,|\t/).map(cell => cell.replace(/^"|"$/g, "").trim()); const obj = {}; headers.forEach((h,i) => obj[h] = cells[i] || ""); return obj; });
          }
          const current = loadRoster();
          const imported = [];
          rows.forEach(row => {
            const realName = String(row["실명"] || row["realName"] || "").trim();
            const contact = String(row["연락처"] || row["contact"] || "").trim();
            const nickname = String(row["닉네임"] || row["nickname"] || row["선수명"] || row["name"] || "").trim();
            if (!nickname) return;
            const team = String(row["팀명"] || row["team"] || "").trim();
            const draft = { realName, contact, nickname, team };
            if (current.concat(imported).some(player => isPossibleRosterDuplicate(player, draft))) return;
            imported.push(normalizeRosterPlayer({ id: rosterIdentityId(realName, contact, nickname, team), realName, contact, nickname, team, memo: String(row["메모"] || row["memo"] || "").trim(), active: parseBooleanCell(row["활성여부"], true), favorite: parseBooleanCell(row["즐겨찾기"], false), createdAt: new Date().toISOString() }));
          });
          if (!imported.length) { event.target.value = ""; return alert("추가할 선수가 없습니다. 닉네임/선수명이 필요합니다."); }
          saveRoster([...current, ...imported]);
          event.target.value = "";
          renderDbPage();
        } catch (error) { alert("업로드 파일을 읽는 중 오류가 발생했습니다."); event.target.value = ""; }
      };
      if (ext === "xlsx" || ext === "xls") reader.readAsArrayBuffer(file); else reader.readAsText(file, "utf-8");
    }

    function registeredVenueOptions(selectedVenueId = currentVenueId(), selectedVenueName = currentVenueName()) {
      const venueMap = new Map();
      const addVenue = (id, name) => {
        const venueId = normalizeKey(id || name || "default");
        const venueName = String(name || id || "경기장").trim() || "경기장";
        if (!venueMap.has(venueId)) venueMap.set(venueId, venueName);
      };
      addVenue(currentVenueId(), currentVenueName());
      addVenue(selectedVenueId, selectedVenueName);
      loadRoster().forEach(player => addVenue(player.venueId, player.venueName));
      return Array.from(venueMap.entries()).sort((a, b) => a[1].localeCompare(b[1], "ko"));
    }

    function venueSelectMarkupForRoster(player = {}, key = "") {
      const selectedId = normalizeKey(player.venueId || currentVenueId());
      const options = registeredVenueOptions(player.venueId, player.venueName).map(([id, name]) => {
        const selected = id === selectedId ? "selected" : "";
        return `<option value="${escapeAttr(id + "||" + name)}" ${selected}>${escapeHtml(name)}</option>`;
      }).join("");
      return `<select class="mini-input roster-venue-select-v121" onchange="updateRosterVenue('${escapeAttr(key)}', this.value)">${options}</select>`;
    }

    function updateRosterVenue(key, packedValue) {
      const [rawId, ...nameParts] = String(packedValue || "").split("||");
      const venueName = (nameParts.join("||") || rawId || "경기장").trim();
      const venueId = normalizeKey(rawId || venueName);
      const roster = loadRoster();
      let changed = null;
      let previousVenueId = "";
      const nextRoster = roster.map(player => {
        if (!rosterKeyMatches(player, key)) return player;
        previousVenueId = player.venueId || "";
        changed = normalizeRosterPlayer({ ...player, venueId, venueName });
        return changed;
      });
      if (!changed) return;
      saveRoster(nextRoster);
      if (isAdminUser()) {
        if (previousVenueId && previousVenueId !== changed.venueId) removeAdminRosterPlayer({ ...changed, venueId: previousVenueId });
        persistAdminRosterPlayer(changed);
      }
      renderDbPage();
    }

    function handleRosterAction(key, action) {
      if (action === "delete") return deleteRosterPlayer(key);
      if (action === "active") return setRosterActiveState(key, true);
      if (action === "inactive") return setRosterActiveState(key, false);
      renderDbPage();
    }

    function setRosterActiveState(key, active) {
      const roster = loadRoster();
      let changedPlayer = null;
      const nextRoster = roster.map(player => {
        if (!rosterKeyMatches(player, key)) return player;
        changedPlayer = normalizeRosterPlayer({ ...player, active });
        return changedPlayer;
      });
      if (!changedPlayer) return;
      saveRoster(nextRoster);
      if (isAdminUser()) persistAdminRosterPlayer(changedPlayer);
      renderDbPage();
    }

    function renderDbPage() {
      setUiSurfaceV149("player-management");
      if (!canOperate()) return renderLoginPage("선수 명단은 경기장 계정 또는 관리자만 사용할 수 있습니다.");
      document.body.classList.remove("tv-mode");
      document.body.classList.add("db-light-page-v96");
      requestRosterCloudLoad();
      const roster = loadRoster();
      const teams = Array.from(new Set(roster.map(player => player.team).filter(Boolean))).sort();
      const filtered = getDbFilteredRoster(roster);
      const visibleSelectedCount = filtered.filter(player => dbSelectedIds.has(rosterRecordKey(player))).length;
      const visibleActiveCount = filtered.filter(player => player.active).length;
      const allVisibleSelected = visibleActiveCount > 0 && filtered.filter(player => player.active).every(player => dbSelectedIds.has(rosterRecordKey(player)));
      const activeCount = roster.filter(player => player.active).length;
      const favoriteCount = roster.filter(player => player.favorite).length;
      const missingContactCount = roster.filter(player => contactStatusOf(player) === "missing").length;
      const fixedVenueName = currentVenueName();
      const rosterColspan = isAdminUser() ? 9 : 8;

      app.innerHTML = `
        <div class="db-page player-db-light-v96 player-db-v121 app-shell-v212 db-shell-v212">
          ${renderUnifiedPageHeaderV173({
            className: "db-titlebar-v131 db-titlebar-v132",
            kicker: "선수 관리",
            title: "선수 명단",
            description: "선수 등록, 명부 정리, 참가자 선택을 같은 흐름으로 관리합니다.",
            stats: [
              { label: "경기장", value: fixedVenueName || "-" },
              { label: "전체 선수", value: `${roster.length}명` },
              { label: "표시", value: `${filtered.length}명` },
              { label: "선택", value: `${visibleSelectedCount}명` }
            ]
          })}
          ${renderDbCommandBarV212(fixedVenueName)}
          <div class="db-grid db-player-layout-v98 db-player-layout-v99 db-player-layout-v121 ui-workspace-v212 db-workspace-v212"><aside class="db-player-side-v98 db-player-side-v99">
            <section class="card ui-panel-v212 db-quick-add-card-v96 db-register-card-v121" id="dbQuickAddPanel">
              <div class="db-panel-title"><h2>선수 등록</h2><span class="pill">${escapeHtml(fixedVenueName)}</span></div>
              ${isAdminUser() ? `<input type="hidden" id="dbAdminVenueName" value="${escapeAttr(fixedVenueName)}" />` : ""}
              <div class="db-register-form-v121">
                <div class="db-form-row-v121"><label>경기장</label><div class="db-fixed-value-v121">${escapeHtml(fixedVenueName)}</div></div>
                <div class="db-form-row-v121"><label for="dbRealName">실명</label><input class="mini-input" id="dbRealName" placeholder="입력" /></div>
                <div class="db-form-row-v121"><label for="dbNickname">닉네임</label><input class="mini-input" id="dbNickname" placeholder="입력" /></div>
                <div class="db-form-row-v121"><label for="dbTeam">팀명</label><input class="mini-input" id="dbTeam" list="dbTeamDatalist" placeholder="입력" autocomplete="off" /><datalist id="dbTeamDatalist">${teams.map(t => `<option value="${escapeAttr(t)}"></option>`).join("")}</datalist></div>
                <div class="db-form-row-v121"><label for="dbContact">연락처</label><input class="mini-input" id="dbContact" placeholder="입력" /></div>
                <div class="db-form-row-v121"><label for="dbMemo">메모</label><input class="mini-input" id="dbMemo" placeholder="입력" /></div>
              </div>
              <button class="primary db-primary-action-v120 db-primary-action-v121" onclick="addRosterPlayer()">선수 추가</button>
            </section>

            <section class="card ui-panel-v212 selected-box db-selected-card-v121"><div class="db-panel-title"><h2>참가자 선택</h2><span class="pill"><span id="selectedCount">0</span>명 선택</span></div><div class="db-actions db-selected-actions-v121" style="margin-bottom:10px;"><button class="ghost" onclick="selectRecentPlayers()">최근 참가자</button><button class="ghost" onclick="selectFavoritePlayers()">즐겨찾기</button><button class="ghost" onclick="clearSelectedPlayers()">선택 해제</button></div><div id="selectedPreview" class="finalist-grid selected-preview-v145"></div><button class="primary db-primary-action-v120 db-primary-action-v121" onclick="applySelectedPlayersToTournament()">선택 선수로 대진 생성 준비</button></section>
          </aside><main class="db-player-main-v98 db-player-main-v99"><section class="card ui-panel-v212 db-roster-list-card-v98 db-roster-list-card-v99"><div class="db-panel-title"><div><h2>선수 명부</h2><div class="meta">총 ${roster.length}명 · 표시 ${filtered.length}명</div></div><div class="db-actions db-filter-actions"><input class="mini-input" placeholder="검색(이름/팀/경기장)" value="${escapeHtml(dbSearchText)}" oninput="setDbSearch(this.value)"  /><select onchange="setDbTeamFilter(this.value)" ><option value="전체">전체 팀</option>${teams.map(team => `<option value="${escapeHtml(team)}" ${team === dbTeamFilter ? "selected" : ""}>${escapeHtml(team)}</option>`).join("")}</select><select onchange="setDbStatusFilter(this.value)" >${["전체", "활성", "비활성", "즐겨찾기", "연락처 있음", "연락처 없음"].map(value => `<option value="${value}" ${value === dbStatusFilter ? "selected" : ""}>${value}</option>`).join("")}</select></div></div><div class="db-stat-grid"><div class="db-stat"><small>전체 선수</small><strong>${roster.length}</strong></div><div class="db-stat"><small>활성 선수</small><strong>${activeCount}</strong></div><div class="db-stat"><small>즐겨찾기</small><strong>${favoriteCount}</strong></div><div class="db-stat"><small>연락처 미등록</small><strong>${missingContactCount}</strong></div></div><div class="db-bulk-toolbar"><div><label class="db-checkline"><input type="checkbox" ${allVisibleSelected ? "checked" : ""} onchange="toggleVisibleSelectAll(this.checked)" /> 일괄 선택</label><span class="hint db-bulk-count-v130">${filtered.length}명 · 선택 ${visibleSelectedCount}명</span></div><div class="db-bulk-buttons"><button class="ghost" onclick="selectVisiblePlayers()">전체 선택</button><button class="ghost" onclick="deselectVisiblePlayers()">선택 해제</button><button class="ghost" onclick="selectAllActivePlayers()">활성 선수만 선택</button>${dbSortButton("realName", "실명")}${dbSortButton("nickname", "닉네임")}${dbSortButton("team", "팀명")}${isAdminUser() ? dbSortButton("venue", "경기장") : ""}${dbSortButton("createdAt", "등록일")}</div></div><div class="roster-table-wrap db-roster-scroll-v98 db-roster-scroll-v99"><table class="roster-table roster-table-v121 ${isAdminUser() ? "roster-table-admin-v203" : "roster-table-venue-v203"}"><thead><tr><th><input type="checkbox" ${allVisibleSelected ? "checked" : ""} onchange="toggleVisibleSelectAll(this.checked)" /></th><th>★</th>${isAdminUser() ? `<th><button class="ghost table-sort-btn" onclick="setDbSort('venue')">경기장${dbSortField === "venue" ? (dbSortDir === "asc" ? " ▲" : " ▼") : ""}</button></th>` : ""}<th><button class="ghost table-sort-btn" onclick="setDbSort('realName')">실명${dbSortField === "realName" ? (dbSortDir === "asc" ? " ▲" : " ▼") : ""}</button></th><th><button class="ghost table-sort-btn" onclick="setDbSort('nickname')">닉네임${dbSortField === "nickname" ? (dbSortDir === "asc" ? " ▲" : " ▼") : ""}</button></th><th><button class="ghost table-sort-btn" onclick="setDbSort('team')">팀명${dbSortField === "team" ? (dbSortDir === "asc" ? " ▲" : " ▼") : ""}</button></th><th>연락처</th><th>메모</th><th>상태&관리</th></tr></thead><tbody>${filtered.map(player => renderRosterRow(player)).join("") || `<tr><td colspan="${rosterColspan}"><div class="db-empty">등록된 선수가 없습니다.</div></td></tr>`}</tbody></table></div></section></main></div></div>`;
      updateSelectedPreview();
    }

    function runDuplicateNameMigration() {
      // [v114 동명이인 정리] 전 경기장 기준 실명 동명이인에게 등록순 B·C·D 접미사 부여 (관리자 전용)
      if (!isAdminUser()) { alert("관리자만 실행할 수 있습니다."); return; }
      if (!confirm("전체 경기장의 동명이인에게 등록순으로 B·C·D 접미사를 부여합니다.\n실행 전 Firebase 데이터 백업을 권장합니다. 계속할까요?")) return;
      const db = initFirebase();
      if (!db || !currentAuthUser) { alert("저장 연결이 필요합니다."); return; }
      db.ref("venues").get().then(snapshot => {
        const allVenues = snapshot.val() || {};
        const entries = [];
        Object.keys(allVenues).forEach(vId => {
          const players = (allVenues[vId] || {}).players || {};
          Object.keys(players).forEach(key => {
            const p = players[key] || {};
            const realName = String(p.realName || "").trim();
            if (!realName) return; // 실명 없는 선수는 제외
            entries.push({ vId, key, realName, createdAt: p.createdAt || "" });
          });
        });
        const groups = {};
        entries.forEach(e => { (groups[e.realName] = groups[e.realName] || []).push(e); });
        const SUFFIX = "BCDEFGHIJKLMNOPQRSTUVWXYZ";
        const updates = {};
        let changed = 0;
        Object.keys(groups).forEach(name => {
          const list = groups[name];
          if (list.length < 2) return; // 동명이인 아님
          list.sort((a, b) => {
            if (!a.createdAt && !b.createdAt) return 0;
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
          });
          list.forEach((e, idx) => {
            if (idx === 0) return; // 첫 등록자는 원래 실명 유지
            const suffix = SUFFIX[idx - 1] || ("_" + (idx + 1));
            updates["venues/" + e.vId + "/players/" + e.key + "/realName"] = name + suffix;
            changed++;
          });
        });
        if (changed === 0) { alert("정리할 동명이인이 없습니다. (이미 구분되어 있거나 중복 없음)"); return; }
        db.ref().update(updates).then(() => {
          dbCloudLoadedVenueId = null; // 캐시 무효화 → 재로드
          alert("동명이인 정리 완료: " + changed + "명에게 접미사를 부여했습니다.");
        }).catch(err => alert("정리 저장 실패: " + (err.message || err)));
      }).catch(err => alert("경기장 데이터 로드 실패: " + (err.message || err)));
    }

    function renderRosterRow(player) {
      const key = rosterRecordKey(player);
      const activeAction = player.active ? "active" : "inactive";
      const venueCell = isAdminUser() ? `<td data-label="경기장">${venueSelectMarkupForRoster(player, key)}</td>` : "";
      return `<tr><td data-label="참가"><input type="checkbox" data-roster-select value="${escapeAttr(key)}" ${dbSelectedIds.has(key) ? "checked" : ""} ${player.active ? "" : "disabled"} onchange="toggleDbSelected('${escapeAttr(key)}', this.checked)" /></td><td data-label="즐겨찾기"><button class="ghost roster-star-btn-v121" onclick="toggleRosterField('${escapeAttr(key)}', 'favorite')">${player.favorite ? "★" : "☆"}</button></td>${venueCell}<td data-label="실명"><input class="mini-input" placeholder="입력" value="${escapeHtml(player.realName || "")}" onchange="updateRosterInline('${escapeAttr(key)}', 'realName', this.value)" /></td><td data-label="닉네임"><input class="mini-input" placeholder="입력" value="${escapeHtml(player.nickname || "")}" onchange="updateRosterInline('${escapeAttr(key)}', 'nickname', this.value)" /></td><td data-label="팀명"><input class="mini-input" placeholder="입력" value="${escapeHtml(player.team || "")}" onchange="updateRosterInline('${escapeAttr(key)}', 'team', this.value)" /></td><td data-label="연락처"><input class="mini-input" placeholder="입력" value="${escapeHtml(player.contact || "")}" onchange="updateRosterInline('${escapeAttr(key)}', 'contact', this.value)" /></td><td data-label="메모"><input class="mini-input" placeholder="입력" value="${escapeHtml(player.memo || "")}" onchange="updateRosterInline('${escapeAttr(key)}', 'memo', this.value)" /></td><td data-label="상태&관리"><select class="mini-input roster-action-select-v121 ${player.active ? "active" : "inactive"}" onchange="handleRosterAction('${escapeAttr(key)}', this.value)"><option value="active" ${activeAction === "active" ? "selected" : ""}>활성</option><option value="inactive" ${activeAction === "inactive" ? "selected" : ""}>비활성</option><option value="delete">삭제</option></select></td></tr>`;
    }

    function getCurrentTournamentId() {
      ensureStateDefaults();
      const params = getHashParams();
      const fromHash = params.get("t") || params.get("tournamentId");
      if (fromHash) {
        firebaseTournamentId = normalizeKey(String(fromHash).trim()) || DEFAULT_TOURNAMENT_ID;
        safeSetItem("mini4wdTournamentId", firebaseTournamentId);
        return firebaseTournamentId;
      }
      const canonicalId = buildAutoTournamentId();
      const signature = canonicalId;
      const storedSignature = localStorage.getItem("mini4wdActiveLiveSignature") || "";
      const storedId = localStorage.getItem("mini4wdActiveLiveId") || "";
      if (state.tournament.status === "running") {
        if (state.tournament.liveId && state.tournament.liveSignature === signature) {
          firebaseTournamentId = state.tournament.liveId;
        } else if (storedId && storedSignature === signature) {
          firebaseTournamentId = storedId;
          state.tournament.liveId = storedId;
          state.tournament.liveSignature = signature;
        } else {
          firebaseTournamentId = canonicalId;
          state.tournament.liveId = canonicalId;
          state.tournament.liveSignature = signature;
        }
        safeSetItem("mini4wdActiveLiveId", firebaseTournamentId);
        safeSetItem("mini4wdActiveLiveSignature", signature);
      } else {
        firebaseTournamentId = canonicalId;
      }
      safeSetItem("mini4wdTournamentId", firebaseTournamentId);
      return firebaseTournamentId;
    }


    function setTournamentField(field, value) {
      ensureStateDefaults();
      if (field === "venue" && isVenueUser()) value = currentVenueName();
      state.tournament[field] = value;
      saveLiveState();
    }

    function validateTournamentMetaRequired() {
      ensureStateDefaults();
      if (isVenueUser()) state.tournament.venue = currentVenueName();
      if (!state.tournament.name.trim()) { showError("대회명을 입력해야 시작할 수 있습니다."); alert("대회명을 입력하세요."); return false; }
      if (!state.tournament.venue.trim()) { showError("경기장을 입력해야 시작할 수 있습니다."); alert("경기장을 입력하세요."); return false; }
      state.tournament.raceClass = normalizeRaceClassName(state.tournament.raceClass);
      return true;
    }

    function resolvePlayerIdentity(player) {
      if (!player || player.isEmptyLane) return { playerId: "", realName: "", contact: "" };
      const sourcePlayerId = player.sourcePlayerId || player.originalPlayerId || player.basePlayerId || player.id;
      const match = loadRoster().find(item => item.id === sourcePlayerId || item.id === player.id) || findRosterMatch(player.name, player.team);
      return { playerId: match?.id || sourcePlayerId || player.id || "", realName: match?.realName || player.realName || "", contact: match?.contact || player.contact || "" };
    }
function exportTournamentCsv() {
      ensureTournamentStarted();
      const rows = getStageResultRows();
      if (!rows.length) return alert("다운로드할 경기 결과가 없습니다.");
      const headers = ["경기일시", "종료일시", "대회상태", "대회명", "경기장", "경기장ID", "클래스", "경기방식", "레인수", "차수", "단계", "조", "레인", "선수ID", "실명", "연락처", "선수명", "팀명", "점수", "결과", "비고"];
      downloadTextFile(`tournament_result_${Date.now()}.csv`, toCsv([headers, ...rows.map(row => headers.map(header => row[header] ?? ""))]));
    }

    function makePublicRecord(record) {
      const publicRows = (record.rows || []).map(row => ({
        차수: row.차수 || "",
        단계: row.단계 || "",
        조: row.조 || "",
        레인: row.레인 || "",
        선수명: row.선수명 || row.닉네임 || "",
        팀명: row.팀명 || "",
        점수: row.점수 ?? "",
        결과: row.결과 || "",
        비고: row.비고 || ""
      }));
      const winners = publicRows.filter(row => row.결과 === "최종우승").map(row => row.선수명).filter(Boolean);
      return {
        id: record.id,
        venueId: record.venueId || "",
        venueName: record.venueName || "",
        raceClass: normalizeRaceClassName(record.raceClass || "오픈"),
        tournamentName: record.tournamentName || "",
        startedAtISO: record.startedAtISO || "",
        endedAtISO: record.endedAtISO || "",
        createdAt: record.createdAt || new Date().toISOString(),
        mode: record.mode || "",
        laneCount: record.laneCount || 3,
        participantCount: new Set(publicRows.filter(row => row.결과 !== "빈 레인").map(row => `${row.선수명}|${row.팀명}`)).size,
        winners,
        rows: publicRows
      };
    }

    function makeTournamentRecord() {
      ensureStateDefaults();
      const id = state.tournament.recordId || state.tournament.id || `record-${Date.now()}`;
      state.tournament.recordId = id;
      return { id, venueId: currentVenueId(), venueName: state.tournament.venue || currentVenueName(), raceClass: normalizeRaceClassName(state.tournament.raceClass), tournamentName: state.tournament.name || "", startedAtISO: state.tournament.startedAtISO || "", endedAtISO: state.tournament.endedAtISO || "", createdAt: new Date().toISOString(), mode: state.settings.matchMode, laneCount: state.settings.laneCount, rows: getStageResultRows() };
    }

    function saveTournamentRecord() {
      const record = makeTournamentRecord();
      const publicRecord = makePublicRecord(record);
      const local = loadLocalResultLogs().filter(item => item.id !== record.id);
      local.push(record);
      safeSetItem(LOCAL_RESULT_LOGS_KEY, JSON.stringify(local));
      const db = initFirebase();
      if (db && currentAuthUser) {
        db.ref(`${RESULT_LOGS_PATH}/${record.venueId}/${record.id}`).set(record).catch(error => console.warn("private result log save failed", error));
        db.ref(`${PUBLIC_HISTORY_PATH}/${record.id}`).set(publicRecord).catch(error => console.warn("public history save failed", error));
      }
    }

    function loadLocalResultLogs() {
      try { const data = JSON.parse(localStorage.getItem(LOCAL_RESULT_LOGS_KEY) || "[]"); return Array.isArray(data) ? data : []; } catch (e) { return []; }
    }

    function finishTournament() {
      finishTournamentAsyncV116();
    }

    function getFinalWinners(finalRace = state.finalRace) {
    return getFinalGroups(finalRace).flatMap(group =>
      (group.slots || []).filter(player =>
        !player.isEmptyLane && (group.advanceIds || []).includes(player.id)
      )
    );
  }

  function isTournamentFinalResultReady() {
    if (isRevivalMode()) return Boolean(state.qualifierRounds?.[0]?.finalist);
    if (!state.finalRace || state.finalRace.type === "crowSemi") return false;
    return getFinalWinners().length > 0;
  }

  function getTournamentFinishRequirementText() {
    return isRevivalMode()
      ? "결승 우승자 확정 후 종료 가능"
      : "최종 결승 우승자 확정 후 종료 가능";
  }

    async function finishTournamentAsyncV116() {
      ensureStateDefaults();
      if (!canModifyTournamentAction("대회 종료")) return;
      if (state.tournament.status === "running" && !isTournamentFinalResultReady()) {
      const message = getTournamentFinishRequirementText();
      showError(message);
      alert(message);
      return;
    }
    if (state.tournament.status === "running" && !confirm("최종 결과를 저장하고 대회를 종료할까요?\n종료 후 새 대회 준비 상태로 전환됩니다.")) return;
    if (state.tournament.status !== "running" && !confirm("현재 진행중 상태가 아닙니다. 그래도 종료할까요?")) return;
      const now = new Date();
      state.tournament.endedAtISO = now.toISOString();
      state.tournament.endedAtDisplay = formatDateTimeLocal(now);
      state.tournament.status = "finished";
      state.settings.firebaseAutoSave = false;
      state.updatedAt = Date.now();
      state.activeRoundIndex = activeRoundIndex;
      createAutoSnapshot("대회 종료");
      saveTournamentRecord();
      logTournamentAction("대회 종료", state.tournament.name || "");

      try {
        await forceLiveBroadcastSync("tournament-finish");
      } catch (error) {
        console.warn("finish live sync failed", error);
      }

      releaseActiveTournamentForVenue("finished-clear");
      prepareNextTournamentDraftV116("finish-auto-next");
      renderOperator();
    }

    function getPlayerKeyFromRow(row) {
      return row.선수ID || playerIdentityKey(row.실명 || row.선수명, row.연락처 || "") || `${row.선수명}|${row.팀명 || ""}`;
    }

    function isRankWinnerResultV188(result) {
      const text = String(result || "");
      return /^9강\s*1위$/.test(text) || /^순위결정\s*1위$/.test(text);
    }

    function isLegacyPointTieBreakRowV189(row = {}, lowScoreWins = false) {
      if (!lowScoreWins) return false;
      const note = String(row?.비고 || "");
      const stageName = String(row?.단계 || "");
      return note === "pointTieBreak" || /동점.*순위|순위.*결정/.test(stageName);
    }

    function isDashboardAdvanceResult(result, row = {}, lowScoreWins = false) {
      void row;
      void lowScoreWins;
      return isCountableWinResultV192(result);
    }

    function isLegacyLowScorePointRecordV189(record = {}) {
      const rows = Array.isArray(record.rows) ? record.rows : [];
      const mode = normalizeMatchMode(record.mode || record.matchMode || "");
      if (mode === "points5Tree") return true;
      const text = [
        record.경기방식,
        record.modeLabel,
        record.matchModeLabel,
        ...rows.flatMap(row => [row?.경기방식, row?.비고, row?.단계])
      ].filter(Boolean).map(value => String(value)).join(" ");
      if (/points5Tree|포인트전\s*5회|5회\s*포인트|low-score-tree|pointTieBreak|pointLadder|트리타기/.test(text)) return true;
      return rows.some(row => /포인트\s*5차전/.test(String(row?.단계 || "")));
    }

    function isLowScorePointRecordV188(record = {}) {
      return isLegacyLowScorePointRecordV189(record);
    }

    function getDashboardPointWinnerKeys(record = {}) {
      const winners = new Set();
      const groups = new Map();
      const lowScoreWins = isLowScorePointRecordV188(record);
      (record.rows || []).forEach(row => {
        if (!row || row.결과 !== "포인트") return;
        const key = `${row.차수 || ""}|${row.단계 || ""}|${row.조 || ""}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      groups.forEach(rows => {
        const scored = rows.map(row => ({ row, score: Number(row.점수) })).filter(item => Number.isFinite(item.score));
        if (!scored.length) return;
        const winnerScore = lowScoreWins
          ? Math.min(...scored.map(item => item.score))
          : Math.max(...scored.map(item => item.score));
        scored.filter(item => item.score === winnerScore).forEach(item => winners.add(`${item.row.차수 || ""}|${item.row.단계 || ""}|${item.row.조 || ""}|${getPlayerKeyFromRow(item.row)}`));
      });
      return winners;
    }

    function analyzeRecords(records) {
      const player = new Map();
      const lane = new Map();
      records.forEach(record => {
        const pointWinnerKeys = getDashboardPointWinnerKeys(record);
        const lowScoreWins = isLowScorePointRecordV188(record);
        (record.rows || []).forEach(row => {
        if (!row || row.결과 === "빈 레인") return;
        const key = getPlayerKeyFromRow(row);
        const pointWinnerKey = `${row.차수 || ""}|${row.단계 || ""}|${row.조 || ""}|${key}`;
        const wonHeat = isDashboardAdvanceResult(row.결과, row, lowScoreWins) || pointWinnerKeys.has(pointWinnerKey);
        const name = row.선수명 || row.실명 || key;
        const item = player.get(key) || { key, name, team: row.팀명 || "", matches: 0, wins: 0, losses: 0, championships: 0, finals: 0, points: 0, lanes: {} };
        item.matches += 1;
        item.points += Number(row.점수 || 0);
        const laneNo = String(row.레인 || "").replace(/[^0-9]/g, "") || "?";
        item.lanes[laneNo] = (item.lanes[laneNo] || 0) + 1;
        if (wonHeat) item.wins += 1;
        if (row.결과 === "탈락") item.losses += 1;
        if (row.결과 === "최종우승") item.championships += 1;
        if (["최종결승진출", "결승진출", "결승참가", "최종우승"].includes(row.결과)) item.finals += 1;
        player.set(key, item);
        const laneStat = lane.get(laneNo) || { lane: laneNo, matches: 0, wins: 0 };
        laneStat.matches += 1;
        if (wonHeat) laneStat.wins += 1;
        lane.set(laneNo, laneStat);
        });
      });
      const players = Array.from(player.values());
      const oneLane = players.map(p => { const top = Object.entries(p.lanes).sort((a,b)=>b[1]-a[1])[0] || ["",0]; return { ...p, mainLane: top[0], mainLaneCount: top[1], laneRate: p.matches ? top[1] / p.matches : 0 }; }).filter(p => p.matches >= 3).sort((a,b)=>b.laneRate-a.laneRate || b.matches-a.matches);
      return { players, laneStats: Array.from(lane.values()).sort((a,b)=>Number(a.lane)-Number(b.lane)), mostWins: [...players].sort((a,b)=>b.wins-a.wins), mostChampions: [...players].sort((a,b)=>b.championships-a.championships), mostLosses: [...players].sort((a,b)=>b.losses-a.losses), mostParticipants: [...players].sort((a,b)=>b.matches-a.matches), mostPoints: [...players].sort((a,b)=>b.points-a.points), oneLane };
    }

    function rankList(items, field, suffix = "") {
      return `<div class="rank-list">${items.slice(0, 10).map((item, index) => `<div class="rank-row"><b>${index + 1}</b><span class="rank-name">${escapeHtml(item.name)}${item.team ? ` / ${escapeHtml(item.team)}` : ""}</span><strong>${item[field]}${suffix}</strong></div>`).join("") || `<div class="hint">데이터 없음</div>`}</div>`;
    }

    function venueSelectKey(id, name) {
      const venueName = String(name || "").trim();
      const venueId = String(id || "").trim();
      return normalizeKey(venueName || venueId || "unknown-venue");
    }

    function venueMatchesFilter(record = {}, selected = "전체") {
      if (!selected || selected === "전체") return true;
      const id = String(record.venueId || "").trim();
      const name = String(record.venueName || "").trim();
      const selectedText = String(selected || "").trim();
      const selectedKey = normalizeKey(selectedText);
      return selectedText === id || selectedText === name || selectedKey === normalizeKey(id) || selectedKey === normalizeKey(name) || selectedKey === venueSelectKey(id, name);
    }

    function filterRecords(records) {
      const limitedVenueId = !isAdminUser() && isVenueUser() ? currentVenueId() : "";
      const limitedVenueName = !isAdminUser() && isVenueUser() ? currentVenueName() : "";
      return records.filter(record => {
        const date = String(record.endedAtISO || record.startedAtISO || record.createdAt || "").slice(0, 10);
        const recordClass = normalizeRaceClassName(record.raceClass || "미분류");
        if (limitedVenueId && !venueMatchesFilter(record, limitedVenueId) && !venueMatchesFilter(record, limitedVenueName)) return false;
        if (dashboardFilter.from && date < dashboardFilter.from) return false;
        if (dashboardFilter.to && date > dashboardFilter.to) return false;
        if (!venueMatchesFilter(record, dashboardFilter.venue)) return false;
        if (dashboardFilter.raceClass !== "전체" && recordClass !== dashboardFilter.raceClass) return false;
        if (dashboardFilter.keyword && !`${record.tournamentName} ${record.venueName} ${recordClass}`.toLowerCase().includes(dashboardFilter.keyword.toLowerCase())) return false;
        return true;
      });
    }

    function summarizeClasses(records) {
      const map = new Map();
      records.forEach(record => {
        const key = normalizeRaceClassName(record.raceClass || "미분류");
        map.set(key, (map.get(key) || 0) + 1);
      });
      return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([raceClass, count]) => ({ raceClass, count }));
    }

    function localDateInputValue(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    function setDashboardPeriod(mode) {
      const today = new Date();
      if (mode === "all") {
        dashboardFilter.from = "";
        dashboardFilter.to = "";
      } else if (mode === "month") {
        dashboardFilter.from = localDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1));
        dashboardFilter.to = localDateInputValue(today);
      } else if (mode === "30d") {
        const from = new Date(today);
        from.setDate(from.getDate() - 29);
        dashboardFilter.from = localDateInputValue(from);
        dashboardFilter.to = localDateInputValue(today);
      }
      renderDashboardWithRecords(window.__dashboardRecords || []);
    }

    function dashboardVenueOptions(records = []) {
      const map = new Map();
      const addVenue = (id, name, source = "") => {
        let venueId = String(id || "").trim();
        let venueName = String(name || "").trim();
        if (!venueName && venueId) venueName = venueId;
        if (!venueId && venueName) venueId = normalizeKey(venueName);
        if (!venueId && !venueName) return;
        if (venueId === "all" || venueName === "전체") return;
        const nameKey = normalizeKey(venueName || venueId);
        const idKey = normalizeKey(venueId || venueName);
        const key = nameKey || idKey || `${source}-${map.size}`;
        const current = map.get(key) || { id: key, name: venueName || venueId, aliases: new Set(), sourceList: new Set() };
        if (venueName && (!current.name || current.name === current.id || current.name === venueId)) current.name = venueName;
        [venueId, venueName, nameKey, idKey, key].filter(Boolean).forEach(value => current.aliases.add(String(value)));
        if (source) current.sourceList.add(source);
        map.set(key, current);
      };

      const addVenueObjectMap = (raw = {}, source = "") => {
        if (!raw || typeof raw !== "object") return;
        Object.entries(raw).forEach(([id, item]) => {
          if (!item || typeof item !== "object") return;
          addVenue(item.venueId || item.id || id, item.venueName || item.name || item.displayName || id, source);
        });
      };

      if (isAdminUser()) {
        addVenueObjectMap(window.__dashboardPublicVenues || {}, "publicVenues");
        addVenueObjectMap(window.__dashboardVenueDirectory || {}, "publicVenueDirectory");
        Object.values(window.__dashboardProfiles || {}).forEach(profile => {
          if (!profile || profile.role === "suspended") return;
          if (profile.venueName || profile.venueId) addVenue(profile.venueId, profile.venueName, "userProfiles");
        });
        Object.values(window.__dashboardLegacyUsers || {}).forEach(profile => {
          if (!profile || profile.role === "suspended") return;
          if (profile.venueName || profile.venueId) addVenue(profile.venueId, profile.venueName, "legacyUsers");
        });
        records.forEach(record => addVenue(record.venueId, record.venueName, "records"));
      } else if (isVenueUser()) {
        addVenue(currentVenueId(), currentVenueName(), "currentUser");
      }

      return Array.from(map.values())
        .map(item => ({ id: item.id, name: item.name, aliases: Array.from(item.aliases), sourceList: Array.from(item.sourceList) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }

    function analyzePlayerVenueVisits(records) {
      const map = new Map();
      records.forEach(record => {
        const venue = record.venueName || record.venueId || "미지정";
        const seen = new Map();
        (record.rows || []).forEach(row => {
          if (!row || row.결과 === "빈 레인") return;
          const key = row.선수ID || playerIdentityKey(row.실명 || row.선수명, row.연락처 || "") || `${row.선수명}|${row.팀명 || ""}`;
          if (!seen.has(key)) seen.set(key, { key, name: row.선수명 || row.실명 || key, realName: row.실명 || "", team: row.팀명 || "" });
        });
        seen.forEach(player => {
          const item = map.get(player.key) || { ...player, totalVisits: 0, venues: {} };
          item.totalVisits += 1;
          item.venues[venue] = (item.venues[venue] || 0) + 1;
          map.set(player.key, item);
        });
      });
      return Array.from(map.values()).sort((a,b) => b.totalVisits - a.totalVisits || Object.keys(b.venues).length - Object.keys(a.venues).length);
    }

    function renderVenueVisitList(items) {
      return `<div class="venue-visit-list">${items.slice(0, 10).map((item, index) => {
        const venueText = Object.entries(item.venues).sort((a,b)=>b[1]-a[1]).map(([venue,count]) => `${escapeHtml(venue)} ${count}회`).join(" · ");
        return `<div class="venue-visit-row"><b>${index + 1}</b><span>${escapeHtml(item.name)}${item.realName && item.realName !== item.name ? `<small>실명 ${escapeHtml(item.realName)}</small>` : ""}<small>${venueText}</small></span><strong>${item.totalVisits}회</strong></div>`;
      }).join("") || `<div class="hint">데이터 없음</div>`}</div>`;
    }

    function renderDashboardWithRecords(records) {
      setUiSurfaceV149("dashboard");
      const venueOptions = dashboardVenueOptions(records);
      if (dashboardFilter.venue !== "전체" && !venueOptions.some(v => v.id === dashboardFilter.venue || v.name === dashboardFilter.venue || (v.aliases || []).includes(dashboardFilter.venue) || normalizeKey(dashboardFilter.venue) === v.id)) dashboardFilter.venue = "전체";
      const filtered = filterRecords(records);
      const classes = Array.from(new Set([...CLASS_OPTIONS, ...records.map(r => normalizeRaceClassName(r.raceClass || "미분류")).filter(Boolean)]));
      const classStats = summarizeClasses(filtered);
      const stats = analyzeRecords(filtered);
      const venueVisits = analyzePlayerVenueVisits(filtered);
      document.body.classList.remove("tv-mode");
      app.innerHTML = `<div class="db-page dashboard-page-v132 app-shell-v212 dashboard-shell-v212">${renderUnifiedPageHeaderV173({ className: "dashboard-titlebar-v132", kicker: "기록 분석", title: "대시보드", description: "기간, 경기장, 클래스 기준으로 대회 기록을 확인합니다.", stats: [{ label: "대회 기록", value: `${filtered.length}건` }, { label: "경기장", value: `${new Set(filtered.map(r=>r.venueName||r.venueId)).size}곳` }, { label: "선수", value: `${stats.players.length}명` }, { label: "클래스", value: `${classStats.length}개` }] })}${currentAuthUser ? accountBadge() : renderPageNav()}<div class="toolbar dashboard-actions-toolbar"><button class="ghost" onclick="dashboardFilter.venue='전체'; renderDashboardWithRecords(window.__dashboardRecords||[])">전체 경기장</button><button class="ghost" onclick="openDashboardPage()">새로고침</button></div><section class="card ui-panel-v212 dashboard-filter-panel-v212"><div class="dashboard-filter"><div><label>시작일</label><input class="mini-input" type="date" value="${escapeHtml(dashboardFilter.from)}" onchange="dashboardFilter.from=this.value; renderDashboardWithRecords(window.__dashboardRecords||[])" /></div><div><label>종료일</label><input class="mini-input" type="date" value="${escapeHtml(dashboardFilter.to)}" onchange="dashboardFilter.to=this.value; renderDashboardWithRecords(window.__dashboardRecords||[])" /></div><div><label>경기장</label><select class="mini-input" onchange="dashboardFilter.venue=this.value; renderDashboardWithRecords(window.__dashboardRecords||[])"><option value="전체">전체 경기장</option>${venueOptions.map(v => `<option value="${escapeHtml(v.id)}" ${dashboardFilter.venue===v.id || dashboardFilter.venue===v.name || (v.aliases || []).includes(dashboardFilter.venue) || normalizeKey(dashboardFilter.venue)===v.id ? "selected" : ""}>${escapeHtml(v.name)}</option>`).join("")}</select></div><div><label>클래스</label><select class="mini-input" onchange="dashboardFilter.raceClass=this.value; renderDashboardWithRecords(window.__dashboardRecords||[])"><option value="전체">전체 클래스</option>${classes.map(c => `<option value="${escapeHtml(c)}" ${dashboardFilter.raceClass===c?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></div><div><label>검색</label><input class="mini-input" placeholder="대회명/경기장/클래스" value="${escapeHtml(dashboardFilter.keyword)}" oninput="dashboardFilter.keyword=this.value; renderDashboardWithRecords(window.__dashboardRecords||[])" /></div></div><div class="dashboard-period-row"><button class="ghost" onclick="setDashboardPeriod('all')">전체 기간</button><button class="ghost" onclick="setDashboardPeriod('month')">이번달</button><button class="ghost" onclick="setDashboardPeriod('30d')">최근 30일</button></div><div class="db-stat-grid" style="margin-top:12px;"><div class="db-stat"><small>대회 기록</small><strong>${filtered.length}</strong></div><div class="db-stat"><small>경기장</small><strong>${new Set(filtered.map(r=>r.venueName||r.venueId)).size}</strong></div><div class="db-stat"><small>선수</small><strong>${stats.players.length}</strong></div></div></section><div class="dashboard-grid ui-workspace-v212 dashboard-workspace-v212"><section class="dashboard-card ui-panel-v212"><h3>클래스별 기록</h3><div class="class-chip-wrap">${classStats.map(item => `<div class="class-chip"><span>${escapeHtml(item.raceClass)}</span><b>${item.count}회</b></div>`).join("") || `<div class="hint">데이터 없음</div>`}</div></section><section class="dashboard-card ui-panel-v212"><h3>선수별 경기장 방문</h3>${renderVenueVisitList(venueVisits)}</section><section class="dashboard-card ui-panel-v212"><h3>최다승 유저</h3>${rankList(stats.mostWins, "wins", "승")}</section><section class="dashboard-card ui-panel-v212"><h3>자주 우승하는 사람</h3>${rankList(stats.mostChampions, "championships", "회")}</section><section class="dashboard-card ui-panel-v212"><h3>자주 지는 사람</h3>${rankList(stats.mostLosses, "losses", "패")}</section><section class="dashboard-card ui-panel-v212"><h3>참가 횟수 랭킹</h3>${rankList(stats.mostParticipants, "matches", "회")}</section><section class="dashboard-card ui-panel-v212"><h3>포인트전 누적</h3>${rankList(stats.mostPoints, "points", "P")}</section><section class="dashboard-card ui-panel-v212"><h3>한 레인 편중</h3><div class="rank-list">${stats.oneLane.slice(0,10).map((p,i)=>`<div class="rank-row"><b>${i+1}</b><span class="rank-name">${escapeHtml(p.name)} · ${p.mainLane}LANE</span><strong>${Math.round(p.laneRate*100)}%</strong></div>`).join("") || `<div class="hint">데이터 없음</div>`}</div></section><section class="dashboard-card ui-panel-v212"><h3>레인별 승률</h3><div class="rank-list">${stats.laneStats.map(l=>`<div class="rank-row"><b>${l.lane}</b><span class="rank-name">${l.matches}경기</span><strong>${l.matches ? Math.round(l.wins/l.matches*100) : 0}%</strong></div>`).join("") || `<div class="hint">데이터 없음</div>`}</div></section><section class="dashboard-card ui-panel-v212"><h3>결승 진출률</h3><div class="rank-list">${stats.players.filter(p=>p.matches).sort((a,b)=>(b.finals/b.matches)-(a.finals/a.matches)).slice(0,10).map((p,i)=>`<div class="rank-row"><b>${i+1}</b><span class="rank-name">${escapeHtml(p.name)}</span><strong>${Math.round(p.finals/p.matches*100)}%</strong></div>`).join("") || `<div class="hint">데이터 없음</div>`}</div></section></div></div>`;
      const legacyDashboardActions = app.querySelector(".dashboard-actions-toolbar");
      if (legacyDashboardActions) legacyDashboardActions.remove();
      const dashboardGrid = app.querySelector(".dashboard-page-v132 > .dashboard-grid");
      const classSummary = dashboardGrid?.querySelector(":scope > .dashboard-card:first-child");
      if (dashboardGrid && classSummary) {
        classSummary.classList.add("dashboard-class-summary-v146");
        dashboardGrid.before(classSummary);
      }
    }

    function getRecordWinnerText(record) {
      const rows = record?.rows || [];
      const winners = rows.filter(row => row.결과 === "최종우승").map(row => row.선수명 || row.닉네임).filter(Boolean);
      if (winners.length) return winners.join(", ");
      const advanced = rows.filter(row => ["최종결승진출", "진출"].includes(row.결과)).map(row => row.선수명 || row.닉네임).filter(Boolean).slice(0, 3);
      return advanced.length ? advanced.join(", ") : "결과 기록 없음";
    }

    function buildPublicVenuesFromProfiles(profiles = {}) {
      const map = new Map();
      Object.values(profiles || {}).forEach(profile => {
        const flags = profilePermissionFlags(profile);
        const venueName = String(profile?.venueName || "").trim();
        const venueId = String(profile?.venueId || normalizeKey(venueName)).trim();
        if (!venueName || !venueId || flags.role !== "venue" || !flags.approved || flags.suspended) return;
        if (!map.has(venueId)) map.set(venueId, { venueId, venueName, source: "approved-account", updatedAt: profile.approvedAt || profile.requestedAt || "" });
      });
      return Array.from(map.values()).sort((a, b) => String(a.venueName).localeCompare(String(b.venueName), "ko"));
    }

    function syncPublicVenuesFromProfiles(profiles = {}) {
      if (!isAdminUser()) return;
      const db = initFirebase();
      if (!db) return;
      const venues = buildPublicVenuesFromProfiles(profiles);
      const payload = Object.fromEntries(venues.map(venue => [venue.venueId, venue]));
      db.ref(PUBLIC_VENUES_PATH).set(payload).catch(error => console.warn("public venue sync failed", error));
      db.ref(PUBLIC_VENUE_DIRECTORY_PATH).set(payload).catch(error => console.warn("public venue directory sync failed", error));
    }

    function normalizePublicVenues(raw = {}) {
      if (!raw || typeof raw !== "object") return [];
      return Object.entries(raw).map(([id, item]) => ({
        venueId: item?.venueId || id,
        venueName: item?.venueName || id,
        source: item?.source || "public-venue",
        updatedAt: item?.updatedAt || ""
      })).filter(item => item.venueId && item.venueName);
    }

    function toTimeValue(value) {
      if (!value) return 0;
      if (typeof value === "number") return value;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : Number(value) || 0;
    }

    function effectiveLiveStatus(item = {}) {
      const status = item.status || "draft";
      const updatedAt = toTimeValue(item.updatedAt);
      if (status === "running" && updatedAt && Date.now() - updatedAt <= LIVE_STALE_MS) return "running";
      if (status === "running") return "stale";
      if (status === "finished" || status === "archived") return "recent";
      return "waiting";
    }

    function normalizeRecentTime(record = {}) {
      return toTimeValue(record.endedAtISO || record.createdAt || record.startedAtISO);
    }
function normalizeLobbyTournaments(raw = {}) {
      return Object.entries(raw).map(([id, item]) => {
        const st = item?.state || item || {};
        const tournament = st.tournament || {};
        const updatedAt = item?.updatedAt || st.updatedAt || 0;
        const status = tournament.status || (st.qualifierRounds?.some(r => (r.stages || []).length) ? "running" : "draft");
        return {
          id,
          state: st,
          updatedAt,
          venueId: tournament.venueId || st.venueId || normalizeKey(tournament.venue || id),
          venueName: tournament.venue || st.venueName || id,
          tournamentName: tournament.name || "대회명 미입력",
          raceClass: normalizeRaceClassName(tournament.raceClass),
          status
        };
      }).sort((a, b) => (b.status === "running") - (a.status === "running") || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

function flattenPrivateResultLogs(raw = {}) {
      if (!raw || typeof raw !== "object") return [];
      const values = Object.values(raw);
      if (values.some(item => item && typeof item === "object" && Array.isArray(item.rows))) return values;
      return Object.values(raw).flatMap(venueBucket => venueBucket && typeof venueBucket === "object" ? Object.values(venueBucket) : []).filter(item => item && typeof item === "object");
    }


    /* v83 responsive UX mode controller */
    function applyResponsiveUxModeV83() {
      try {
        const width = window.innerWidth || document.documentElement.clientWidth || 0;
        document.body.classList.toggle("ux-mobile", width <= 760);
        document.body.classList.toggle("ux-tablet", width > 760 && width <= 1180);
        document.body.classList.toggle("ux-desktop", width > 1180);
      } catch (error) {}
    }
    window.addEventListener("resize", () => requestAnimationFrame(applyResponsiveUxModeV83));
    window.addEventListener("orientationchange", () => setTimeout(applyResponsiveUxModeV83, 120));

    async function bootV33() {
      try {
        restorePersistedStateV95();
        applyResponsiveUxModeV83();
        const params = getHashParams();
        const view = params.get("view");
        const data = params.get("data");
        getCurrentTournamentId();
        initFirebase();
        if (view === "tv-live") { setUiSurfaceV149("tv-live"); document.body.classList.add("tv-mode"); app.innerHTML = `<div class="tv-wrap"><div class="tv-empty"><div class="tv-brand-line"><small>MINI4WD TOURNAMENT MAKER</small></div><strong>라이브 연결중</strong></div></div>`; watchFirebaseState("tv-live"); return; }
        if (view === "live-list" || view === "live-lobby" || view === "lobby") { renderLiveLobbyPage(); return; }
        if (view === "mobile-live" || view === "live") {
          const params = getHashParams();
          setUiSurfaceV149("mobile-live");
          app.innerHTML = `<div class="wrap"><div class="empty"><div><h2>라이브 연결중</h2><p>대회 ID: ${escapeHtml(getCurrentTournamentId())}</p></div></div></div>`;
          watchFirebaseState("mobile-live");
          return;
        }
        if ((view === "tv" || view === "mobile") && data) { try { renderTvSnapshot(decodePayload(data), view); } catch (error) { setUiSurfaceV149("error"); document.body.classList.remove("tv-mode"); app.innerHTML = `<div class="wrap"><div class="empty"><div><h2>공유 데이터를 읽을 수 없습니다</h2><p>링크가 손상되었거나 너무 깁니다.</p></div></div></div>`; } return; }
        if (view === "dashboard") {
          await initAuthState();
          if (!currentAuthUser) { renderLoginPage("대시보드는 로그인 후 이용할 수 있습니다."); return; }
          if (!canViewDashboard()) { renderRestrictedPage("대시보드 권한 없음", "관리자가 대시보드 권한을 부여해야 합니다."); return; }
          renderDashboardPage();
          return;
        }
        await initAuthState();
        if (view === "login") { renderLoginPage("로그인하세요."); return; }
        if (!currentAuthUser) { renderLoginPage(); return; }
        if (!canOperate()) { renderRestrictedPage("운영 권한 없음", "관리자가 운영 권한을 부여해야 합니다."); return; }
        if (isVenueUser()) state.tournament.venue = currentVenueName();
        if (view === "admin") { renderAdminPage(); return; }
        if (view === "admin-matches") { renderAdminMatchDataPage(); return; }
        if (view === "db") { renderDbPage(); return; }
        if (view === "print") { renderPrintView(); return; }
        const pending = localStorage.getItem(PENDING_PARTICIPANTS_KEY);
        if (pending) { state.inputText = pending; localStorage.removeItem(PENDING_PARTICIPANTS_KEY); }
        renderOperator();
      } catch (error) {
        console.error(error);
        setUiSurfaceV149("error");
        document.body.classList.remove("tv-mode");
        app.innerHTML = `<div class="wrap"><div class="empty"><div><h2>화면을 여는 중 오류가 발생했습니다</h2><p>${escapeHtml(error.message || String(error))}</p></div></div></div>`;
      }
    }



    /* v48 9강 + mobile live link fix overrides */
    function isCrowMode() {
      return state?.settings?.matchMode === "crow";
    }

    function ruleSummary(mode = state.settings.matchMode) {
      const normalized = normalizeMatchMode(mode);
      return {
        basic: "라운드별 결승 진출자를 모아 최종 결승을 진행합니다.",
        crow: "라운드별 1~3위 총 9명으로 준결/결승을 진행합니다.",
        points3: "3회 포인트 합산 후 상위 결정전을 진행합니다.",
        points5Tree: "5회 포인트 합산 후 낮은 점수 순 트리타기 결정전을 진행합니다.",
        revival: "패자부활 토너먼트입니다."
      }[normalized] || "라운드별 결승 진출자를 모아 최종 결승을 진행합니다.";
    }

    function matchModeLabel(mode = state.settings.matchMode) {
      const normalized = normalizeMatchMode(mode);
      return {
        basic: "토너먼트",
        crow: "토너먼트(9강)",
        points3: "포인트전 3회",
        points5Tree: "포인트전 5회",
        revival: "패자부활 토너먼트"
      }[normalized] || "토너먼트";
    }
function normalizePlayerForFinal(player, extra = {}) {
      return { id: player.id, name: player.name, nickname: player.nickname || player.name, team: player.team || "", realName: player.realName || "", contact: player.contact || "", ...extra };
    }

    function getCrowRoundRank(round, rank) {
      const list = round?.crowFinalists || [];
      return list.find(player => Number(player.crowRank) === Number(rank)) || null;
    }

    function getCrowRankHtml(round) {
      const selected = round?.crowFinalists || [];
      if (!selected.length) return `<div class="hint">라운드 결승에서 1위→2위→3위 순서로 선수를 선택한 뒤 1~3위 확정을 누르세요.</div>`;
      return `<div class="crow-rank-list">${[1,2,3].map(rank => {
        const player = selected.find(item => Number(item.crowRank) === rank);
        return `<div class="crow-rank-item"><b>${rank}위</b><span>${player ? `${escapeHtml(player.name)}${player.team ? " / " + escapeHtml(player.team) : ""}` : "미확정"}</span></div>`;
      }).join("")}</div>`;
    }


    function stageHasAnyResult(stage) {
      return !!(stage && (stage.groups || []).some(group => groupHasResult(group, stage)));
    }

    function roundHasAnyResult(round) {
      return !!(round && (round.stages || []).some(stage => stageHasAnyResult(stage)));
    }

    function rebuildUnplayedNormalRound(roundIndex) {
      const round = state.qualifierRounds?.[roundIndex];
      if (!round || roundHasAnyResult(round) || round.finalist) return false;
      const players = getEligibleParticipants();
      const error = validateStart(players, "예선");
      if (error) {
        showError(error);
        return false;
      }
      const plan = makeStagePlan(players.length, state.settings.laneCount);
      round.stagePlan = plan;
      round.stages = [generateStage(players, round.index, 1, plan[0])];
      return true;
    }

    function activateNextRoundAfterFinalist(roundIndex, silent = false) {
      const currentRound = state.qualifierRounds?.[roundIndex];
      if (!currentRound?.finalist) {
        if (!silent) showError("먼저 현재 라운드의 결승 진출자를 확정하세요.");
        return false;
      }
      const nextIndex = (state.qualifierRounds || []).findIndex((round, index) => index > roundIndex && !round.finalist);
      if (nextIndex < 0) return false;

      const nextRound = state.qualifierRounds[nextIndex];
      const hasPlayableStage = nextRound.stages && nextRound.stages.length > 0;
      const hasResult = roundHasAnyResult(nextRound);

      if (!hasPlayableStage || (state.settings.excludeFinalists && !hasResult)) {
        rebuildUnplayedNormalRound(nextIndex);
      }

      if (!nextRound.stages?.length) return false;
      activeRoundIndex = nextIndex;
      state.activeRoundIndex = nextIndex;
      state.broadcast = { mode: "stage", roundIndex: nextIndex, stageIndex: nextRound.stages.length - 1 };
      logTournamentAction("다음 라운드 전환", `${currentRound.title} 확정 → ${nextRound.title}`);
      syncOperatorLiveStateV269("activateNextRoundAfterFinalist");
      scheduleSettledLiveSyncV272("activateNextRoundAfterFinalist");
      return true;
    }

    function goToNextRoundAfterFinalist(roundIndex) {
      const round = state.qualifierRounds?.[roundIndex];
      const lastStage = round?.stages?.[round.stages.length - 1];
      if (!round?.finalist && isConfirmableRoundFinalStageV228(lastStage)) {
        confirmRoundFinalist(roundIndex, { activateNext: !isRevivalMode() });
        requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
      const hasNextRound = (state.qualifierRounds || []).some((item, index) => index > roundIndex && !item.finalist);
      if (hasNextRound) captureOperatorUndoSnapshotV266("다음 라운드 이동");
      if (activateNextRoundAfterFinalist(roundIndex, false)) {
        renderOperator();
        syncOperatorLiveStateV269("goToNextRoundAfterFinalist");
        scheduleSettledLiveSyncV272("goToNextRoundAfterFinalist");
        requestAnimationFrame(() => document.getElementById("currentStageTop")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } else {
        renderOperator();
      }
    }

    function confirmRoundFinalist(roundIndex, options = {}) {
      const round = state.qualifierRounds[roundIndex];
      if (!round || !round.stages.length) return showError("먼저 해당 라운드를 진행하세요.");
      const lastStage = round.stages[round.stages.length - 1];
      const validFinalStage = isConfirmableRoundFinalStageV228(lastStage);
      if (!validFinalStage) return showError(isRevivalMode() ? "결승 경기에서만 우승자를 확정할 수 있습니다." : "라운드 결승 또는 포인트 결정전에서만 확정할 수 있습니다.");
      const selected = getSelectedFromStage(lastStage);

      if (isCrowMode()) {
        if (selected.length !== 3) return showError("토너먼트(9강) 방식은 각 라운드 결승에서 1~3위 3명을 선택해야 합니다. 선택 순서가 1위, 2위, 3위입니다.");
        captureOperatorUndoSnapshotV266("진출 확정");
        round.crowFinalists = selected.slice(0, 3).map((player, index) => normalizePlayerForFinal(player, { crowRank: index + 1, sourceRoundIndex: round.index }));
        round.finalist = round.crowFinalists[0];
        state.finalRace = null;
        state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
        logTournamentAction("9강 순위 확정", `${round.title}: ${round.crowFinalists.map(p => `${p.crowRank}위 ${p.name}`).join(" / ")}`);
        if (options.activateNext) activateNextRoundAfterFinalist(roundIndex, true);
        renderOperator();
        syncOperatorLiveStateV269("confirmRoundFinalist-crow");
        scheduleSettledLiveSyncV272("confirmRoundFinalist-crow");
        return;
      }

      if (selected.length === 0) return showError(isRevivalMode() ? "우승자를 선택하세요." : "최종 결승 진출자를 선택하세요.");
      if (selected.length > 1) return showError(isRevivalMode() ? "우승자는 1명만 선택해야 합니다." : "각 라운드의 최종 결승 진출자는 1명만 선택해야 합니다.");
      captureOperatorUndoSnapshotV266("진출 확정");
      round.finalist = selected[0];
      state.finalRace = null;
      state.broadcast = { mode: "stage", roundIndex, stageIndex: round.stages.length - 1 };
      if (isPointFinalDecisionStage(lastStage) || options.activateNext) activateNextRoundAfterFinalist(roundIndex, true);
      renderOperator();
      syncOperatorLiveStateV269("confirmRoundFinalist");
      scheduleSettledLiveSyncV272("confirmRoundFinalist");
    }

    function makeCrowSemiGroup(name, players) {
      return {
        id: `crow-${slugId(name)}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        slots: players.filter(Boolean).map((player, index) => makeCrowSemiSlot(player, index)),
        advanceIds: []
      };
    }

    function makeCrowSemiSlot(player, index) {
      const sourcePlayerId = String(player?.sourcePlayerId || player?.id || `crow-player-${index + 1}`);
      const sourceRoundIndex = Number.isFinite(Number(player?.sourceRoundIndex)) ? Number(player.sourceRoundIndex) : 0;
      const sourceRank = Number.isFinite(Number(player?.crowRank)) ? Number(player.crowRank) : index + 1;
      return {
        ...player,
        sourcePlayerId,
        id: `${sourcePlayerId}::crow-r${sourceRoundIndex + 1}-${sourceRank}`,
        lane: index + 1
      };
    }

    function createCrowSemiFinal() {
      const rounds = state.qualifierRounds.slice(0, 3);
      if (rounds.length < 3 || rounds.some(round => (round.crowFinalists || []).length < 3)) {
        return showError("토너먼트(9강) 방식은 1~3차 라운드 결승에서 각각 1~3위를 모두 확정해야 합니다.");
      }
      const groups = [
        makeCrowSemiGroup("9강 준결 1조", [getCrowRoundRank(rounds[0], 1), getCrowRoundRank(rounds[1], 2), getCrowRoundRank(rounds[2], 3)]),
        makeCrowSemiGroup("9강 준결 2조", [getCrowRoundRank(rounds[0], 2), getCrowRoundRank(rounds[1], 3), getCrowRoundRank(rounds[2], 1)]),
        makeCrowSemiGroup("9강 준결 3조", [getCrowRoundRank(rounds[0], 3), getCrowRoundRank(rounds[1], 1), getCrowRoundRank(rounds[2], 2)])
      ];
      captureOperatorUndoSnapshotV266("최종 결승 진행");
      state.finalRace = {
        id: `crow-semi-${Math.random().toString(36).slice(2, 8)}`,
        type: "crowSemi",
        name: "9강 최종 준결",
        groupSize: 3,
        groups
      };
      state.broadcast = { mode: "final" };
      logTournamentAction("9강 준결 생성", "9명 준결 편성");
      renderOperator();
      syncOperatorLiveStateV269("createCrowSemiFinal");
      scheduleSettledLiveSyncV272("createCrowSemiFinal");
    }

    function createCrowFinalFromSemi() {
      if (!state.finalRace || state.finalRace.type !== "crowSemi") return;
      const winners = (state.finalRace.groups || []).flatMap(group => group.slots.filter(player => !player.isEmptyLane && (group.advanceIds || []).includes(player.id)));
      if (winners.length !== 3) return showError("9강 준결 각 조에서 결승 진출자 1명씩 총 3명을 선택하세요.");
      captureOperatorUndoSnapshotV266("최종 결승 진행");
      state.finalRace = {
        id: `crow-final-${Math.random().toString(36).slice(2, 8)}`,
        type: "crowFinal",
        name: "9강 최종 결승",
        groupSize: 3,
        group: {
          id: `crow-final-group-${Math.random().toString(36).slice(2, 8)}`,
          name: "FINAL",
          slots: assignLanes(winners, 3),
          advanceIds: []
        }
      };
      state.broadcast = { mode: "final" };
      logTournamentAction("결승 생성", winners.map(p => p.name).join(" / "));
      renderOperator();
      syncOperatorLiveStateV269("createCrowFinalFromSemi");
      scheduleSettledLiveSyncV272("createCrowFinalFromSemi");
    }

    function createFinalRace() {
      if (!canModifyTournamentAction("최종 결승 생성")) return;
      if (isCrowMode()) return createCrowSemiFinal();
      const finalists = state.qualifierRounds.map(round => round.finalist).filter(Boolean);
      if (finalists.length < state.settings.laneCount) return showError(`${state.settings.laneCount}명의 최종 결승 진출자가 모두 확정되어야 합니다.`);
      captureOperatorUndoSnapshotV266("최종 결승 진행");
      state.finalRace = {
        id: `final-${Math.random().toString(36).slice(2, 8)}`,
        name: "최종 결승",
        groupSize: state.settings.laneCount,
        group: { id: `final-group-${Math.random().toString(36).slice(2, 8)}`, name: "FINAL", slots: assignLanes(finalists, state.settings.laneCount), advanceIds: [] }
      };
      state.broadcast = { mode: "final" };
      logTournamentAction("최종 결승 생성", "FINAL");
      renderOperator();
      syncOperatorLiveStateV269("createFinalRace");
      scheduleSettledLiveSyncV272("createFinalRace");
    }

    function getFinalGroups(finalRace = state.finalRace) {
      if (!finalRace) return [];
      if (Array.isArray(finalRace.groups)) return finalRace.groups;
      return finalRace.group ? [finalRace.group] : [];
    }

    function toggleFinalWinner(playerId, groupId = "") {
      if (!state.finalRace) return;
      const groups = getFinalGroups();
      const group = groupId ? groups.find(item => item.id === groupId) : groups.find(item => item.slots.some(player => player.id === playerId));
      if (!group) return;
      const player = group.slots.find(item => item.id === playerId);
      if (!player || player.isEmptyLane) return;
      const ids = group.advanceIds || [];
      captureOperatorUndoSnapshotV266("결승 선택");
      group.advanceIds = ids.includes(playerId) ? ids.filter(id => id !== playerId) : [...ids, playerId];
      logTournamentAction("최종 진출/우승 선택", player.name || playerId);
      renderOperator();
      syncOperatorLiveStateV269("toggleFinalWinner");
      scheduleSettledLiveSyncV272("toggleFinalWinner");
    }

    function forceFinalLane(groupId, playerId, lane) {
      if (!state.finalRace) return;
      const group = getFinalGroups().find(item => item.id === groupId);
      if (!group) return;
      const target = group.slots.find(item => item.id === playerId);
      const other = group.slots.find(item => Number(item.lane) === Number(lane));
      if (!target || target.isEmptyLane) return;
      const oldLane = target.lane;
      captureOperatorUndoSnapshotV266("결승 레인 변경");
      target.lane = Number(lane);
      if (other && other.id !== target.id) other.lane = oldLane;
      group.slots.sort((a, b) => Number(a.lane) - Number(b.lane));
      logTournamentAction("결승 레인 강제 지정", `${target.name}: ${lane}LANE`);
      renderOperator();
    }

    function renderFinalLaneTools(group, player) {
      const maxLane = state.finalRace?.groupSize || state.settings.laneCount || 3;
      return `<div class="final-lane-tools">${Array.from({ length: maxLane }, (_, i) => i + 1).map(lane => `<button class="${Number(player.lane) === lane ? "primary" : "ghost"}" onclick="forceFinalLane('${escapeAttr(group.id)}','${escapeAttr(player.id)}',${lane})">${lane}</button>`).join("")}</div>`;
    }

    function renderFinalGroup(group, finalRaceType) {
      return `<article class="group"><div class="group-title"><strong>${escapeHtml(group.name || "FINAL")}</strong><span class="badge">${group.slots.filter(p => !p.isEmptyLane).length}명</span></div>${(group.slots || []).map(player => {
        if (player.isEmptyLane) {
          return `
            <div class="slot empty-lane">
              <div class="slot-inner slot-inner-name-first">
                ${renderPlayerCardMain(player, group)}
              </div>
            </div>
          `;
        }
        const selected = (group.advanceIds || []).includes(player.id);
        return `
          <div class="slot ${selected ? "selected" : ""}">
            <div class="slot-inner final-slot-actions">
              ${renderPlayerCardMain(player, group)}
              <div class="final-card-actions">
                <button class="${selected ? "primary" : "ghost"}" onclick="toggleFinalWinner('${escapeAttr(player.id)}','${escapeAttr(group.id)}')">${selected ? "선택 해제" : finalRaceType === "crowSemi" ? "결승 진출" : "우승 선택"}</button>
                ${renderFinalLaneTools(group, player)}
              </div>
            </div>
          </div>
        `;
      }).join("")}</article>`;
    }

    function renderFinalRace() {
      if (!state.finalRace) {
        return "";
      }
      const groups = getFinalGroups();
      const winners = getFinalWinners();
      const isBroadcast = state.broadcast.mode === "final";
      const isCrowSemi = state.finalRace.type === "crowSemi";
      const finishAction = !isCrowSemi && state.tournament.status === "running" && isTournamentFinalResultReady()
        ? `<div class="final-complete-actions-v142"><div class="final-complete-copy-v142"><strong>최종 결승 종료</strong><span>결과를 저장하고 새 대회 준비 상태로 전환합니다.</span></div><button class="primary" onclick="finishTournament()">대회 종료</button></div>`
        : "";
      return `<section class="final-box"><div class="round-head" style="margin-bottom:12px;"><h2>${escapeHtml(state.finalRace.name || "최종 결승")} ${isBroadcast ? `<span class="round-badge live-badge">● TV 송출중</span>` : ""}</h2><div>${isCrowSemi ? `<button class="primary" onclick="createCrowFinalFromSemi()">결승 생성</button>` : ""}</div></div><div class="groups" style="grid-template-columns:${groups.length > 1 ? "repeat(3,minmax(0,1fr))" : "1fr"};">${groups.map(group => renderFinalGroup(group, state.finalRace.type)).join("")}</div>${winners.length ? `<div class="champion"><small>${isCrowSemi ? "9강 SEMI RESULT" : "FINAL RESULT"}</small><strong>${winners.map(p => escapeHtml(p.name)).join(", ")}</strong><span>${isCrowSemi ? "결승 진출자" : winners.length > 1 ? "공동 최종 선정" : "최종 우승자"}</span></div>` : ""}${finishAction}</section>`;
    }

    function getBroadcastTarget(payload) {
      const broadcast = payload.broadcast || { mode: "stage", roundIndex: 0, stageIndex: 0 };
      const tournamentName = payload.tournament?.name || "";
      if (broadcast.mode === "final" && payload.finalRace) {
        const groups = Array.isArray(payload.finalRace.groups) ? payload.finalRace.groups : [payload.finalRace.group].filter(Boolean);
        return { title: payload.finalRace.name || "최종 결승", tournamentName, laneCount: payload.finalRace.groupSize || payload.settings.laneCount, groups, isFinal: true, stageType: "final", stageName: payload.finalRace.name || "최종 결승", pointTotalsMap: {} };
      }
      const round = payload.qualifierRounds?.[broadcast.roundIndex];
      const stage = round?.stages?.[broadcast.stageIndex] || round?.stages?.[round.stages.length - 1];
      if (!round || !stage) return null;
      const pointTotals = stage.type === "points" ? computePointTotalsUpToStage(round, broadcast.stageIndex) : [];
      const pointTotalsMap = Object.fromEntries(pointTotals.map(player => [player.id, player.total]));
      const pointLimit = getPointStageLimit(payload.settings?.matchMode || state.settings.matchMode);
      const isFinalPointHeat = stage.type === "points" && stage.name === `포인트 ${pointLimit}차전`;
      return { title: `${round.title} · ${stage.name}`, tournamentName, laneCount: payload.settings.laneCount, groups: stage.groups, round, stage, stageType: stage.type || "stage", stageName: stage.name, pointLeaders: isFinalPointHeat ? getPointLeadersWithTies(pointTotals, 3) : [], pointTotalsMap };
    }

    function getCurrentStageForPrint(payload = state) {
      const broadcast = payload.broadcast || { mode: "stage", roundIndex: 0, stageIndex: 0 };
      if (broadcast.mode === "final" && payload.finalRace) {
        const groups = Array.isArray(payload.finalRace.groups) ? payload.finalRace.groups : [payload.finalRace.group].filter(Boolean);
        return { title: `${payload.finalRace.name || "최종 결승"} · FINAL`, groups, isFinal: true };
      }
      const round = payload.qualifierRounds?.[broadcast.roundIndex];
      const stage = round?.stages?.[broadcast.stageIndex] || round?.stages?.[round.stages.length - 1];
      if (!round || !stage) return null;
      return { title: `${round.title} · ${stage.name}`, groups: stage.groups, stage };
    }

    function makePublicStatePayload(sourceState = exportState()) {
      resetMetricCacheV122();
      let seq = 0;
      const idMap = new Map();
      const broadcast = sourceState.broadcast || { mode: "stage", roundIndex: 0, stageIndex: 0 };
      const publicId = original => {
        const key = String(original || `empty-${seq + 1}`);
        if (!idMap.has(key)) idMap.set(key, `pub-${++seq}`);
        return idMap.get(key);
      };
      const cleanPlayer = player => {
        if (!player) return player;
        if (player.isEmptyLane) return { id: `empty-${player.lane || ++seq}`, lane: player.lane, name: "빈 레인", team: "", isEmptyLane: true };
        const displayName = player.nickname || player.name || player.realName || "참가자";
        return { id: publicId(player.id || displayName), lane: player.lane || null, name: displayName, nickname: displayName, team: player.team || "", todayLaneWinRate: getTodayLaneWinRate(player.lane), crowRank: player.crowRank || null, sourceRoundIndex: player.sourceRoundIndex || null };
      };
      const cleanGroup = (group, includeMetrics = false) => {
        const originalSlots = group?.slots || [];
        const slots = originalSlots.map(player => {
          const cleaned = cleanPlayer(player);
          if (includeMetrics && player && !player.isEmptyLane) {
            const h2h = getRecentHeadToHeadStats(player, group).map(item => ({
              name: item.name || "상대",
              matches: Number(item.matches || 0),
              wins: Number(item.wins || 0),
              losses: Number(item.losses || 0),
              rate: item.rate == null ? null : Number(item.rate)
            }));
            cleaned.groupOpponentCount = originalSlots.filter(slot => slot && !slot.isEmptyLane && slot.id !== player.id).length;
            cleaned.h2hMetrics = h2h;
          }
          return cleaned;
        });
        const advanceIds = (group?.advanceIds || []).map(id => idMap.get(String(id)) || publicId(id));
        const points = {};
        Object.entries(group?.points || {}).forEach(([id, value]) => { points[idMap.get(String(id)) || publicId(id)] = value; });
        return { ...(group || {}), slots, advanceIds, points };
      };
      const cleanStage = (stage, roundIndex, stageIndex) => {
        const includeMetrics = broadcast.mode === "stage" && Number(broadcast.roundIndex) === roundIndex && Number(broadcast.stageIndex) === stageIndex;
        return { ...stage, groups: (stage.groups || []).map(group => cleanGroup(group, includeMetrics)) };
      };
      const cleanRound = (round, roundIndex) => {
        const cleanFinalists = (round.crowFinalists || []).map(cleanPlayer);
        return { id: round.id, index: round.index, title: round.title, stagePlan: round.stagePlan || [], stages: (round.stages || []).map((stage, stageIndex) => cleanStage(stage, roundIndex, stageIndex)), finalist: round.finalist ? cleanPlayer(round.finalist) : null, crowFinalists: cleanFinalists };
      };
      const publicTournament = { name: sourceState.tournament?.name || "", venue: sourceState.tournament?.venue || "", venueId: sourceState.tournament?.venueId || "", raceClass: normalizeRaceClassName(sourceState.tournament?.raceClass || "오픈"), status: sourceState.tournament?.status || "draft", startedAtISO: sourceState.tournament?.startedAtISO || "", startedAtDisplay: sourceState.tournament?.startedAtDisplay || "", endedAtISO: sourceState.tournament?.endedAtISO || "", endedAtDisplay: sourceState.tournament?.endedAtDisplay || "" };
      const cleanFinalRace = sourceState.finalRace ? { ...sourceState.finalRace } : null;
      if (cleanFinalRace) {
        const includeFinalMetrics = broadcast.mode === "final";
        if (Array.isArray(sourceState.finalRace.groups)) cleanFinalRace.groups = sourceState.finalRace.groups.map(group => cleanGroup(group, includeFinalMetrics));
        if (sourceState.finalRace.group) cleanFinalRace.group = cleanGroup(sourceState.finalRace.group, includeFinalMetrics);
      }
      return { settings: sourceState.settings ? { laneCount: sourceState.settings.laneCount, matchMode: sourceState.settings.matchMode } : {}, tournament: publicTournament, activeRoundIndex: sourceState.activeRoundIndex || 0, broadcast: sourceState.broadcast || { mode: "stage", roundIndex: 0, stageIndex: 0 }, qualifierRounds: (sourceState.qualifierRounds || []).map(cleanRound), finalRace: cleanFinalRace, updatedAt: sourceState.updatedAt || Date.now() };
    }

    function sameResultPlayerIdV187(a, b) {
      return String(a || "") === String(b || "");
    }

    function getPointTieBreakStageResultV188(group, player) {
      const rankIndex = (group.advanceIds || []).findIndex(id => sameResultPlayerIdV187(id, player.id));
      return rankIndex >= 0 ? `순위결정 ${rankIndex + 1}위` : "순위대기";
    }

    function isRoundFinalResultStageV187(round, stage, stageIndex) {
      const stages = round?.stages || [];
      if (!stage || stageIndex !== stages.length - 1) return false;
      const name = String(stage.name || "");
      return isPointFinalDecisionStage(stage) || name === "라운드 결승" || name === "결승";
    }

    function getQualifierStageResultV187(round, stage, stageIndex, group, player) {
      if (player.isEmptyLane) return "빈 레인";
      if (stage.type === "points") return "포인트";
      if (stage.type === "pointTieBreak") return getPointTieBreakStageResultV188(group, player);
      const isAdvanced = (group.advanceIds || []).some(id => sameResultPlayerIdV187(id, player.id));
      const isFinalResultStage = isRoundFinalResultStageV187(round, stage, stageIndex);
      const crowRank = isFinalResultStage && isAdvanced
        ? (round.crowFinalists || []).find(item => sameResultPlayerIdV187(item.id, player.id))?.crowRank || ""
        : "";
      if (crowRank) return `9강 ${crowRank}위`;
      const isFinalist = isFinalResultStage && isAdvanced && round.finalist && sameResultPlayerIdV187(round.finalist.id, player.id);
      if (isFinalist && isRevivalMode()) return "최종우승";
      if (isFinalist) return "최종결승진출";
      return isAdvanced ? "진출" : "탈락";
    }

    function getStageResultRows() {
      const meta = getTournamentMeta();
      const rows = [];
      state.qualifierRounds.forEach(round => (round.stages || []).forEach((stage, stageIndex) => stage.groups.forEach(group => group.slots.forEach(player => {
        const score = stage.type === "points" && !player.isEmptyLane ? Number((group.points || {})[player.id] ?? 0) : "";
        const ident = resolvePlayerIdentity(player);
        const result = getQualifierStageResultV187(round, stage, stageIndex, group, player);
        rows.push({ ...meta, 경기장ID: currentVenueId(), 선수ID: ident.playerId, 실명: ident.realName, 연락처: ident.contact, 차수: round.title, 단계: stage.name, 조: group.name, 레인: `${player.lane}LANE`, 선수명: player.name, 팀명: player.team || "", 점수: score, 결과: result, 비고: stage.type || "" });
      }))));
      if (state.finalRace) getFinalGroups().forEach(group => group.slots.forEach(player => {
        const selected = (group.advanceIds || []).includes(player.id);
        const ident = resolvePlayerIdentity(player);
        const finalType = state.finalRace.type === "crowSemi" ? "9강준결" : "FINAL";
        rows.push({ ...meta, 경기장ID: currentVenueId(), 선수ID: ident.playerId, 실명: ident.realName, 연락처: ident.contact, 차수: state.finalRace.name || "최종 결승", 단계: finalType, 조: group.name, 레인: `${player.lane}LANE`, 선수명: player.name, 팀명: player.team || "", 점수: "", 결과: player.isEmptyLane ? "빈 레인" : selected ? (state.finalRace.type === "crowSemi" ? "결승진출" : "최종우승") : "결승참가", 비고: state.finalRace.type || "final" });
      }));
      return rows;
    }

/* boot deferred to v49 final call */



    /* v49 live lobby realtime + final stabilization overrides */
    let __liveLobbyRefsV49 = [];
    let __watchRefsV49 = [];
    let __publicLiveWatchToken = 0;
    let __publicLiveWatchFallbackTimer = null;
    let __publicLiveWatchPollTimerV268 = null;
    const PUBLIC_LIVE_WATCH_POLL_MS_V268 = 2500;

    function stopLiveLobbyRealtimeV49() {
      (__liveLobbyRefsV49 || []).forEach(item => {
        try { item.ref.off("value", item.cb); } catch (error) {}
      });
      __liveLobbyRefsV49 = [];
    }

    function stopPublicLiveWatchV49() {
      __publicLiveWatchToken += 1;
      if (__publicLiveWatchFallbackTimer) {
        clearTimeout(__publicLiveWatchFallbackTimer);
        __publicLiveWatchFallbackTimer = null;
      }
      if (__publicLiveWatchPollTimerV268) {
        clearInterval(__publicLiveWatchPollTimerV268);
        __publicLiveWatchPollTimerV268 = null;
      }
      (__watchRefsV49 || []).forEach(item => {
        try { item.ref.off("value", item.cb); } catch (error) {}
      });
      __watchRefsV49 = [];
    }

    function mergeVenueArraysV49(...arrays) {
      const map = new Map();
      arrays.flat().forEach(item => {
        if (!item) return;
        const name = String(item.venueName || item.name || item.displayName || item.venueId || "").trim();
        const id = String(item.venueId || item.id || normalizeKey(name) || "").trim();
        if (!name && !id) return;
        if (id === "all" || name === "전체") return;
        const key = normalizeKey(name || id);
        const current = map.get(key) || { venueId: id || key, venueName: name || id, updatedAt: item.updatedAt || "" };
        current.venueId = current.venueId || id || key;
        current.venueName = name || current.venueName || id;
        current.updatedAt = item.updatedAt || current.updatedAt || "";
        map.set(key, current);
      });
      return Array.from(map.values()).sort((a,b)=>String(a.venueName).localeCompare(String(b.venueName), "ko"));
    }

    function buildLobbySlots(venues = [], tournaments = [], records = []) {
      const venueMap = new Map();
      const venueKey = item => normalizeKey(item?.venueName || item?.venueId || "");

      // 상용화 기준: LIVE 로비는 승인된 경기장 계정/publicVenueDirectory 기준만 노출한다.
      // 관리자 계정 또는 기록에서 파생된 임시 경기장은 로비 카드로 만들지 않는다.
      mergeVenueArraysV49(venues || []).forEach(venue => {
        const venueName = String(venue?.venueName || "").trim();
        if (!venueName) return;
        const key = venueKey(venue);
        if (!key || key === "all" || venueName === "전체" || venue?.role === "admin") return;
        venueMap.set(key, {
          venueId: venue.venueId || key,
          venueName,
          approved: true,
          source: venue.source || "public-directory"
        });
      });

      const liveByVenue = new Map();
      tournaments.forEach(item => {
        const key = venueKey(item);
        if (!key || !venueMap.has(key)) return;
        const current = liveByVenue.get(key);
        if (!current || toTimeValue(item.updatedAt) > toTimeValue(current.updatedAt)) liveByVenue.set(key, item);
      });

      const latestRecordByVenue = new Map();
      records.forEach(record => {
        const key = venueKey(record);
        if (!key || !venueMap.has(key)) return;
        const current = latestRecordByVenue.get(key);
        if (!current || normalizeRecentTime(record) > normalizeRecentTime(current)) latestRecordByVenue.set(key, record);
      });

      const cards = Array.from(venueMap.entries()).map(([key, venue]) => {
        const liveItem = liveByVenue.get(key);
        const recentRecord = latestRecordByVenue.get(key);
        const status = liveItem ? effectiveLiveStatus(liveItem) : "waiting";
        const recentAt = recentRecord ? normalizeRecentTime(recentRecord) : 0;
        const updatedAt = liveItem ? toTimeValue(liveItem.updatedAt) : 0;
        const activityAt = Math.max(updatedAt || 0, recentAt || 0);
        return {
          id: liveItem?.id || "",
          venueId: venue.venueId,
          venueName: venue.venueName,
          tournamentName: liveItem?.tournamentName || "대기중",
          raceClass: normalizeRaceClassName(liveItem?.raceClass || recentRecord?.raceClass || ""),
          status,
          updatedAt,
          recentAt,
          activityAt,
          recentRecord,
          recentResult: recentRecord ? getRecordWinnerText(recentRecord) : "",
          recentTournamentName: recentRecord?.tournamentName || "",
          approved: venue.approved
        };
      });

      // 요청 기준: 최근 경기를 치른 순서. LIVE 여부보다 최근 활동/최근 결과 시간을 우선한다.
      cards.sort((a, b) => {
        return Number(b.activityAt || 0) - Number(a.activityAt || 0)
          || String(a.venueName).localeCompare(String(b.venueName), "ko");
      });

      const slots = cards.slice(0, LIVE_LOBBY_SLOT_COUNT);
      while (slots.length < LIVE_LOBBY_SLOT_COUNT) {
        slots.push({
          empty: true,
          venueId: `empty-${slots.length + 1}`,
          venueName: `빈 슬롯 ${slots.length + 1}`,
          tournamentName: "경기장 계정 승인 시 자동 표시",
          raceClass: "",
          status: "empty",
          updatedAt: 0,
          recentAt: 0,
          activityAt: 0
        });
      }
      return slots;
    }    
    function openLiveViewerV88(view, id) {
      const safeView = view === "tv-live" ? "tv-live" : "mobile-live";
      const safeId = encodeURIComponent(id || "");
      const url = `${location.origin}${location.pathname}#view=${safeView}&t=${safeId}`;
      openDetachedWindowV87(url, `mini4wd_${safeView}`);
    }

    function openLiveViewerV89(view, id) {
      return openLiveViewerV88(view, id);
    }

    function findLatestPublicLiveEntryV267(raw = {}) {
      return Object.entries(raw || {})
        .map(([id, item]) => ({
          id,
          item,
          status: item?.state?.tournament?.status || item?.status || "",
          live: item?.live !== false,
          updatedAt: Number(item?.updatedAt || item?.state?.updatedAt || 0)
        }))
        .filter(entry => entry.id && entry.live && entry.status === "running")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    }

    function connectLatestPublicLiveV267(viewType = "mobile-live") {
      const db = initFirebase();
      if (!db) {
        if (viewType === "mobile-live") renderLiveLobbyPage();
        return true;
      }
      const safeView = viewType === "tv-live" ? "tv-live" : "mobile-live";
      if (safeView === "tv-live") {
        setUiSurfaceV149("tv-live");
        document.body.classList.add("tv-mode");
        app.innerHTML = `<div class="tv-wrap"><div class="tv-empty"><div class="tv-brand-line"><small>MINI4WD TOURNAMENT MAKER</small></div><strong>라이브 연결중</strong></div></div>`;
      }
      db.ref(PUBLIC_LIVE_PATH).orderByChild("updatedAt").limitToLast(PUBLIC_LIVE_RECENT_LIMIT).get()
        .then(snapshot => {
          const params = getHashParams();
          const currentView = params.get("view") || "";
          const currentId = params.get("t") || params.get("tournamentId") || "";
          const stillMissingId = !currentId && (currentView === safeView || (safeView === "mobile-live" && currentView === "live"));
          if (!stillMissingId) return;
          const latest = findLatestPublicLiveEntryV267(snapshot.val() || {});
          if (latest?.id) {
            location.hash = `view=${safeView}&t=${encodeURIComponent(latest.id)}`;
            return;
          }
          if (safeView === "mobile-live") {
            renderLiveLobbyPage();
            return;
          }
          app.innerHTML = `<div class="tv-wrap"><div class="empty"><div><h2>LIVE 대기중</h2><p>현재 송출 중인 경기를 찾지 못했습니다.</p></div></div><div class="tv-foot"><span>MINI4WD TOURNAMENT MAKER</span><span>${escapeHtml(mini4wdBuildLabel())}</span></div></div>`;
        })
        .catch(error => {
          console.warn("latest live lookup failed", error);
          if (safeView === "mobile-live") renderLiveLobbyPage();
        });
      return true;
    }

function renderLiveLobbyWithData(tournaments = [], records = [], venues = []) {
      setUiSurfaceV149("live-lobby");
      document.body.classList.remove("tv-mode");
      document.body.classList.remove("operator-light-page-v95");
      document.body.classList.remove("live-lobby-page-v88");
      document.body.classList.add("live-lobby-page-v89");

      const nowText = new Date().toLocaleString("ko-KR");
      const safeTournaments = Array.isArray(tournaments) ? tournaments : [];
      const safeRecords = Array.isArray(records) ? records : [];
      const safeVenues = Array.isArray(venues) ? venues : [];
      const slotCount = Number(LIVE_LOBBY_SLOT_COUNT || 20);
      const cards = buildLobbySlots(safeVenues, safeTournaments, safeRecords).slice(0, slotCount);
      while (cards.length < slotCount) {
        cards.push({ empty: true, status: "empty", id: "", venueName: `대기 슬롯 ${cards.length + 1}` });
      }

      const liveCount = cards.filter(item => item && item.status === "running" && !item.empty).length;
      const emptyCount = cards.filter(item => item && (item.empty || item.status === "empty")).length;
      const waitingCount = Math.max(0, cards.length - liveCount - emptyCount);
      const recent = [...safeRecords].sort((a, b) => getResultRecordDateMs(b) - getResultRecordDateMs(a)).slice(0, 10);

      const row = value => value ? `<span>${escapeHtml(value)}</span>` : "";
      const formatTime = value => value ? new Date(value).toLocaleString("ko-KR") : "";
      const cardHtml = (item = {}, index = 0) => {
        const empty = !!item.empty || item.status === "empty";
        const live = !empty && item.status === "running" && !!item.id;
        const recentState = !empty && !live && (item.status === "recent" || item.status === "stale");
        const waiting = !empty && !live && !recentState;
        const statusClass = live ? "on" : recentState ? "recent" : empty ? "empty" : "waiting";
        const statusText = live ? "송출" : recentState ? "최근" : empty ? "비어 있음" : "대기";
        const slotNo = String(index + 1).padStart(2, "0");
        const venueName = empty ? `대기 슬롯 ${index + 1}` : (item.venueName || item.venueId || "경기장 미지정");
        const title = empty ? "표시할 경기 없음" : (item.tournamentName || "대회명 미입력");
        const raceText = item.raceClass ? normalizeRaceClassName(item.raceClass) : "클래스 미지정";
        const updated = formatTime(item.updatedAt);
        const liveId = item.id || "";
        const meta = empty
          ? ["경기 시작 시 표시", "대기 중"]
          : live
            ? [raceText, updated || "송출 시간 확인 중"]
            : [raceText, updated ? `최근 갱신 ${updated}` : "진행 중인 송출 없음"];
        const recentTime = formatTime(item.recentAt || item.updatedAt);
        const resultTitle = item.recentRecord ? (item.recentResult || "결과 기록 없음") : empty ? "빈 슬롯" : "최근 결과 없음";
        const resultSub = item.recentRecord
          ? `${item.recentTournamentName || "최근 경기"}${recentTime ? ` · ${recentTime}` : ""}`
          : empty ? "경기가 시작되면 표시됩니다." : "경기 종료 후 표시됩니다.";
        const actions = live
          ? `<div class="live-lobby-actions-v89"><button class="primary" onclick="openLiveViewerV89('tv-live','${escapeAttr(liveId)}')">TV 보기</button><button onclick="openLiveViewerV89('mobile-live','${escapeAttr(liveId)}')">모바일 보기</button></div>`
          : `<div class="live-lobby-placeholder-v89"><span>${empty ? "비어 있음" : "대기 중"}</span></div>`;
        return `<article class="live-card-v89 ${live ? "is-live" : ""} ${recentState ? "is-recent" : ""} ${waiting ? "is-waiting" : ""} ${empty ? "is-empty" : ""}">
          <div class="live-card-status-v89"><span class="live-status-v89 ${statusClass}">${escapeHtml(statusText)}</span><b>${escapeHtml(slotNo)}</b></div>
          <div class="live-card-main-v89"><p class="live-venue-v89">${escapeHtml(venueName)}</p><h3>${escapeHtml(title)}</h3><div class="live-meta-v89">${meta.map(row).join("")}</div></div>
          <div class="live-result-v89 ${item.recentRecord ? "" : "is-muted"}"><span>최근 결과</span><b>${escapeHtml(resultTitle)}</b><small>${escapeHtml(resultSub)}</small></div>
          ${actions}
        </article>`;
      };

      const historyHtml = recent.map(record => `<div class="history-row-v89"><div><b>${escapeHtml(record.venueName || record.venueId || "경기장")}</b><span>${escapeHtml(normalizeRaceClassName(record.raceClass))}</span></div><div><b>${escapeHtml(record.tournamentName || "대회명 미입력")}</b><span>${escapeHtml(record.endedAtISO ? new Date(record.endedAtISO).toLocaleString("ko-KR") : record.createdAt ? new Date(record.createdAt).toLocaleString("ko-KR") : "")}</span></div><div><b>${escapeHtml(getRecordWinnerText(record))}</b><span>우승/상위 결과</span></div></div>`).join("");

      app.innerHTML = `<div class="live-lobby-shell-v89 live-lobby-shell-v212 app-shell-v212">
        ${renderUnifiedPageHeaderV173({
          className: "live-lobby-header-v89",
          kicker: "라이브",
          title: "라이브",
          description: "진행 중인 대회와 최근 결과를 한 화면에서 확인합니다.",
          stats: [
            { label: "송출", value: liveCount },
            { label: "대기", value: waitingCount },
            { label: "비어 있음", value: emptyCount }
          ],
          actions: [{ label: "새로고침", onClick: "renderLiveLobbyPage()" }]
        })}
        <section class="live-summary-v89 live-summary-compact-v173 ui-panel-v212 live-summary-panel-v212"><small>${escapeHtml(nowText)} 기준 · ${cards.length}개 슬롯</small></section>
        <main class="live-grid-v89 ui-workspace-v212 live-lobby-grid-v212">${cards.map(cardHtml).join("")}</main>
        <section class="live-history-v89 ui-panel-v212 live-history-panel-v212"><h2>최근 경기 히스토리</h2><div class="history-list-v89">${historyHtml || `<div class="live-empty-note-v89">최근 경기 기록이 없습니다.</div>`}</div></section>
        <footer class="live-footer-v89">${escapeHtml(mini4wdBuildLabel())}</footer>
      </div>`;
    }

/* v50 final fixes: public live publishing, realtime lobby, dashboard admin scope */
    function forcePublishPublicLiveV50(reason = "수동 LIVE 동기화") {
      try {
        ensureStateDefaults();
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        persistCurrentState();
        const db = initFirebase();
        if (!db) return false;
        const privateState = exportState();
        privateState.updatedAt = Date.now();
        const publicLive = makePublicLivePayload(privateState);
        publicLive.syncReason = reason;
        writeFreshLiveValueV272(db, `${PUBLIC_LIVE_PATH}/${getCurrentTournamentId()}`, publicLive, reason).catch(error => console.warn(`public live sync failed: ${reason}`, error));
        db.ref(`tournaments/${getCurrentTournamentId()}/updatedAt`).set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
        return true;
      } catch (error) {
        console.warn("forcePublishPublicLiveV50 failed", error);
        return false;
      }
    }

    
    function openDetachedWindowV87(url, name = "mini4wd_live_lobby") {
      try {
        const win = window.open(url, "_blank", "noopener");
        if (win) {
          try { win.opener = null; } catch (_) {}
          return true;
        }
      } catch (error) {
        console.warn("open window failed", error);
      }
      navigator.clipboard?.writeText(url)
        .then(() => alert("팝업이 차단되어 링크를 복사했습니다. 새 탭에 붙여넣어 열어주세요."))
        .catch(() => prompt("새창으로 열 링크", url));
      return false;
    }

function stopLiveLobbyRealtimeV50() {
      if (typeof stopLiveLobbyRealtimeV49 === "function") stopLiveLobbyRealtimeV49();
      if (typeof stopPublicLiveWatchV49 === "function") stopPublicLiveWatchV49();
    }

    function renderLiveLobbyPage() {
      setUiSurfaceV149("live-lobby");
      document.body.classList.remove("tv-mode");
      document.body.classList.remove("live-lobby-page-v88");
      document.body.classList.add("live-lobby-page-v89");
      stopLiveLobbyRealtimeV50();
      app.innerHTML = `<div class="live-lobby-shell-v89 live-lobby-shell-v212 app-shell-v212"><div class="live-loading-v89 ui-panel-v212"><h2>라이브 연결 중</h2><p>경기장 송출 상태를 불러오는 중입니다.</p></div></div>`;
      const db = initFirebase();
      if (!db) {
        renderLiveLobbyWithData([], loadLocalResultLogs().map(makePublicRecord), []);
        return;
      }
      const cache = { live: {}, history: {}, venues: {}, directory: {} };
      let drawTimer = null;
      const draw = () => {
        clearTimeout(drawTimer);
        drawTimer = setTimeout(() => {
          const tournaments = normalizeLobbyTournaments(cache.live || {});
          const records = cache.history && Object.keys(cache.history).length ? Object.values(cache.history) : loadLocalResultLogs().map(makePublicRecord);
          const venues = mergeVenueArraysV49(normalizePublicVenues(cache.venues || {}), normalizePublicVenues(cache.directory || {}));
          renderLiveLobbyWithData(tournaments, records, venues);
        }, 80);
      };
      const bind = (key, path, queryFactory) => {
        const baseRef = db.ref(path);
        const ref = typeof queryFactory === "function" ? queryFactory(baseRef) : baseRef;
        const cb = snapshot => { cache[key] = snapshot.val() || {}; draw(); };
        ref.on("value", cb, error => { console.warn(`live lobby watch failed: ${path}`, error); cache[key] = {}; draw(); });
        if (typeof __liveLobbyRefsV49 !== "undefined") __liveLobbyRefsV49.push({ ref, cb });
      };
      bind("live", PUBLIC_LIVE_PATH, ref => ref.orderByChild("updatedAt").limitToLast(PUBLIC_LIVE_RECENT_LIMIT));
      bind("history", PUBLIC_HISTORY_PATH, ref => ref.orderByChild("createdAt").limitToLast(PUBLIC_HISTORY_RECENT_LIMIT));
      bind("venues", PUBLIC_VENUES_PATH);
      if (typeof PUBLIC_VENUE_DIRECTORY_PATH !== "undefined") bind("directory", PUBLIC_VENUE_DIRECTORY_PATH);
    }

    function watchFirebaseState(viewType) {
      stopLiveLobbyRealtimeV50();
      const db = initFirebase();
      if (!db) {
        if (viewType === "mobile-live") renderLiveLobbyPage();
        return;
      }
      const params = getHashParams();
      const requestedId = params.get("t") || params.get("tournamentId") || "";
      if ((viewType === "mobile-live" || viewType === "tv-live") && !requestedId) {
        connectLatestPublicLiveV267(viewType);
        return;
      }
      const tournamentId = normalizeKey(requestedId) || getCurrentTournamentId();
      const watchToken = ++__publicLiveWatchToken;
      const currentPublicLiveWatchMatchesRoute = () => {
        if (watchToken !== __publicLiveWatchToken) return false;
        const current = getHashParams();
        const currentView = current.get("view") || "";
        const currentId = normalizeKey(current.get("t") || current.get("tournamentId") || "");
        const viewMatches = viewType === "mobile-live"
          ? (currentView === "mobile-live" || currentView === "live")
          : currentView === "tv-live";
        return viewMatches && currentId === tournamentId;
      };
      let received = false;
      let lastAppliedUpdatedAt = 0;
      __publicLiveWatchFallbackTimer = setTimeout(() => {
        if (received || !currentPublicLiveWatchMatchesRoute()) return;
        if (viewType === "tv-live") {
          setUiSurfaceV149("tv-live");
          document.body.classList.add("tv-mode");
          app.innerHTML = `<div class="tv-wrap"><div class="empty"><div><h2>LIVE 대기중</h2><p>해당 경기의 송출 데이터가 아직 없습니다.</p><p>${escapeHtml(tournamentId)}</p></div></div><div class="tv-foot"><span>MINI4WD TOURNAMENT MAKER</span><span>${escapeHtml(mini4wdBuildLabel())}</span></div></div>`;
        } else {
          renderLiveLobbyPage();
        }
      }, 4200);

      const normalizeLivePayload = raw => {
        if (!raw) return null;
        if (raw.state && raw.state.qualifierRounds) return raw.state;
        if (raw.qualifierRounds) return raw;
        return null;
      };
      const applyLivePayload = raw => {
        if (!currentPublicLiveWatchMatchesRoute()) return;
        const payload = normalizeLivePayload(raw);
        if (!payload) return;
        const updated = Number(payload.updatedAt || raw?.updatedAt || 0) || Date.now();
        if (lastAppliedUpdatedAt && updated < lastAppliedUpdatedAt) return;
        lastAppliedUpdatedAt = updated;
        received = true;
        if (__publicLiveWatchFallbackTimer) {
          clearTimeout(__publicLiveWatchFallbackTimer);
          __publicLiveWatchFallbackTimer = null;
        }
        if (viewType === "tv-live") {
          tvState = payload;
          document.body.classList.add("tv-mode");
          renderTvStage();
          return;
        }
        if (viewType === "mobile-live") {
          renderTvSnapshot(payload, "mobile");
        }
      };

      const refs = [
        db.ref(`${PUBLIC_LIVE_PATH}/${tournamentId}/state`),
        db.ref(`${PUBLIC_LIVE_PATH}/${tournamentId}`)
      ];
      const pollLivePayloadV268 = () => {
        if (!currentPublicLiveWatchMatchesRoute()) return;
        const updatedRef = db.ref(`${PUBLIC_LIVE_PATH}/${tournamentId}/updatedAt`);
        const liveRef = db.ref(`${PUBLIC_LIVE_PATH}/${tournamentId}`);
        updatedRef.get()
          .then(snapshot => {
            if (!currentPublicLiveWatchMatchesRoute()) return null;
            const remoteUpdatedAt = Number(snapshot.val() || 0);
            if (lastAppliedUpdatedAt && remoteUpdatedAt && remoteUpdatedAt <= lastAppliedUpdatedAt) return null;
            return liveRef.get();
          })
          .then(snapshot => {
            if (snapshot && currentPublicLiveWatchMatchesRoute()) applyLivePayload(snapshot.val());
          })
          .catch(error => {
            console.warn("live watch poll failed", error);
          });
      };
      refs.forEach(ref => {
        const cb = snapshot => applyLivePayload(snapshot.val());
        ref.on("value", cb, error => {
          console.warn("live watch failed", error);
        });
        if (typeof __watchRefsV49 !== "undefined") __watchRefsV49.push({ ref, cb });
      });
      __publicLiveWatchPollTimerV268 = setInterval(pollLivePayloadV268, PUBLIC_LIVE_WATCH_POLL_MS_V268);
      setTimeout(pollLivePayloadV268, 700);
    }


    function renderDashboardPage() {
      setUiSurfaceV149("dashboard");
      try {
        if (!currentAuthUser) return renderLoginPage("대시보드는 로그인 후 이용할 수 있습니다.");
        if (!canViewDashboard()) return renderRestrictedPage("대시보드 권한 없음", "관리자가 대시보드 권한을 부여해야 합니다.");
        if (isAdminUser()) dashboardFilter.venue = "전체";
        document.body.classList.remove("tv-mode");
        app.innerHTML = `<div class="wrap app-shell-v212 dashboard-shell-v212"><div class="empty ui-panel-v212"><div><h2>대시보드 불러오는 중</h2><p>전체 경기장 데이터를 확인합니다.</p></div></div></div>`;
        const db = initFirebase();
        const local = loadLocalResultLogs();
        if (!db) {
          window.__dashboardProfiles = {};
          window.__dashboardLegacyUsers = {};
          window.__dashboardPublicVenues = {};
          window.__dashboardVenueDirectory = {};
          window.__dashboardRecords = local;
          renderDashboardWithRecords(local);
          return;
        }
        const profilePromise = isAdminUser()
          ? db.ref(USER_PROFILE_PATH).get().then(s => s.val() || {}).catch(error => { console.warn("dashboard profiles read failed", error); return {}; })
          : Promise.resolve(currentUserProfile ? { [currentUserProfile.uid || currentAuthUser.uid]: currentUserProfile } : {});
        const legacyUserPromise = isAdminUser()
          ? db.ref("users").get().then(s => s.val() || {}).catch(error => { console.warn("dashboard legacy users read failed", error); return {}; })
          : Promise.resolve({});
        const publicVenuePromise = db.ref(PUBLIC_VENUES_PATH).get().then(s => s.val() || {}).catch(error => { console.warn("dashboard publicVenues read failed", error); return {}; });
        const venueDirectoryPromise = db.ref(PUBLIC_VENUE_DIRECTORY_PATH).get().then(s => s.val() || {}).catch(error => { console.warn("dashboard publicVenueDirectory read failed", error); return {}; });
        const privateLogsPromise = (isAdminUser() ? db.ref(RESULT_LOGS_PATH) : db.ref(`${RESULT_LOGS_PATH}/${currentVenueId()}`)).get()
          .then(s => isAdminUser() ? flattenPrivateResultLogs(s.val() || {}) : Object.values(s.val() || {}))
          .catch(error => { console.warn("dashboard private logs read failed", error); return []; });
        const publicHistoryPromise = db.ref(PUBLIC_HISTORY_PATH).orderByChild("createdAt").limitToLast(DASHBOARD_PUBLIC_HISTORY_LIMIT).get().then(s => s.val() ? Object.values(s.val()) : [])
          .catch(error => { console.warn("dashboard public history read failed", error); return []; });
        Promise.all([privateLogsPromise, publicHistoryPromise, profilePromise, publicVenuePromise, venueDirectoryPromise, legacyUserPromise])
          .then(([privateLogs, publicHistory, profiles, publicVenues, venueDirectory, legacyUsers]) => {
            const merged = [...privateLogs, ...publicHistory, ...local].filter((item, idx, arr) => item && arr.findIndex(x => x && x.id === item.id) === idx);
            window.__dashboardProfiles = profiles || {};
            window.__dashboardLegacyUsers = legacyUsers || {};
            window.__dashboardPublicVenues = publicVenues || {};
            window.__dashboardVenueDirectory = venueDirectory || {};
            window.__dashboardRecords = merged;
            renderDashboardWithRecords(merged);
          })
          .catch(error => {
            console.warn("dashboard render failed", error);
            renderDashboardErrorV55(error.message || String(error));
          });
      } catch (error) {
        console.warn("renderDashboardPage exception", error);
        renderDashboardErrorV55(error.message || String(error));
      }
    }

    /* v55 stability fix: button audit, live sync, dashboard guard */
    function enableLiveAutoSyncV55(reason = "LIVE 동기화") {
      try {
        ensureStateDefaults();
        if (state.tournament.status !== "running") {
          persistCurrentState();
          return false;
        }
        state.settings.firebaseAutoSave = true;
        activateAutoLiveSession(false);
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        persistCurrentState();
        queueFirebaseSave();
        return true;
      } catch (error) {
        console.warn("enableLiveAutoSync failed", error);
        window.__mini4wdFirebaseLastError = error?.message || String(error);
        return false;
      }
    }

    function syncLiveForViewerOpenV267(reason = "live-viewer-open-v267") {
      ensureStateDefaults();
      if (state.tournament.status !== "running") return "";
      state.settings.firebaseAutoSave = true;
      const id = getCurrentTournamentId();
      state.updatedAt = Date.now();
      state.activeRoundIndex = activeRoundIndex;
      persistCurrentState();
      try {
        const result = syncOperatorLiveStateV269(reason);
        Promise.resolve(result).then(ok => {
          if (!ok && typeof forcePublishPublicLiveV50 === "function") forcePublishPublicLiveV50(`${reason}-fallback`);
        }).catch(error => {
          console.warn("live viewer sync failed", error);
          if (typeof forcePublishPublicLiveV50 === "function") forcePublishPublicLiveV50(`${reason}-fallback`);
        });
      } catch (error) {
        console.warn("live viewer sync failed", error);
        if (typeof forcePublishPublicLiveV50 === "function") forcePublishPublicLiveV50(`${reason}-fallback`);
      }
      return id;
    }

    function openLiveLobbyPage() {
      ensureStateDefaults();
      const liveId = syncLiveForViewerOpenV267("live-button-open-v267");
      if (!liveId && state.tournament.status === "running") enableLiveAutoSyncV55("라이브 새창");
      const route = liveId ? `#view=mobile-live&t=${encodeURIComponent(liveId)}` : "#view=live-lobby";
      const url = `${location.origin}${location.pathname}${route}`;
      return openDetachedWindowV87(url, "mini4wd_live_lobby");
    }

    function renderDashboardErrorV55(message = "대시보드 데이터를 불러오지 못했습니다.") {
      setUiSurfaceV149("dashboard");
      document.body.classList.remove("tv-mode");
      app.innerHTML = `<div class="wrap app-shell-v212 dashboard-shell-v212"><section class="card auth-card ui-panel-v212"><h2>기록 오류</h2><p class="hint">${escapeHtml(message)}</p><div class="section-toolbar"><button class="ghost" onclick="goBack()">뒤로가기</button><button class="ghost" onclick="goHome()">홈</button><button class="primary" onclick="renderDashboardPage()">다시 불러오기</button></div><p class="privacy-note">로그인 권한과 기록 읽기 설정을 확인하세요.</p></section></div>`;
    }





    /* v58 stable mobile mode selection */
    function getModeRowAnchorV57() {
      return document.querySelector('.btnrow.mode-row.three') || document.querySelector('.btnrow.mode-row') || null;
    }

    function restoreModeRowPositionV57(anchorTopBefore, fallbackY) {
      requestAnimationFrame(() => {
        const row = getModeRowAnchorV57();
        if (!row) {
          window.scrollTo({ top: fallbackY || 0, behavior: 'auto' });
          return;
        }
        const topAfter = row.getBoundingClientRect().top;
        const diff = topAfter - anchorTopBefore;
        if (Number.isFinite(diff) && Math.abs(diff) > 1) {
          window.scrollBy({ top: diff, left: 0, behavior: 'auto' });
        }
      });
    }

    function setMatchMode(mode) {
      ensureStateDefaults();
      const row = getModeRowAnchorV57();
      const anchorTopBefore = row ? row.getBoundingClientRect().top : 0;
      const fallbackY = window.scrollY || 0;
      const sameMode = normalizeMatchMode(state.settings.matchMode) === normalizeMatchMode(mode);
      if (sameMode) {
        restoreModeRowPositionV57(anchorTopBefore, fallbackY);
        return;
      }
      if (isTournamentLocked() && !confirm('대회가 시작/종료된 상태입니다. 경기 방식을 바꾸면 기록이 꼬일 수 있습니다. 계속할까요?')) return;
      if (state.qualifierRounds.some(round => round.stages.length) || state.finalRace) {
        if (!confirm('경기 방식을 바꾸면 현재 대진표가 라운드 초기화됩니다. 계속할까요?')) return;
      }
      const currentTournament = { ...state.tournament };
      const inputText = state.inputText;
      const previousSettings = { ...state.settings, matchMode: mode };
      if (mode === 'crow') previousSettings.laneCount = 3;
      state = makeInitialState(previousSettings.laneCount || 3);
      state.inputText = inputText;
      state.tournament = currentTournament;
      state.settings = { ...state.settings, ...previousSettings, matchMode: mode };
      state.qualifierRounds = makeQualifierRounds(state.settings.laneCount, mode);
      state.finalRace = null;
      activeRoundIndex = 0;
      renderOperator();
      restoreModeRowPositionV57(anchorTopBefore, fallbackY);
    }

    /* v135 active tournament backup loader + 60-minute auto close */
    (function installV135ActiveBackupAndAutoClose(){
      if (window.__mini4wdActiveBackupRuntimeInstalled) return;
      window.__mini4wdActiveBackupRuntimeInstalled = true;
      const AUTO_CLOSE_MS_V135 = 60 * 60 * 1000;
      let activeListV135 = [];
      let activeListLoadingV135 = false;
      let activeListErrorV135 = "";
      let autoCloseBusyV135 = false;

      function nowV135(){ return Date.now(); }
      function elapsedTextV135(ms){
        const minutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
        if (minutes < 60) return `${minutes}분 전`;
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest ? `${hours}시간 ${rest}분 전` : `${hours}시간 전`;
      }
      function currentVenueKeyV135(){
        try { return normalizeKey(currentVenueId() || currentVenueName() || ""); }
        catch (error) { return ""; }
      }
      function stateVenueKeysV135(sourceState){
        const t = sourceState?.tournament || {};
        return [t.venueId, t.venue, t.venueName].filter(Boolean).map(v => normalizeKey(v));
      }
      function isSameVenueV135(sourceState){
        const currentKey = currentVenueKeyV135();
        if (!currentKey) return false;
        return stateVenueKeysV135(sourceState).includes(currentKey);
      }
      function tournamentLastAtV135(record){
        const stateValue = record?.state || record || {};
        const candidates = [stateValue.updatedAt, record?.updatedAt, stateValue.tournament?.updatedAt, stateValue.tournament?.startedAtISO];
        for (const item of candidates) {
          if (!item) continue;
          const numberValue = Number(item);
          if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
          const parsed = Date.parse(item);
          if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
      }
      function activeRoundLabelV135(sourceState){
        try {
          const rounds = sourceState.qualifierRounds || [];
          const idx = Math.max(0, Math.min(Number(sourceState.activeRoundIndex || 0), Math.max(0, rounds.length - 1)));
          const round = rounds[idx];
          if (!round) return "라운드 미생성";
          const currentStage = (round.stages || [])[Math.max(0, (round.stages || []).length - 1)];
          return currentStage ? `${round.title || "라운드"} · ${currentStage.name || "진행중"}` : `${round.title || "라운드"} · 대기`;
        } catch (error) { return "-"; }
      }
      function activeTournamentEntryV135(id, raw){
        const sourceState = raw?.state || raw || {};
        const status = sourceState?.tournament?.status || raw?.status || "draft";
        const lastAt = tournamentLastAtV135(raw);
        const participants = (() => {
          try { return String(sourceState.inputText || "").split(/\n+/).map(v => v.trim()).filter(Boolean).length; }
          catch (error) { return 0; }
        })();
        return { id, state: sourceState, status, lastAt, participants };
      }
      function activeTournamentLabelV135(entry){
        const t = entry.state?.tournament || {};
        const name = t.name || entry.state?.tournamentName || "대회명 미입력";
        const klass = t.raceClass || "오픈";
        const venue = t.venue || t.venueName || "경기장";
        return `${venue} · ${name} · ${klass}`;
      }
      function activeTournamentMetaV135(entry){
        const passed = entry.lastAt ? nowV135() - entry.lastAt : 0;
        const stale = entry.lastAt && passed >= AUTO_CLOSE_MS_V135;
        return `${entry.participants || 0}명 · ${activeRoundLabelV135(entry.state)} · 마지막 변경 ${entry.lastAt ? elapsedTextV135(passed) : "-"}${stale ? " · 자동종료 대상" : ""}`;
      }
      async function fetchActiveTournamentEntriesV135({ closeStale = false } = {}){
        const db = initFirebase();
        if (!db || !currentAuthUser) throw new Error("로그인 상태가 필요합니다.");
        const snap = await db.ref("tournaments").get();
        const raw = snap.val() || {};
        const entries = Object.entries(raw).map(([id, value]) => activeTournamentEntryV135(id, value))
          .filter(entry => entry.status === "running")
          .filter(entry => isSameVenueV135(entry.state) || isAdminUser())
          .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
        if (closeStale) {
          for (const entry of entries) {
            if (entry.lastAt && nowV135() - entry.lastAt >= AUTO_CLOSE_MS_V135) {
              await closeRemoteTournamentV135(entry.id, entry.state, "60분 무변화 자동 종료");
            }
          }
          if (entries.some(entry => entry.lastAt && nowV135() - entry.lastAt >= AUTO_CLOSE_MS_V135)) {
            const snap2 = await db.ref("tournaments").get();
            const raw2 = snap2.val() || {};
            return Object.entries(raw2).map(([id, value]) => activeTournamentEntryV135(id, value))
              .filter(entry => entry.status === "running")
              .filter(entry => isSameVenueV135(entry.state) || isAdminUser())
              .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
          }
        }
        return entries;
      }
      async function closeRemoteTournamentV135(id, sourceState, reason){
        const db = initFirebase();
        if (!db || !id || !sourceState) return false;
        const nextState = normalizeImportedState(sourceState);
        const endedISO = new Date().toISOString();
        nextState.tournament = {
          ...(nextState.tournament || {}),
          status: "finished",
          endedAtISO: nextState.tournament?.endedAtISO || endedISO,
          endedAtDisplay: nextState.tournament?.endedAtDisplay || formatDisplayDateTime(new Date()),
          liveStopped: true,
          autoClosed: true,
          autoCloseReason: reason,
          autoClosedAt: endedISO
        };
        nextState.updatedAt = nowV135();
        const publicLive = {
          id,
          liveSignature: nextState.tournament?.liveSignature || id,
          venueId: nextState.tournament?.venueId || "",
          venueName: nextState.tournament?.venue || nextState.tournament?.venueName || "",
          tournamentName: nextState.tournament?.name || "대회명 미입력",
          raceClass: nextState.tournament?.raceClass || "오픈",
          status: "finished",
          live: false,
          liveKeyLabel: `${nextState.tournament?.venue || ""} · ${nextState.tournament?.name || "대회명 미입력"}`,
          updatedAt: nextState.updatedAt,
          state: nextState,
          autoCloseReason: reason
        };
        const updates = {};
        updates[`tournaments/${id}/state`] = nextState;
        updates[`tournaments/${id}/updatedAt`] = firebase.database.ServerValue.TIMESTAMP;
        updates[`${PUBLIC_LIVE_PATH}/${id}`] = publicLive;
        const activeVenueId = nextState.tournament?.venueId || nextState.tournament?.venue || "";
        await db.ref().update(updates);
        if (activeVenueId && typeof cleanupActiveTournamentForVenueV151 === "function") {
          cleanupActiveTournamentForVenueV151(activeVenueId).catch(error => console.warn("v151 remote active cleanup skipped", error));
        }
        return true;
      }
      async function closeCurrentTournamentV135(reason = "60분 무변화 자동 종료"){
        if (autoCloseBusyV135 || !state?.tournament || state.tournament.status !== "running") return false;
        autoCloseBusyV135 = true;
        try {
          const id = getCurrentTournamentId();
          const endedISO = new Date().toISOString();
          if (typeof createAutoSnapshot === "function") createAutoSnapshot("자동 종료 전 백업");
          state.tournament.status = "finished";
          state.tournament.endedAtISO = state.tournament.endedAtISO || endedISO;
          state.tournament.endedAtDisplay = state.tournament.endedAtDisplay || formatDisplayDateTime(new Date());
          state.tournament.liveStopped = true;
          state.tournament.autoClosed = true;
          state.tournament.autoCloseReason = reason;
          state.tournament.autoClosedAt = endedISO;
          state.updatedAt = nowV135();
          persistCurrentState();
          if (typeof logTournamentAction === "function") logTournamentAction("자동 종료", reason);
          await forceLiveBroadcastSync("auto-close-60m-v135");
          try { releaseActiveTournamentForVenue("finished-clear"); } catch (error) {}
          if (!document.body.classList.contains("tv-mode") && typeof renderOperator === "function") renderOperator();
          return true;
        } catch (error) {
          console.warn("v135 current tournament auto-close failed", error);
          return false;
        } finally {
          autoCloseBusyV135 = false;
        }
      }
      function checkCurrentTournamentAutoCloseV135(){
        try {
          if (!state?.tournament || state.tournament.status !== "running") return false;
          const lastAt = Number(state.updatedAt || 0);
          if (!lastAt || nowV135() - lastAt < AUTO_CLOSE_MS_V135) return false;
          closeCurrentTournamentV135("60분 이상 상태 변화 없음");
          return true;
        } catch (error) {
          console.warn("v135 auto-close check failed", error);
          return false;
        }
      }
      async function ensureNoOtherRunningTournamentV135(){
        try {
          if (!state?.tournament || state.tournament.status === "running") return true;
          const currentId = getCurrentTournamentId();
          const entries = await fetchActiveTournamentEntriesV135({ closeStale: true });
          const other = entries.find(entry => entry.id !== currentId);
          if (!other) return true;
          activeListV135 = entries;
          activeListErrorV135 = "";
          alert(`이미 진행중인 대회가 있습니다.\n${activeTournamentLabelV135(other)}\n\n먼저 진행중 대회를 불러오거나 종료한 뒤 새 대회를 시작하세요.`);
          if (typeof renderOperator === "function") renderOperator();
          return false;
        } catch (error) {
          console.warn("v135 active tournament guard failed", error);
          return true;
        }
      }

      function setActiveListBusyV153(isBusy, errorMessage = ""){
        activeListLoadingV135 = Boolean(isBusy);
        activeListErrorV135 = errorMessage || "";
        if (typeof renderOperator === "function") renderOperator();
      }

      async function refreshActiveListV153(){
        activeListV135 = await fetchActiveTournamentEntriesV135({ closeStale: true });
        return activeListV135;
      }

      function permissionDeniedActiveListMessageV153(){
        return "현재 계정 권한으로는 활성 목록을 직접 정리할 수 없습니다. 대회 시작/종료 처리는 계속 진행됩니다.";
      }

      function alertActiveCleanupResultV153(result){
        if (result?.removed) {
          alert("현재 경기장의 오래된 활성 대회 표시를 정리했습니다.");
        } else if (result?.reason === "permission-denied") {
          alert(permissionDeniedActiveListMessageV153());
        } else {
          alert("현재 경기장에 정리할 오래된 활성 대회 표시가 없습니다.");
        }
      }

      window.requestActiveTournamentListV135 = async function requestActiveTournamentListV135(){
        try {
          setActiveListBusyV153(true);
          if (typeof cleanupActiveTournamentForVenueV151 === "function") {
            await cleanupActiveTournamentForVenueV151().catch(error => console.warn("v151 active registry cleanup skipped", error));
          }
          await refreshActiveListV153();
        } catch (error) {
          activeListErrorV135 = error?.message || String(error);
          activeListV135 = [];
        } finally {
          setActiveListBusyV153(false, activeListErrorV135);
        }
      };
      window.cleanupActiveTournamentRegistryV151 = async function cleanupActiveTournamentRegistryV151(){
        try {
          setActiveListBusyV153(true);
          const result = typeof cleanupActiveTournamentForVenueV151 === "function"
            ? await cleanupActiveTournamentForVenueV151()
            : { removed: false, reason: "unsupported" };
          await refreshActiveListV153();
          alertActiveCleanupResultV153(result);
        } catch (error) {
          activeListErrorV135 = error?.message || String(error);
          if (isFirebasePermissionDeniedV151(error)) {
            alert(permissionDeniedActiveListMessageV153());
          } else {
            alert("활성 대회 자동정리 실패: " + activeListErrorV135);
          }
        } finally {
          setActiveListBusyV153(false, activeListErrorV135);
        }
      };
      window.loadActiveTournamentV135 = async function loadActiveTournamentV135(id){
        try {
          const db = initFirebase();
          if (!db || !id) return alert("불러올 대회를 찾지 못했습니다.");
          const snap = await db.ref(`tournaments/${id}/state`).get();
          const payload = snap.val();
          if (!payload) return alert("진행중 대회 상태를 읽지 못했습니다.");
          if (!confirm("선택한 진행중 대회를 현재 운영 화면으로 불러올까요?")) return;
          state = normalizeImportedState(payload);
          state.tournament.liveId = id;
          state.tournament.liveSignature = state.tournament.liveSignature || buildAutoTournamentId();
          activeRoundIndex = Math.max(0, Math.min(Number(state.activeRoundIndex || 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
          state.activeRoundIndex = activeRoundIndex;
          firebaseTournamentId = id;
          safeSetItem("mini4wdTournamentId", id);
          safeSetItem("mini4wdActiveLiveId", id);
          safeSetItem("mini4wdActiveLiveSignature", state.tournament.liveSignature || id);
          persistCurrentState();
          if (typeof createAutoSnapshot === "function") createAutoSnapshot("진행중 대회 불러오기");
          if (typeof logTournamentAction === "function") logTournamentAction("진행중 대회 불러오기", id);
          if (typeof renderOperator === "function") renderOperator();
        } catch (error) {
          alert("진행중 대회 불러오기 실패: " + (error?.message || String(error)));
        }
      };
      window.closeCurrentTournamentV135 = closeCurrentTournamentV135;
      window.checkCurrentTournamentAutoCloseV135 = checkCurrentTournamentAutoCloseV135;

      const originalStartAllFirstStagesV135 = typeof startAllFirstStages === "function" ? startAllFirstStages : null;
      if (originalStartAllFirstStagesV135 && !originalStartAllFirstStagesV135.__v135Wrapped) {
        const wrappedStartAllFirstStagesV135 = async function startAllFirstStagesV135(){
          const ok = await ensureNoOtherRunningTournamentV135();
          if (!ok) return false;
          return originalStartAllFirstStagesV135.apply(this, arguments);
        };
        wrappedStartAllFirstStagesV135.__v135Wrapped = true;
        try { startAllFirstStages = wrappedStartAllFirstStagesV135; window.startAllFirstStages = wrappedStartAllFirstStagesV135; } catch (error) {}
      }

      const originalRenderOperationPanelV135 = typeof renderOperationPanel === "function" ? renderOperationPanel : null;
      if (originalRenderOperationPanelV135 && !originalRenderOperationPanelV135.__v135Wrapped) {
        function renderOpsActionGroupsV152(lock){
          const lockButton = lock.on
            ? `<button class="ghost" onclick="releaseOperationLock(false)">운영권 해제</button>`
            : `<button class="primary" onclick="acquireOperationLock()">운영권 잡기</button>`;
          return `
            <div class="ops-action-groups-v152">
              <div class="ops-action-group-v152">
                <span class="ops-action-title-v152">운영권</span>
                ${lockButton}
              </div>
              <div class="ops-action-group-v152">
                <span class="ops-action-title-v152">저장</span>
                <button class="ghost" onclick="createManualSnapshot()">현재 저장</button>
              </div>
              <div class="ops-action-group-v152">
                <span class="ops-action-title-v152">진행 대회</span>
                <button class="ghost" onclick="requestActiveTournamentListV135()">불러올 대회 확인</button>
                <button class="ghost" onclick="cleanupActiveTournamentRegistryV151()">목록 정리</button>
              </div>
              <div class="ops-action-group-v152 ops-danger-v152">
                <span class="ops-action-title-v152">종료</span>
                <button class="danger" onclick="forceEndTournament()">강제 종료</button>
              </div>
            </div>`;
        }

        function renderActiveBackupListV152(activeList){
          if (activeListLoadingV135) return `<div class="hint">불러올 대회를 확인하는 중입니다.</div>`;
          if (activeListErrorV135) return `<div class="hint">불러오기 실패: ${escapeHtml(activeListErrorV135)}</div>`;
          if (!activeList.length) return "";
          return `<div class="active-backup-list-v135">${activeList.map(entry => `<div class="active-backup-item-v135"><div class="active-backup-main-v135"><strong>${escapeHtml(activeTournamentLabelV135(entry))}</strong><span>${escapeHtml(activeTournamentMetaV135(entry))}</span></div><button class="ghost" onclick="loadActiveTournamentV135('${escapeAttr(entry.id)}')">불러오기</button></div>`).join("")}</div>`;
        }

        function renderSnapshotListV152(snapshots){
          if (!snapshots.length) return "";
          return `<div class="snapshot-list">${snapshots.map(s => `<div class="snapshot-item"><span>${escapeHtml(s.label)} · ${escapeHtml(formatSnapshotTime(s.createdAt))}</span><button class="ghost" onclick="restoreSnapshot('${escapeAttr(s.id)}')">복구</button></div>`).join("")}</div>`;
        }

        const renderOperationPanelWrappedV135 = function renderOperationPanelWrappedV135(){
          const lock = typeof operationLockText === "function" ? operationLockText() : { on:false, text:"운영권 상태를 확인할 수 없습니다." };
          const snapshots = typeof loadSnapshots === "function" ? loadSnapshots().slice(0, 1) : [];
          const activeList = activeListV135 || [];
          const listHtml = renderActiveBackupListV152(activeList);
          const snapshotHtml = renderSnapshotListV152(snapshots);
          const actionGroups = renderOpsActionGroupsV152(lock);
          return `<section class="ops-panel active-backup-panel-v135"><div class="ops-row"><div><strong>저장과 복구</strong><br><span class="${lock.on ? 'lock-on' : 'lock-off'}">${escapeHtml(lock.text)}</span><p class="auto-close-note-v135">진행 대회가 남아 있으면 여기서 확인하고 정리합니다.</p></div>${actionGroups}</div>${listHtml}${snapshotHtml}</section>`;
        };
        renderOperationPanelWrappedV135.__v135Wrapped = true;
        try { renderOperationPanel = renderOperationPanelWrappedV135; window.renderOperationPanel = renderOperationPanelWrappedV135; } catch (error) {}
      }

      const originalRenderOperatorV135 = typeof renderOperator === "function" ? renderOperator : null;
      if (originalRenderOperatorV135 && !originalRenderOperatorV135.__v135Wrapped) {
        const renderOperatorWrappedV135 = function renderOperatorWrappedV135(){
          checkCurrentTournamentAutoCloseV135();
          return originalRenderOperatorV135.apply(this, arguments);
        };
        renderOperatorWrappedV135.__v135Wrapped = true;
        try { renderOperator = renderOperatorWrappedV135; window.renderOperator = renderOperatorWrappedV135; } catch (error) {}
      }

      if (!window.__mini4wdActiveAutoCloseTimer) {
        window.__mini4wdActiveAutoCloseTimer = setInterval(checkCurrentTournamentAutoCloseV135, 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") setTimeout(checkCurrentTournamentAutoCloseV135, 250);
        });
      }
    })();

    bootV33();

    /* Race-day save batching runtime: mobile lag + live sync batching */
    (function(){
      let v104LocalTimer = null;
      let v104FirebaseTimer = null;
      let v104LastSnapshotAt = 0;
      let v104LastFirebaseAt = 0;
      let v104SyncInFlight = false;
      let v104PendingForce = false;
      let v104PendingQueued = false;
      const V104_LOCAL_DELAY = 120;
      const V104_FIREBASE_DELAY = 220;
      const V104_FIREBASE_MIN_INTERVAL = 320;
      const V104_PENDING_RETRY_DELAY = 70;
      const V104_SNAPSHOT_INTERVAL = 45000;

      function v104ExportNow(){
        ensureStateDefaults();
        state.updatedAt = Date.now();
        state.activeRoundIndex = activeRoundIndex;
        if (state.tournament && state.tournament.status === "running") {
          state.settings.firebaseAutoSave = true;
          activateAutoLiveSession();
        }
        return exportState();
      }

      function v104WriteLocal(reason="auto"){
        try {
          const payload = v104ExportNow();
          safeSetItem(STORAGE_KEY, JSON.stringify(payload));
          safeSetItem("mini4wdTournamentLastSafeStateV95", JSON.stringify(payload));
          safeSetItem("mini4wdTournamentLastSafeStateV95Reason", `v104-${reason}`);
          safeSetItem("mini4wdTournamentLastSafeStateV95At", new Date().toISOString());
          return payload;
        } catch (error) {
          console.warn("v104 local backup failed", error);
          return exportState();
        }
      }

      function v104MaybeSnapshot(reason="자동 저장"){
        const now = Date.now();
        if (now - v104LastSnapshotAt < V104_SNAPSHOT_INTERVAL) return;
        v104LastSnapshotAt = now;
        try { createAutoSnapshot(reason); } catch (error) { console.warn("v104 snapshot skipped", error); }
      }

      function v104ScheduleLocal(reason="queued"){
        clearTimeout(v104LocalTimer);
        v104LocalTimer = setTimeout(() => {
          v104WriteLocal(reason);
          v104MaybeSnapshot("자동 저장");
        }, V104_LOCAL_DELAY);
      }

      async function v104FirebaseSync(reason="manual", immediate=false){
        if (firebaseApplyingRemote) return false;
        if (v104SyncInFlight) {
          if (immediate) v104PendingForce = true;
          else v104PendingQueued = true;
          return false;
        }
        const now = Date.now();
        if (!immediate) {
          const remaining = V104_FIREBASE_MIN_INTERVAL - (now - v104LastFirebaseAt);
          if (remaining > 0) {
            v104PendingQueued = true;
            clearTimeout(v104FirebaseTimer);
            v104FirebaseTimer = setTimeout(() => {
              v104PendingQueued = false;
              v104FirebaseSync("throttled-tail", false);
            }, Math.max(V104_PENDING_RETRY_DELAY, remaining));
            return false;
          }
        }
        v104SyncInFlight = true;
        v104LastFirebaseAt = now;
        try {
          const privateState = v104WriteLocal(reason);
          const db = initFirebase();
          if (!db) return false;
          const id = getCurrentTournamentId();
          const publicLive = makePublicLivePayload(privateState);
          const serverTs = firebase.database.ServerValue.TIMESTAMP;
          const publicMeta = {
            id: publicLive.id,
            liveSignature: publicLive.liveSignature,
            venueId: publicLive.venueId,
            venueName: publicLive.venueName,
            tournamentName: publicLive.tournamentName,
            raceClass: publicLive.raceClass,
            status: publicLive.status,
            live: publicLive.live,
            liveKeyLabel: publicLive.liveKeyLabel,
            updatedAt: publicLive.updatedAt,
            syncReason: reason,
            state: publicLive.state
          };
          await Promise.all([
            writeFreshLiveValueV272(db, `tournaments/${id}/state`, privateState, reason),
            db.ref(`tournaments/${id}/updatedAt`).set(serverTs),
            writeFreshLiveValueV272(db, `${PUBLIC_LIVE_PATH}/${id}`, publicMeta, reason)
          ]);
          firebaseOnline = true;
          window.__mini4wdFirebaseLastSavedAt = Date.now();
          window.__mini4wdFirebaseLastError = "";
          return true;
        } catch (error) {
          firebaseOnline = false;
          window.__mini4wdFirebaseLastError = error?.message || String(error || "저장 실패");
          console.warn("v170 live sync failed", error);
          return false;
        } finally {
          v104SyncInFlight = false;
          if (v104PendingForce || v104PendingQueued) {
            const forceTrailingSync = v104PendingForce;
            v104PendingForce = false;
            v104PendingQueued = false;
            clearTimeout(v104FirebaseTimer);
            v104FirebaseTimer = setTimeout(
              () => v104FirebaseSync(forceTrailingSync ? "pending-force" : "pending-queued", forceTrailingSync),
              forceTrailingSync ? V104_PENDING_RETRY_DELAY : V104_FIREBASE_DELAY
            );
          }
        }
      }

      function v104QueueFirebaseSave(){
        if (firebaseApplyingRemote) return;
        if (!state.tournament || !["running","finished","archived"].includes(state.tournament.status)) {
          v104ScheduleLocal("not-running");
          return;
        }
        clearTimeout(v104FirebaseTimer);
        v104FirebaseTimer = setTimeout(() => v104FirebaseSync("queued", false), V104_FIREBASE_DELAY);
      }

      function v104SaveLiveState(){
        v104ScheduleLocal("saveLiveState");
        if (state.tournament && state.tournament.status === "running") v104QueueFirebaseSave();
      }

      function v104ForceLiveBroadcastSync(reason="manual"){
        clearTimeout(v104FirebaseTimer);
        return v104FirebaseSync(reason, true);
      }

      function v104RefreshPointButtons(roundIndex, stageIndex, groupId, playerId, score){
        try {
          const needle = `setPointScore(${roundIndex}, ${stageIndex}, '${groupId}', '${playerId}'`;
          document.querySelectorAll('button[onclick]').forEach(btn => {
            const attr = btn.getAttribute('onclick') || '';
            if (!attr.includes(needle)) return;
            const isActive = attr.includes(`, ${Number(score)})`) || attr.includes(`,${Number(score)})`);
            btn.classList.toggle('primary', isActive);
            btn.classList.toggle('ghost', !isActive);
          });
        } catch (error) { /* no-op */ }
      }

      function v104SetPointScore(roundIndex, stageIndex, groupId, playerId, score){
        if (!canModifyTournamentAction("점수 변경")) return;
        const stage = state.qualifierRounds[roundIndex]?.stages?.[stageIndex];
        if (!stage || stage.type !== "points") return;
        const group = stage.groups.find(item => item.id === groupId);
        if (!group) return;
        const player = group.slots.find(item => item.id === playerId);
        if (!player || player.isEmptyLane) return;
        captureOperatorUndoSnapshotV266("점수 선택");
        group.points = group.points || {};
        group.points[playerId] = Number(score);
        state.broadcast = { mode: "stage", roundIndex, stageIndex };
        activeRoundIndex = roundIndex;
        try { logTournamentAction("점수 변경", `${player.name || player.id}: ${score}P`); } catch (_) {}
        v104RefreshPointButtons(roundIndex, stageIndex, groupId, playerId, score);
        refreshOperatorUndoFloatV266();
        v104SaveLiveState();
      }

      function v104FlushBeforeExit(reason="exit"){
        try {
          clearTimeout(v104LocalTimer);
          clearTimeout(v104FirebaseTimer);
          v104WriteLocal(reason);
        } catch (error) { console.warn("v104 flush failed", error); }
      }

      try { void (window.saveLiveState = v104SaveLiveState); } catch (_) {}
      try { void (window.queueFirebaseSave = v104QueueFirebaseSave); } catch (_) {}
      try { void (window.forceLiveBroadcastSync = v104ForceLiveBroadcastSync); } catch (_) {}
      try { void (window.setPointScore = v104SetPointScore); } catch (_) {}
      window.saveLiveState = v104SaveLiveState;
      window.queueFirebaseSave = v104QueueFirebaseSave;
      window.forceLiveBroadcastSync = v104ForceLiveBroadcastSync;
      window.setPointScore = v104SetPointScore;
      window.addEventListener("pagehide", () => v104FlushBeforeExit("pagehide"));
      window.addEventListener("beforeunload", () => v104FlushBeforeExit("beforeunload"));
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") v104FlushBeforeExit("visibility-hidden"); });
    })();

    /* v178: operator session lease + refresh recovery guard */
    (function installV178OperatorSessionLease(){
      if (window.__mini4wdOperatorSessionLeaseRuntimeInstalled) return;
      window.__mini4wdOperatorSessionLeaseRuntimeInstalled = true;

      let v178SessionId = "";
      let v178HeartbeatTimer = null;
      let v178LastSessionPath = "";
      let v178Lease = null;
      let v178LeaseLoaded = false;
      let v178LeaseClaimInFlight = null;
      let v178RecoveryCandidate = null;
      let v178RecoveryBusy = false;
      let v178RecoverySignature = "";
      let v178RecoveryTimer = null;
      let v178LastHeartbeatAt = 0;

      function readSessionStorageV178(key) {
        try { return sessionStorage.getItem(key) || ""; } catch (error) { return ""; }
      }

      function writeSessionStorageV178(key, value) {
        try { sessionStorage.setItem(key, value); return true; } catch (error) { return false; }
      }

      function operatorSessionIdV178() {
        if (v178SessionId) return v178SessionId;
        const stored = readSessionStorageV178(OPERATOR_SESSION_STORAGE_KEY_V178);
        if (stored) {
          v178SessionId = stored;
          return v178SessionId;
        }
        const random = Math.random().toString(36).slice(2, 10);
        v178SessionId = `op-${Date.now().toString(36)}-${random}`;
        writeSessionStorageV178(OPERATOR_SESSION_STORAGE_KEY_V178, v178SessionId);
        return v178SessionId;
      }

      function shortSessionIdV178(value = operatorSessionIdV178()) {
        return String(value || "").slice(-8) || "-";
      }

      function operatorVenueIdV178() {
        try { return normalizeKey(currentVenueId() || currentVenueName() || "default"); }
        catch (error) { return "default"; }
      }

      function operationLeasePathV178() {
        return `${OPERATION_LOCK_PATH}/leases/${operatorVenueIdV178()}`;
      }

      function operatorSessionPathV178() {
        const uid = currentAuthUser?.uid || "anonymous";
        return `${OPERATION_LOCK_PATH}/sessions/${operatorVenueIdV178()}/${uid}/${operatorSessionIdV178()}`;
      }

      function isOperatorRouteV178() {
        try {
          const view = getHashParams().get("view") || "";
          return !["db", "admin", "admin-matches", "dashboard", "print", "tv-live", "mobile-live", "live", "live-list", "live-lobby", "lobby"].includes(view);
        } catch (error) {
          return true;
        }
      }

      function shouldRunOperatorPresenceV178() {
        try {
          return Boolean(currentAuthUser && canOperate() && isOperatorRouteV178() && !document.body.classList.contains("tv-mode"));
        } catch (error) {
          return false;
        }
      }

      function leaseUntilV178(lease = v178Lease) {
        return Number(lease?.leaseUntil || 0);
      }

      function isLeaseExpiredV178(lease = v178Lease) {
        const until = leaseUntilV178(lease);
        return !lease || !until || Date.now() > until;
      }

      function isLeaseMineV178(lease = v178Lease) {
        if (!lease || isLeaseExpiredV178(lease)) return false;
        return lease.sessionId === operatorSessionIdV178() && (!lease.uid || lease.uid === currentAuthUser?.uid);
      }

      function isLeaseHeldByOtherV178(lease = v178Lease) {
        if (!lease || isLeaseExpiredV178(lease)) return false;
        return Boolean(lease.sessionId && lease.sessionId !== operatorSessionIdV178());
      }

      function operationOwnerLabelV178(lease = v178Lease) {
        if (!lease || isLeaseExpiredV178(lease)) return "없음";
        return lease.email || lease.uid || "다른 운영자";
      }

      function leaseRemainingTextV178(lease = v178Lease) {
        if (!lease || isLeaseExpiredV178(lease)) return "만료";
        const seconds = Math.max(0, Math.ceil((leaseUntilV178(lease) - Date.now()) / 1000));
        return `${seconds}초`;
      }

      function buildLeasePayloadV178(reason = "manual") {
        const now = Date.now();
        return {
          scope: "venue",
          venueId: operatorVenueIdV178(),
          venueName: currentVenueName(),
          uid: currentAuthUser?.uid || "",
          email: currentAuthUser?.email || currentActorLabel(),
          sessionId: operatorSessionIdV178(),
          tournamentId: getCurrentTournamentId(),
          tournamentName: state?.tournament?.name || "",
          status: state?.tournament?.status || "draft",
          reason,
          leaseUntil: now + OPERATION_LEASE_MS_V178,
          clientUpdatedAt: now,
          updatedAt: firebase.database.ServerValue.TIMESTAMP,
          build: mini4wdBuildLabel()
        };
      }

      function syncLeaseStateToDomV178() {
        try {
          document.documentElement.setAttribute("data-operator-session-id", shortSessionIdV178());
          document.documentElement.setAttribute("data-operator-lease", isLeaseMineV178() ? "mine" : isLeaseHeldByOtherV178() ? "other" : "open");
          document.body.classList.toggle("operator-readonly-v178", isLeaseHeldByOtherV178());
          updateSessionPanelDomV178();
        } catch (error) {}
      }

      function updateSessionPanelDomV178() {
        try {
          const panel = document.querySelector(".session-lease-panel-v178");
          if (!panel) return;
          const leaseState = isLeaseMineV178() ? "운영 가능" : isLeaseHeldByOtherV178() ? "다른 운영자 사용 중" : v178LeaseLoaded ? "운영 가능" : "확인 중";
          const leaseClass = isLeaseMineV178() ? "mine" : isLeaseHeldByOtherV178() ? "other" : "open";
          const heartbeatText = v178LastHeartbeatAt ? formatDateTimeLocal(new Date(v178LastHeartbeatAt)) : "-";
          const chip = panel.querySelector("[data-v178-lease-chip]");
          const heartbeat = panel.querySelector("[data-v178-heartbeat]");
          const lease = panel.querySelector("[data-v178-lease-remaining]");
          const owner = panel.querySelector("[data-v178-owner]");
          if (chip) {
            chip.textContent = leaseState;
            chip.className = `session-chip-v178 ${leaseClass}`;
          }
          if (heartbeat) heartbeat.textContent = heartbeatText;
          if (lease) lease.textContent = leaseRemainingTextV178();
          if (owner) owner.textContent = operationOwnerLabelV178();
        } catch (error) {}
      }

      async function refreshOperationLeaseV178() {
        const db = initFirebase();
        if (!db || !currentAuthUser) return null;
        try {
          const snap = await db.ref(operationLeasePathV178()).get();
          v178Lease = snap.val() || null;
          v178LeaseLoaded = true;
          syncLeaseStateToDomV178();
          return v178Lease;
        } catch (error) {
          console.warn("v178 lease refresh failed", error);
          return v178Lease;
        }
      }

      async function claimOperationLeaseV178(reason = "manual", force = false) {
        if (v178LeaseClaimInFlight) return v178LeaseClaimInFlight;
        const db = initFirebase();
        if (!db || !currentAuthUser || !canOperate()) return true;
        const ref = db.ref(operationLeasePathV178());
        v178LeaseClaimInFlight = ref.transaction(current => {
          if (current && current.sessionId && current.sessionId !== operatorSessionIdV178() && !isLeaseExpiredV178(current) && !force) return;
          return buildLeasePayloadV178(reason);
        }).then(result => {
          v178Lease = result.snapshot?.val() || null;
          v178LeaseLoaded = true;
          syncLeaseStateToDomV178();
          if (!result.committed) return false;
          window.__mini4wdLastLeaseClaim = { reason, force, at: new Date().toISOString(), sessionId: operatorSessionIdV178(), venueId: operatorVenueIdV178() };
          return true;
        }).catch(error => {
          console.warn("v178 lease claim failed", error);
          return false;
        }).finally(() => {
          v178LeaseClaimInFlight = null;
        });
        return v178LeaseClaimInFlight;
      }

      async function releaseOperationLeaseV178(force = false) {
        const db = initFirebase();
        if (!db || !currentAuthUser) return false;
        try {
          const ref = db.ref(operationLeasePathV178());
          const result = await ref.transaction(current => {
            if (!current) return null;
            if (force || current.sessionId === operatorSessionIdV178() || isAdminUser()) return null;
            return current;
          });
          v178Lease = result.snapshot?.val() || null;
          v178LeaseLoaded = true;
          syncLeaseStateToDomV178();
          return result.committed;
        } catch (error) {
          console.warn("v178 lease release failed", error);
          return false;
        }
      }

      async function writeOperatorHeartbeatV178(reason = "heartbeat") {
        if (!shouldRunOperatorPresenceV178()) return false;
        const db = initFirebase();
        if (!db || !currentAuthUser) return false;
        const now = Date.now();
        const path = operatorSessionPathV178();
        const payload = {
          sessionId: operatorSessionIdV178(),
          uid: currentAuthUser.uid,
          email: currentAuthUser.email || "",
          venueId: operatorVenueIdV178(),
          venueName: currentVenueName(),
          tournamentId: getCurrentTournamentId(),
          tournamentName: state?.tournament?.name || "",
          tournamentStatus: state?.tournament?.status || "draft",
          page: getHashParams().get("view") || "operator",
          online: true,
          reason,
          clientUpdatedAt: now,
          updatedAt: firebase.database.ServerValue.TIMESTAMP,
          build: mini4wdBuildLabel()
        };
        try {
          const ref = db.ref(path);
          if (v178LastSessionPath !== path) {
            v178LastSessionPath = path;
            try { ref.onDisconnect().remove(); } catch (error) {}
          }
          await ref.update(payload);
          v178LastHeartbeatAt = now;
          updateSessionPanelDomV178();
          if (isLeaseMineV178()) await claimOperationLeaseV178("heartbeat", false);
          else {
            await refreshOperationLeaseV178();
            if (state?.tournament?.status === "running" && !isLeaseHeldByOtherV178()) await claimOperationLeaseV178("auto-resume", false);
          }
          return true;
        } catch (error) {
          console.warn("v178 heartbeat failed", error);
          return false;
        }
      }

      function scheduleRecoveryCheckV178(reason = "render") {
        clearTimeout(v178RecoveryTimer);
        v178RecoveryTimer = setTimeout(() => refreshRecoveryCandidateV178(reason), 420);
      }

      function recoverySignatureV178(candidate) {
        if (!candidate) return "";
        return `${candidate.id}|${candidate.remoteUpdatedAt}|${candidate.reason}`;
      }

      function setRecoveryCandidateV178(candidate) {
        const nextSig = recoverySignatureV178(candidate);
        const changed = nextSig !== v178RecoverySignature;
        v178RecoveryCandidate = candidate;
        v178RecoverySignature = nextSig;
        if (changed && shouldRunOperatorPresenceV178()) {
          setTimeout(() => {
            try { if (typeof renderOperator === "function") renderOperator(); } catch (error) {}
          }, 0);
        }
      }

      async function refreshRecoveryCandidateV178(reason = "manual") {
        if (v178RecoveryBusy || !shouldRunOperatorPresenceV178()) return v178RecoveryCandidate;
        const db = initFirebase();
        if (!db || !currentAuthUser) return null;
        v178RecoveryBusy = true;
        try {
          const activeSnap = await db.ref(`activeTournaments/${operatorVenueIdV178()}`).get();
          const active = activeSnap.val();
          const id = active?.tournamentId || active?.id || "";
          if (!id || active?.status !== "running") {
            setRecoveryCandidateV178(null);
            return null;
          }
          const stateSnap = await db.ref(`tournaments/${id}/state`).get();
          const payload = stateSnap.val();
          if (!payload || payload?.tournament?.status !== "running") {
            setRecoveryCandidateV178(null);
            return null;
          }
          const remoteUpdatedAt = Number(payload.updatedAt || 0);
          const localUpdatedAt = Number(state?.updatedAt || 0);
          const localId = getCurrentTournamentId();
          const sameTournament = id === localId;
          const remoteNewer = remoteUpdatedAt > localUpdatedAt + 1500;
          const shouldOffer = !sameTournament || state?.tournament?.status !== "running" || remoteNewer;
          if (!shouldOffer) {
            setRecoveryCandidateV178(null);
            return null;
          }
          const candidate = {
            id,
            active,
            payload,
            remoteUpdatedAt,
            localUpdatedAt,
            sameTournament,
            remoteNewer,
            reason,
            label: `${payload.tournament?.venue || active.venueName || "경기장"} · ${payload.tournament?.name || active.tournamentName || "대회명 미입력"}`
          };
          setRecoveryCandidateV178(candidate);
          return candidate;
        } catch (error) {
          console.warn("v178 recovery candidate check failed", error);
          return v178RecoveryCandidate;
        } finally {
          v178RecoveryBusy = false;
        }
      }

      function canWriteByLeaseV178(actionName = "이 작업") {
        if (!currentAuthUser || !canOperate()) return true;
        if (!state?.tournament || state.tournament.status !== "running") return true;
        if (!v178LeaseLoaded) {
          refreshOperationLeaseV178().then(() => {
            if (!isLeaseHeldByOtherV178() && !isLeaseMineV178()) claimOperationLeaseV178("auto-check", false);
          });
          alert(`${actionName} 전 운영권을 확인하는 중입니다. 잠시 후 다시 눌러주세요.`);
          return false;
        }
        if (isLeaseHeldByOtherV178()) {
          alert(`${actionName}은 현재 다른 브라우저가 운영권을 가지고 있어 실행할 수 없습니다.\n운영자: ${operationOwnerLabelV178()}`);
          return false;
        }
        if (!isLeaseMineV178()) {
          claimOperationLeaseV178("auto-action", false).then(ok => {
            if (ok && typeof renderOperator === "function") renderOperator();
          });
          alert(`${actionName} 전 운영권을 가져오는 중입니다. 완료 후 다시 눌러주세요.`);
          return false;
        }
        return true;
      }

      function isBackgroundLiveSyncReasonV270(reason = "") {
        const text = String(reason || "");
        return /operator-render|operator-fallback|createPointNextStage|setBroadcastStage|activateNextRoundAfterFinalist|goToNextRoundAfterFinalist|confirmRoundFinalist|createFinalRace|createCrowSemiFinal|createCrowFinalFromSemi|toggleFinalWinner|live-button-open-v267|viewer-open-v267|queued|v269|v270|v271|v272/.test(text);
      }

      function canPublishLiveNowV270() {
        if (!currentAuthUser || !canOperate()) return true;
        if (!state?.tournament || state.tournament.status !== "running") return true;
        if (!v178LeaseLoaded) return false;
        if (isLeaseHeldByOtherV178()) return false;
        return isLeaseMineV178();
      }

      async function ensureWritableLeaseForBackgroundSyncV270(reason = "background-live-sync") {
        if (!currentAuthUser || !canOperate()) return true;
        if (!state?.tournament || state.tournament.status !== "running") return true;
        try {
          if (!v178LeaseLoaded) await refreshOperationLeaseV178();
          if (isLeaseHeldByOtherV178()) {
            syncLeaseStateToDomV178();
            return false;
          }
          if (!isLeaseMineV178()) {
            await claimOperationLeaseV178(`live-${String(reason || "sync").slice(0, 56)}`, false);
          }
          if (!isLeaseMineV178() && !isLeaseHeldByOtherV178()) await refreshOperationLeaseV178();
          syncLeaseStateToDomV178();
          return isLeaseMineV178();
        } catch (error) {
          console.warn("v270 background lease sync failed", error);
          return false;
        }
      }

      function runAfterWritableLeaseV270(reason, callback) {
        return ensureWritableLeaseForBackgroundSyncV270(reason).then(ok => {
          if (!ok) return false;
          return callback();
        }).catch(error => {
          console.warn("v270 leased live sync failed", error);
          return false;
        });
      }

      async function recoverRemoteTournamentV178(id = "") {
        const targetId = id || v178RecoveryCandidate?.id || "";
        if (!targetId) return alert("복구할 진행중 대회를 찾지 못했습니다.");
        const db = initFirebase();
        if (!db || !currentAuthUser) return alert("로그인 상태가 필요합니다.");
        const snap = await db.ref(`tournaments/${targetId}/state`).get();
        const payload = snap.val();
        if (!payload) return alert("원격 진행 상태를 읽지 못했습니다.");
        const label = `${payload.tournament?.venue || "경기장"} · ${payload.tournament?.name || "대회명 미입력"}`;
        if (!confirm(`${label}\n이 진행 상태를 현재 브라우저로 이어받을까요?`)) return;
        state = normalizeImportedState(payload);
        state.tournament.liveId = targetId;
        state.tournament.liveSignature = state.tournament.liveSignature || targetId;
        activeRoundIndex = Math.max(0, Math.min(Number(state.activeRoundIndex || 0), Math.max(0, (state.qualifierRounds || []).length - 1)));
        state.activeRoundIndex = activeRoundIndex;
        firebaseTournamentId = targetId;
        safeSetItem("mini4wdTournamentId", targetId);
        safeSetItem("mini4wdActiveLiveId", targetId);
        safeSetItem("mini4wdActiveLiveSignature", state.tournament.liveSignature || targetId);
        persistCurrentState();
        createAutoSnapshot("새로고침/다중접속 원격 복구");
        await claimOperationLeaseV178("remote-recovery", true);
        logTournamentAction("원격 진행 상태 복구", targetId);
        setRecoveryCandidateV178(null);
        renderOperator();
      }

      async function takeoverOperationLeaseV178(force = true) {
        if (isLeaseHeldByOtherV178() && !confirm(`현재 운영권: ${operationOwnerLabelV178()}\n이 브라우저로 운영권을 가져올까요?`)) return false;
        const ok = await claimOperationLeaseV178(force ? "manual-takeover" : "manual", force);
        if (!ok) return alert("운영권을 가져오지 못했습니다. 다른 브라우저의 상태를 확인하세요.");
        logTournamentAction(force ? "운영권 가져오기" : "운영권 확보", operatorSessionIdV178());
        renderOperator();
        return true;
      }

      function renderOperationSessionPanelV178() {
        const leaseState = isLeaseMineV178() ? "운영 가능" : isLeaseHeldByOtherV178() ? "다른 운영자 사용 중" : v178LeaseLoaded ? "운영 가능" : "확인 중";
        const leaseClass = isLeaseMineV178() ? "mine" : isLeaseHeldByOtherV178() ? "other" : "open";
        const heartbeatText = v178LastHeartbeatAt ? formatDateTimeLocal(new Date(v178LastHeartbeatAt)) : "-";
        const recovery = v178RecoveryCandidate;
        return `<section class="ops-panel session-lease-panel-v178">
          <div class="session-lease-head-v178">
            <div>
              <strong>운영권 보호와 복구 상태</strong>
              <span class="session-chip-v178 ${leaseClass}" data-v178-lease-chip>${escapeHtml(leaseState)}</span>
              <span class="hint">남은 시간 <span data-v178-lease-remaining>${escapeHtml(leaseRemainingTextV178())}</span></span>
            </div>
            <div class="session-actions-v178">
              <button class="${isLeaseMineV178() ? "ghost" : "primary"}" onclick="takeoverOperationLeaseV178(true)">운영권 가져오기</button>
              <button class="ghost" onclick="refreshOperationLeaseV178().then(()=>renderOperator())">새로고침</button>
              <button class="ghost" onclick="refreshRecoveryCandidateV178('manual').then(()=>renderOperator())">진행 대회 확인</button>
            </div>
          </div>
          ${recovery ? `<div class="recovery-card-v178"><div><b>이어받을 진행 대회</b><span>${escapeHtml(recovery.label)} · ${escapeHtml(formatDateTimeLocal(new Date(recovery.remoteUpdatedAt || Date.now())))}</span></div><button class="primary" onclick="recoverRemoteTournamentV178('${escapeAttr(recovery.id)}')">이 상태로 복구</button></div>` : `<div class="hint recovery-empty-v178">복구할 진행 대회가 없습니다.</div>`}
        </section>`;
      }

      function startOperatorPresenceV178() {
        operatorSessionIdV178();
        if (!shouldRunOperatorPresenceV178()) return;
        if (!v178HeartbeatTimer) {
          v178HeartbeatTimer = setInterval(() => writeOperatorHeartbeatV178("interval"), OPERATOR_SESSION_HEARTBEAT_MS_V178);
        }
        writeOperatorHeartbeatV178("render");
        scheduleRecoveryCheckV178("render");
      }

      const originalCanModifyTournamentActionV178 = typeof canModifyTournamentAction === "function" ? canModifyTournamentAction : null;
      if (originalCanModifyTournamentActionV178 && !originalCanModifyTournamentActionV178.__v178Wrapped) {
        const wrappedCanModifyTournamentActionV178 = function canModifyTournamentActionV178(actionName = "이 작업"){
          if (!originalCanModifyTournamentActionV178.apply(this, arguments)) return false;
          return canWriteByLeaseV178(actionName);
        };
        wrappedCanModifyTournamentActionV178.__v178Wrapped = true;
        try { canModifyTournamentAction = wrappedCanModifyTournamentActionV178; window.canModifyTournamentAction = wrappedCanModifyTournamentActionV178; } catch (error) {}
      }

      const originalStartTournamentAsyncV178 = typeof startTournamentAsync === "function" ? startTournamentAsync : null;
      if (originalStartTournamentAsyncV178 && !originalStartTournamentAsyncV178.__v178Wrapped) {
        const wrappedStartTournamentAsyncV178 = async function startTournamentAsyncV178(){
          const ok = await claimOperationLeaseV178("tournament-start", false);
          if (!ok) return alert("다른 브라우저가 이 경기장의 운영권을 가지고 있어 대회를 시작할 수 없습니다.");
          return originalStartTournamentAsyncV178.apply(this, arguments);
        };
        wrappedStartTournamentAsyncV178.__v178Wrapped = true;
        try { startTournamentAsync = wrappedStartTournamentAsyncV178; window.startTournamentAsync = wrappedStartTournamentAsyncV178; } catch (error) {}
      }

      const originalAcquireOperationLockV178 = typeof acquireOperationLock === "function" ? acquireOperationLock : null;
      if (originalAcquireOperationLockV178 && !originalAcquireOperationLockV178.__v178Wrapped) {
        const wrappedAcquireOperationLockV178 = async function acquireOperationLockV178(){
          const ok = await claimOperationLeaseV178("manual-lock", false);
          if (!ok) return alert("다른 브라우저가 운영권을 가지고 있어 잠금할 수 없습니다.");
          return originalAcquireOperationLockV178.apply(this, arguments);
        };
        wrappedAcquireOperationLockV178.__v178Wrapped = true;
        try { acquireOperationLock = wrappedAcquireOperationLockV178; window.acquireOperationLock = wrappedAcquireOperationLockV178; } catch (error) {}
      }

      const originalReleaseOperationLockV178 = typeof releaseOperationLock === "function" ? releaseOperationLock : null;
      if (originalReleaseOperationLockV178 && !originalReleaseOperationLockV178.__v178Wrapped) {
        const wrappedReleaseOperationLockV178 = function releaseOperationLockV178(force = false){
          const result = originalReleaseOperationLockV178.apply(this, arguments);
          releaseOperationLeaseV178(Boolean(force));
          return result;
        };
        wrappedReleaseOperationLockV178.__v178Wrapped = true;
        try { releaseOperationLock = wrappedReleaseOperationLockV178; window.releaseOperationLock = wrappedReleaseOperationLockV178; } catch (error) {}
      }

      const originalQueueFirebaseSaveV178 = typeof queueFirebaseSave === "function" ? queueFirebaseSave : null;
      if (originalQueueFirebaseSaveV178 && !originalQueueFirebaseSaveV178.__v178Wrapped) {
        const wrappedQueueFirebaseSaveV178 = function queueFirebaseSaveV178(){
          if (state?.tournament?.status === "running" && currentAuthUser && canOperate() && (!v178LeaseLoaded || !isLeaseMineV178())) {
            const self = this;
            const args = arguments;
            runAfterWritableLeaseV270("queued-save", () => originalQueueFirebaseSaveV178.apply(self, args));
            return false;
          }
          if (state?.tournament?.status === "running" && !canWriteByLeaseV178("저장")) return false;
          return originalQueueFirebaseSaveV178.apply(this, arguments);
        };
        wrappedQueueFirebaseSaveV178.__v178Wrapped = true;
        try { queueFirebaseSave = wrappedQueueFirebaseSaveV178; window.queueFirebaseSave = wrappedQueueFirebaseSaveV178; } catch (error) {}
      }

      const originalForceLiveBroadcastSyncV178 = typeof forceLiveBroadcastSync === "function" ? forceLiveBroadcastSync : null;
      if (originalForceLiveBroadcastSyncV178 && !originalForceLiveBroadcastSyncV178.__v178Wrapped) {
        const wrappedForceLiveBroadcastSyncV178 = function forceLiveBroadcastSyncV178(reason = "manual"){
          if (state?.tournament?.status === "running" && currentAuthUser && canOperate() && (!v178LeaseLoaded || !isLeaseMineV178()) && isBackgroundLiveSyncReasonV270(reason)) {
            const self = this;
            const args = arguments;
            return runAfterWritableLeaseV270(reason, () => originalForceLiveBroadcastSyncV178.apply(self, args));
          }
          if (state?.tournament?.status === "running" && !canWriteByLeaseV178("LIVE 동기화")) return Promise.resolve(false);
          return originalForceLiveBroadcastSyncV178.apply(this, arguments);
        };
        wrappedForceLiveBroadcastSyncV178.__v178Wrapped = true;
        try { forceLiveBroadcastSync = wrappedForceLiveBroadcastSyncV178; window.forceLiveBroadcastSync = wrappedForceLiveBroadcastSyncV178; } catch (error) {}
      }

      const originalRenderOperationPanelV178 = typeof renderOperationPanel === "function" ? renderOperationPanel : null;
      if (originalRenderOperationPanelV178 && !originalRenderOperationPanelV178.__v178Wrapped) {
        const wrappedRenderOperationPanelV178 = function renderOperationPanelV178(){
          return `${originalRenderOperationPanelV178.apply(this, arguments)}${renderOperationSessionPanelV178()}`;
        };
        wrappedRenderOperationPanelV178.__v178Wrapped = true;
        try { renderOperationPanel = wrappedRenderOperationPanelV178; window.renderOperationPanel = wrappedRenderOperationPanelV178; } catch (error) {}
      }

      const originalRenderOperatorV178 = typeof renderOperator === "function" ? renderOperator : null;
      if (originalRenderOperatorV178 && !originalRenderOperatorV178.__v178Wrapped) {
        const wrappedRenderOperatorV178 = function renderOperatorV178(){
          startOperatorPresenceV178();
          return originalRenderOperatorV178.apply(this, arguments);
        };
        wrappedRenderOperatorV178.__v178Wrapped = true;
        try { renderOperator = wrappedRenderOperatorV178; window.renderOperator = wrappedRenderOperatorV178; } catch (error) {}
      }

      const originalLoadActiveTournamentV135 = window.loadActiveTournamentV135;
      if (typeof originalLoadActiveTournamentV135 === "function" && !originalLoadActiveTournamentV135.__v178Wrapped) {
        window.loadActiveTournamentV135 = async function loadActiveTournamentV178(id){
          await originalLoadActiveTournamentV135.apply(this, arguments);
          await claimOperationLeaseV178("load-active-tournament", true);
          setRecoveryCandidateV178(null);
          if (typeof renderOperator === "function") renderOperator();
        };
        window.loadActiveTournamentV135.__v178Wrapped = true;
      }

      window.claimOperationLeaseV178 = claimOperationLeaseV178;
      window.refreshOperationLeaseV178 = refreshOperationLeaseV178;
      window.takeoverOperationLeaseV178 = takeoverOperationLeaseV178;
      window.recoverRemoteTournamentV178 = recoverRemoteTournamentV178;
      window.refreshRecoveryCandidateV178 = refreshRecoveryCandidateV178;
      window.__mini4wdCanPublishLiveNowV270 = canPublishLiveNowV270;
      window.__mini4wdEnsureWritableLeaseForLiveSyncV270 = ensureWritableLeaseForBackgroundSyncV270;
      window.__mini4wdOperatorSession = {
        sessionId: operatorSessionIdV178(),
        leaseMs: OPERATION_LEASE_MS_V178,
        heartbeatMs: OPERATOR_SESSION_HEARTBEAT_MS_V178,
        paths: ["operationLocks/leases/{venueId}", "operationLocks/sessions/{venueId}/{uid}/{sessionId}"]
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          refreshOperationLeaseV178().then(() => writeOperatorHeartbeatV178("visible"));
          scheduleRecoveryCheckV178("visible");
        }
      });
      window.addEventListener("pagehide", () => {
        try {
          const db = initFirebase();
          if (db && currentAuthUser && v178LastSessionPath) db.ref(v178LastSessionPath).update({ online: false, hiddenAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
        } catch (error) {}
      });
      setTimeout(() => {
        startOperatorPresenceV178();
        if (shouldRunOperatorPresenceV178() && typeof renderOperator === "function") renderOperator();
      }, 0);
    })();

    /* v124 device UI audit runtime: apply mode immediately and after all render mutations */
    (function installDeviceUiModeRuntime(){
      if (window.__mini4wdDeviceUiModeRuntimeInstalled) return;
      window.__mini4wdDeviceUiModeRuntimeInstalled = true;
      const MODE_CLASSES = ["ui-mode-pc", "ui-mode-mobile", "ui-mode-tv"];
      const PAGE_CLASSES = Array.from(MINI4WD_PAGE_CLASSES);
      let pending = 0;

      function hashViewV124(){
        try { return (getHashParams().get("view") || "operator").trim(); }
        catch (error) { return "operator"; }
      }
      function isMobileViewportV124(){
        try {
          if (window.matchMedia && window.matchMedia("(max-width: 760px)").matches) return true;
          if (window.matchMedia && window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches) return true;
          return window.innerWidth <= 760;
        } catch (error) { return false; }
      }
      function pageClassV124(view){
        const surface = document.documentElement.getAttribute("data-ui-surface") || "";
        if (surface === "operator") return "ui-page-operator";
        if (surface === "player-management") return "ui-page-db";
        if (surface === "admin-accounts" || surface === "admin-matches") return "ui-page-admin";
        if (surface === "dashboard") return "ui-page-dashboard";
        if (surface === "live-lobby") return "ui-page-live-lobby";
        if (surface === "mobile-live") return "ui-page-mobile-live";
        if (surface === "tv-live") return "ui-page-tv-live";
        if (surface === "login") return "ui-page-login";
        if (surface === "restricted") return "ui-page-restricted";
        if (surface === "print") return "ui-page-print";
        if (surface === "error") return "ui-page-error";
        if (view === "db") return "ui-page-db";
        if (view === "admin") return "ui-page-admin";
        if (view === "admin-matches") return "ui-page-admin";
        if (view === "dashboard") return "ui-page-dashboard";
        if (view === "live-lobby" || view === "live-list" || view === "lobby") return "ui-page-live-lobby";
        if (view === "mobile" || view === "mobile-live" || view === "live") return "ui-page-mobile-live";
        if (view === "tv" || view === "tv-live") return "ui-page-tv-live";
        if (view === "print") return "ui-page-print";
        if (view === "login") return "ui-page-login";
        return "ui-page-operator";
      }
      function modeV124(view){
        const surface = document.documentElement.getAttribute("data-ui-surface") || "";
        if (surface === "tv-live") return "tv";
        if (surface === "mobile-live") return "mobile";
        if (surface === "print") return "pc";
        if (surface) return isMobileViewportV124() ? "mobile" : "pc";
        if (view === "tv" || view === "tv-live") return "tv";
        if (view === "mobile" || view === "mobile-live" || view === "live") return "mobile";
        return isMobileViewportV124() ? "mobile" : "pc";
      }
      function stampTableLabelsV124(root){
        try {
          (root || document).querySelectorAll("table.roster-table, table.admin-table").forEach(table => {
            const headers = Array.from(table.querySelectorAll("thead th")).map(th => (th.textContent || "").replace(/▲|▼/g, "").trim() || "항목");
            table.querySelectorAll("tbody tr").forEach(row => {
              Array.from(row.children).forEach((cell, idx) => {
                if (!cell.getAttribute("data-label")) cell.setAttribute("data-label", headers[idx] || "항목");
              });
            });
          });
        } catch (error) {}
      }
      function applyV124(){
        try {
          const view = hashViewV124();
          const mode = modeV124(view);
          const page = pageClassV124(view);
          MODE_CLASSES.forEach(cls => document.body.classList.remove(cls));
          PAGE_CLASSES.forEach(cls => document.body.classList.remove(cls));
          document.body.classList.add(`ui-mode-${mode}`, page);
          if (mode === "tv") document.body.classList.add("tv-mode");
          else document.body.classList.remove("tv-mode");
          document.documentElement.setAttribute("data-ui-mode", mode);
          document.documentElement.setAttribute("data-ui-page", page);
          stampTableLabelsV124(document);
        } catch (error) { console.warn("v124 UI mode apply failed", error); }
      }
      function scheduleV124(){
        clearTimeout(pending);
        pending = setTimeout(applyV124, 0);
      }
      window.applyDeviceUiModeV124 = applyV124;
      window.addEventListener("resize", () => setTimeout(applyV124, 80));
      window.addEventListener("orientationchange", () => setTimeout(applyV124, 160));
      window.addEventListener("hashchange", () => setTimeout(applyV124, 0));
      try {
        new MutationObserver(scheduleV124).observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
      } catch (error) {}
      applyV124();
      setTimeout(applyV124, 0);
      setTimeout(applyV124, 250);
    })();

    /* v171: route hash refresh for LIVE viewer transitions */
    (function installLiveRouteRefreshRuntime(){
      if (window.__mini4wdLiveRouteRefreshRuntimeInstalled) return;
      window.__mini4wdLiveRouteRefreshRuntimeInstalled = true;
      let routeTimer = null;
      window.addEventListener("hashchange", () => {
        clearTimeout(routeTimer);
        routeTimer = setTimeout(() => {
          try {
            if (typeof bootV33 === "function") bootV33().catch(error => console.warn("v171 route refresh failed", error));
          } catch (error) {
            console.warn("v171 route refresh failed", error);
          }
        }, 0);
      });
    })();

    try {
      const currentReleaseVersion = Number(MINI4WD_BUILD.version || 0) || 0;
      document.documentElement.setAttribute("data-release-version", String(currentReleaseVersion));
      document.documentElement.setAttribute("data-release-label", mini4wdBuildLabel());
      window.__mini4wdCurrentRelease = {
        build: mini4wdBuildLabel(),
        version: currentReleaseVersion,
        rulesChanged: Boolean(MINI4WD_BUILD.rulesChanged),
        surfaces: Array.from(MINI4WD_SURFACES),
        activeRuntime: [
          "public-live-sanitized-state",
          "firebase-save-batching",
          "active-tournament-recovery",
          "operator-session-lease",
          "same-tab-live-route-guard",
          "mobile-operator-undo-v266"
        ],
        removedLegacyRuntime: [
          "manual-live-session-stubs",
          "snapshot-share-url-helpers",
          "retired-tv-player-renderer",
          "retired-mobile-readonly-renderer",
          "historical-release-marker-chain"
        ]
      };
    } catch (error) {
      console.warn("current release state init failed", error);
    }
