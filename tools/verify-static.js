const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "src/core/config.js",
  "src/core/build.js",
  "src/app.js",
  "src/styles/app.css",
  "src/styles/operator-mobile.css",
  "firebase.json",
  ".firebaserc",
  "database.rules.json",
  "tools/qa-admin-flow.cjs",
  "tools/qa-operator-flow.cjs",
  "tools/qa-result-matrix.cjs",
  "tools/qa-match-simulation.cjs"
];

const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function stripQuery(value) {
  return String(value || "").split(/[?#]/)[0];
}

function isExternalUrl(value) {
  return /^https?:\/\//i.test(value) || /^data:/i.test(value);
}

function assertJson(relativePath) {
  const text = readText(relativePath);
  if (!text) return;
  try {
    JSON.parse(text);
  } catch (error) {
    fail(`Invalid JSON: ${relativePath} (${error.message})`);
  }
}

function assertClassicScriptSyntax(label, source) {
  try {
    new Function(source);
  } catch (error) {
    fail(`JavaScript syntax failed: ${label} (${error.message})`);
  }
}

function assertNoDuplicateFunctionDeclarations(label, source) {
  const hits = new Map();
  const pattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(source))) {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    const list = hits.get(match[1]) || [];
    list.push(line);
    hits.set(match[1], list);
  }
  const duplicates = [...hits.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([name, lines]) => `${name} at lines ${lines.join(", ")}`);
  if (duplicates.length) fail(`${label} has duplicate function declarations: ${duplicates.join("; ")}.`);
}

requiredFiles.forEach(relativePath => {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing file: ${relativePath}`);
});

const indexHtml = readText("index.html");
const configJs = readText("src/core/config.js");
const buildJs = readText("src/core/build.js");
const appJs = readText("src/app.js");
const appCss = readText("src/styles/app.css");
const appCssLf = appCss.replace(/\r\n/g, "\n");
const operatorMobileCss = readText("src/styles/operator-mobile.css");
const databaseRules = readText("database.rules.json");
const resultMatrixQa = readText("tools/qa-result-matrix.cjs");
const matchSimulationQa = readText("tools/qa-match-simulation.cjs");
const operatorQa = readText("tools/qa-operator-flow.cjs");
const adminQa = readText("tools/qa-admin-flow.cjs");

function readBuildMeta(source) {
  const sandbox = { window: {}, console };
  try {
    vm.runInNewContext(source, sandbox, { filename: "src/core/build.js" });
  } catch (error) {
    fail(`Build metadata evaluation failed: ${error.message}`);
    return {};
  }
  const meta = sandbox.window.MINI4WD_BUILD_META || {};
  if (!meta.version) fail("src/core/build.js is missing MINI4WD_BUILD_META.version.");
  if (!meta.label) fail("src/core/build.js is missing MINI4WD_BUILD_META.label.");
  if (!meta.assets) fail("src/core/build.js is missing MINI4WD_BUILD_META.assets.");
  return meta;
}

const buildMeta = readBuildMeta(buildJs);

function expectedAsset(relativePath, key) {
  const version = buildMeta.assets && buildMeta.assets[key];
  if (!Number.isInteger(version)) fail(`src/core/build.js is missing numeric asset version: ${key}.`);
  return `${relativePath}?v=${version || "missing"}`;
}

assertJson("firebase.json");
assertJson(".firebaserc");
assertJson("database.rules.json");

if (/<style\b/i.test(indexHtml)) fail("index.html must not contain inline <style> blocks.");
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(indexHtml)) fail("index.html must not contain inline application scripts.");

const stylesheetMatches = [...indexHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*>/gi)];
const scriptMatches = [...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi)];

const stylesheetHrefs = stylesheetMatches.map(match => match[1]);
const scriptSrcs = scriptMatches.map(match => match[1]);

const expectedCssHref = expectedAsset("src/styles/app.css", "css");
const expectedOperatorMobileCssHref = expectedAsset("src/styles/operator-mobile.css", "operatorMobileCss");
const expectedConfigSrc = expectedAsset("src/core/config.js", "config");
const expectedBuildSrc = expectedAsset("src/core/build.js", "build");
const expectedAppSrc = expectedAsset("src/app.js", "app");

if (!stylesheetHrefs.includes(expectedCssHref)) fail(`index.html must reference ${expectedCssHref}.`);
if (!stylesheetHrefs.includes(expectedOperatorMobileCssHref)) fail(`index.html must reference ${expectedOperatorMobileCssHref}.`);
if (!scriptSrcs.includes(expectedConfigSrc)) fail(`index.html must reference ${expectedConfigSrc}.`);
if (!scriptSrcs.includes(expectedBuildSrc)) fail(`index.html must reference ${expectedBuildSrc}.`);
if (!scriptSrcs.includes(expectedAppSrc)) fail(`index.html must reference ${expectedAppSrc}.`);
if (buildMeta.label && !indexHtml.includes(buildMeta.label)) fail(`index.html must include latest build label: ${buildMeta.label}.`);

const appCssIndex = stylesheetHrefs.indexOf(expectedCssHref);
const operatorMobileCssIndex = stylesheetHrefs.indexOf(expectedOperatorMobileCssHref);
if (appCssIndex < 0 || operatorMobileCssIndex < 0 || appCssIndex > operatorMobileCssIndex) {
  fail("src/styles/operator-mobile.css must load after src/styles/app.css.");
}

const configIndex = scriptSrcs.indexOf(expectedConfigSrc);
const buildIndex = scriptSrcs.indexOf(expectedBuildSrc);
const appIndex = scriptSrcs.indexOf(expectedAppSrc);
if (configIndex < 0 || buildIndex < 0 || appIndex < 0 || configIndex > buildIndex || buildIndex > appIndex) {
  fail("src/core/config.js and src/core/build.js must load before src/app.js.");
}

[...stylesheetHrefs, ...scriptSrcs].forEach(assetPath => {
  if (isExternalUrl(assetPath)) return;
  const cleanPath = stripQuery(assetPath);
  if (!fs.existsSync(path.join(root, cleanPath))) fail(`Referenced asset missing: ${assetPath}`);
});

assertClassicScriptSyntax("src/core/config.js", configJs);
assertClassicScriptSyntax("src/core/build.js", buildJs);
assertClassicScriptSyntax("src/app.js", appJs);
assertClassicScriptSyntax("combined classic scripts", `${configJs}\n${buildJs}\n${appJs}`);
assertNoDuplicateFunctionDeclarations("src/app.js", appJs);

if (!appCss.trim()) fail("src/styles/app.css is empty.");
if (!operatorMobileCss.trim()) fail("src/styles/operator-mobile.css is empty.");
if (!operatorMobileCss.includes("v255: rewritten mobile operator surface source of truth")) fail("src/styles/operator-mobile.css is missing the v255 mobile operator rewrite marker.");
if (!operatorMobileCss.includes("v262: dock button row is vertically centered inside the frame")) fail("src/styles/operator-mobile.css is missing the v262 dock frame centering marker.");
[
  "--operator-mobile-rewrite-v255",
  ".operator-shell-v211",
  ".operator-titlebar-v249",
  ".operator-mobile-top-route-v233",
  ".operator-overview-v226",
  ".operator-round-rail-v226",
  ".operator-current-task-v227",
  ".operator-static-panel-v236",
  ".operator-mobile-dock-v233"
].forEach(selector => {
  if (!operatorMobileCss.includes(selector)) fail(`src/styles/operator-mobile.css is missing mobile operator rewrite selector: ${selector}.`);
});
if (!appCss.includes("v152: operator control cleanup")) fail("src/styles/app.css is missing the latest operator cleanup layer.");
if (!appCss.includes("v158: page surface polish")) fail("src/styles/app.css is missing the v158 page surface polish layer.");
if (!appCss.includes("v161: complete component surface coverage")) fail("src/styles/app.css is missing the v161 complete surface coverage layer.");
if (!appCss.includes("v162: build metadata and quality baseline")) fail("src/styles/app.css is missing the v162 quality baseline marker.");
if (!appCss.includes("v165: visual alignment cleanup")) fail("src/styles/app.css is missing the v165 visual alignment marker.");
if (!appCss.includes("v166: typography harmonization")) fail("src/styles/app.css is missing the v166 typography harmonization marker.");
if (!appCss.includes("v167: mobile operator start-flow cleanup")) fail("src/styles/app.css is missing the v167 mobile operator cleanup marker.");
if (!appCss.includes("v168: mobile operator density pass")) fail("src/styles/app.css is missing the v168 mobile operator density marker.");
if (!appCss.includes("v169: keep only the mobile overview")) fail("src/styles/app.css is missing the v169 mobile overview dedupe marker.");
if (!appCss.includes("v172: mobile prep CTA background cleanup")) fail("src/styles/app.css is missing the v172 mobile prep CTA cleanup marker.");
if (!appCss.includes("v173: mobile surface header and terminology unification")) fail("src/styles/app.css is missing the v173 mobile surface unification marker.");
if (!appCss.includes("v174: player DB unified header fit correction")) fail("src/styles/app.css is missing the v174 player DB header fit marker.");
if (!appCss.includes("v175: live result visibility and TV recent-record density")) fail("src/styles/app.css is missing the v175 live result visibility marker.");
if (!appCss.includes("v176: UI foundation pass for consistent non-TV surfaces")) fail("src/styles/app.css is missing the v176 UI foundation marker.");
if (!appCss.includes("v177: admin mobile list polish")) fail("src/styles/app.css is missing the v177 admin mobile list marker.");
if (!appCss.includes("v178: operator session lease and refresh recovery panel")) fail("src/styles/app.css is missing the v178 operator session lease marker.");
if (!appCss.includes("v180: button vertical alignment normalization")) fail("src/styles/app.css is missing the v180 button alignment marker.");
if (!appCss.includes("v182: checkbox control sizing guard")) fail("src/styles/app.css is missing the v182 checkbox sizing marker.");
if (!appCss.includes("v186: admin command center cleanup")) fail("src/styles/app.css is missing the v186 admin command center marker.");
if (!appCss.includes("v191: compact DB and admin mobile tables")) fail("src/styles/app.css is missing the v191 DB/admin compact mobile table marker.");
if (!appCss.includes("v218: restrained design tokens and shared surface polish")) fail("src/styles/app.css is missing the v218 design token marker.");
if (!appCss.includes("v219: calmer mobile operator composition")) fail("src/styles/app.css is missing the v219 mobile operator design marker.");
if (!appCss.includes("v220: DB and admin surfaces share the same operational density")) fail("src/styles/app.css is missing the v220 DB/admin design marker.");
if (!appCss.includes("v221: design QA guardrails stay CSS-only")) fail("src/styles/app.css is missing the v221 design QA marker.");
if (!appCss.includes("v222: remaining public and auxiliary surfaces align with the v218 design system")) fail("src/styles/app.css is missing the v222 auxiliary surface design marker.");
if (!appCss.includes("v224: common UI foundation and operator reconstruction")) fail("src/styles/app.css is missing the v224 operator UI foundation marker.");
if (!appCss.includes("v226: operator frame alignment removes OP badge")) fail("src/styles/app.css is missing the v226 operator frame alignment marker.");
if (!appCss.includes("v227: operator lower workflow panels share one compact structure")) fail("src/styles/app.css is missing the v227 operator lower workflow marker.");
if (!appCss.includes("v228: finalist confirmation only appears when the current stage can be confirmed")) fail("src/styles/app.css is missing the v228 finalist action feedback marker.");
if (!appCss.includes("v229: group advance selection persists through the same live-save path as scores")) fail("src/styles/app.css is missing the v229 advance selection save marker.");
if (!appCss.includes("v230: operator setup and tools panels share the same section structure")) fail("src/styles/app.css is missing the v230 operator side unify marker.");
if (!appCss.includes("v231: UI copy removes duplicate and system-facing labels")) fail("src/styles/app.css is missing the v231 UI copy cleanup marker.");
if (!appCss.includes("v233: mobile operator page routes move to the top")) fail("src/styles/app.css is missing the v233 operator top navigation marker.");
if (!appCss.includes("v234: fixed mobile operator dock uses the same compact border shape as the panels")) fail("src/styles/app.css is missing the v234 operator dock border marker.");
if (!appCss.includes("v235: operator screen uses one 8px border contract across panels, tabs, controller, and dock")) fail("src/styles/app.css is missing the v235 operator border contract marker.");
if (!appCss.includes("v236: operator setup and tools panels stay visible instead of folding like details")) fail("src/styles/app.css is missing the v236 operator static panel marker.");
if (!appCss.includes("v237: operator misc panel uses non-tool copy across the panel and mobile dock")) fail("src/styles/app.css is missing the v237 operator misc copy marker.");
if (!appCss.includes("v238: mobile dock primary action uses the same height as the section buttons")) fail("src/styles/app.css is missing the v238 operator dock height marker.");
if (!appCss.includes("v240: mobile ready state hides the duplicate current-game console")) fail("src/styles/app.css is missing the v240 mobile ready trim marker.");
if (!appCss.includes("v243: operator side panel headers and action rows share aligned edges")) fail("src/styles/app.css is missing the v243 side panel alignment marker.");
if (!appCss.includes("v244: CSS audit cleanup removes stale operator-mobile-nav-v224 rules")) fail("src/styles/app.css is missing the v244 CSS audit cleanup marker.");
if (/\.operator-mobile-nav-v224\b/.test(appCss)) fail("src/styles/app.css must not keep the stale operator-mobile-nav-v224 CSS-only class.");
if (!appCss.includes("#operatorCurrentRoundV147.operator-current-task-v227.round-card") || !appCss.includes("#operatorSetupAreaV214.operator-side-panel-v227.operator-page")) fail("src/styles/app.css is missing the v235 strong operator border contract selectors.");
if (!operatorQa.includes("operatorBorderSample")) fail("tools/qa-operator-flow.cjs must sample operator border contract styles.");
if (!operatorQa.includes("operatorMobileDockButtonHeights")) fail("tools/qa-operator-flow.cjs must sample mobile dock button heights.");
if (!appJs.includes("function isPointFinalDecisionStage") || !appJs.includes("isPointFinalDecisionStage(lastStage)")) fail("src/app.js must normalize legacy point final decision stages into the finalist-confirm path.");
if (!appJs.includes("hidePointFinalHeaderV239") || !appJs.includes("point-final-stage-v239")) fail("src/app.js must hide the v239 point-final header area.");
if (!operatorQa.includes("point-final-trim") || !operatorQa.includes("point-final-stage-v239")) fail("tools/qa-operator-flow.cjs must guard the v239 point-final trim.");
if (appJs.includes("\uC9C4\uCD9C \uD655\uC815 \uD6C4 \uB2E4\uC74C \uB77C\uC6B4\uB4DC")) fail("src/app.js must not use the overflowing point-final mobile dock label.");
if (!operatorQa.includes("point-final-confirmed-dock") || !operatorQa.includes("point-final-ready-dock-click") || !operatorQa.includes("legacy-point-final-next-round") || !operatorQa.includes("badOverflow")) fail("tools/qa-operator-flow.cjs must guard the point-final mobile dock label and click path.");
if (!appJs.includes("hideMobileReadyConsoleV240") || !appJs.includes("operator-ready-console-v240")) fail("src/app.js must hide the v240 mobile ready current-game console.");
if (!operatorQa.includes("operatorReadyConsoleVisibleV240")) fail("tools/qa-operator-flow.cjs must guard the v240 mobile ready console trim.");
const groupCompositionCopyV241 = "\uC870 \uD3B8\uC131";
const groupCountCopyV241 = "\uC870 \uC218";
if (!appJs.includes(`<label>${groupCompositionCopyV241}</label>`)) fail("src/app.js must rename the forced group-count setting label to 조 편성.");
if (appJs.includes(`<label>${groupCountCopyV241}</label>`)) fail("src/app.js must not render the old 조 수 settings label.");
if (!operatorQa.includes("operatorGroupCopyV241")) fail("tools/qa-operator-flow.cjs must guard the v241 group composition copy.");
if (!appJs.includes("forced-group-count-input-v265") || !appJs.includes("setForcedGroupCountDraft(this.value, this)") || !appJs.includes("bindForcedGroupCountInputs(app)") || !appJs.includes("syncForcedGroupCountInputFromDom") || appJs.includes("setSetting('forcedGroupCount', this.value)")) fail("src/app.js must use the v265 non-rerendering forced group-count input handler.");
if (!operatorQa.includes("forced-group-manual-input") || !operatorQa.includes("forcedGroupManualInput")) fail("tools/qa-operator-flow.cjs must guard the v265 forced group-count manual input path.");
if (!appJs.includes("OPERATOR_UNDO_STORAGE_KEY_V266") || !appJs.includes("captureOperatorUndoSnapshotV266") || !appJs.includes("restoreOperatorUndoV266") || !appJs.includes("refreshOperatorUndoFloatV266") || !appJs.includes("operator-undo-float-v266")) fail("src/app.js is missing the v266 mobile operator undo path.");
if (!operatorMobileCss.includes("v266: mobile-only floating undo button") || !operatorMobileCss.includes("operator-undo-float-v266")) fail("src/styles/operator-mobile.css is missing the v266 mobile undo floating button style.");
if (!operatorQa.includes("operator-mobile-undo-v266")) fail("tools/qa-operator-flow.cjs must guard the v266 mobile operator undo flow.");
if (appJs.includes("function renderFirebaseLivePanel") || appJs.includes("live-sync-panel")) fail("src/app.js must not render the v242 removed operator live broadcast panel.");
if (appJs.includes("renderBroadcastStatus()") || appJs.includes("function renderBroadcastStatus") || appJs.includes("finalist-item\">\uC1A1\uCD9C \uC5C6\uC74C") || appJs.includes("finalist-item\"><b>\uC1A1\uCD9C \uC911")) fail("src/app.js must not render residual broadcast-status rows inside the operator misc panel.");
if (!operatorQa.includes("operatorLivePanelGoneV242")) fail("tools/qa-operator-flow.cjs must guard the v242 live broadcast panel trim.");
if (!appJs.includes("operator-download-button-row-v243")) fail("src/app.js must wrap operator download buttons for v243 aligned action rows.");
if (!operatorQa.includes("operatorSideAlignmentV243")) fail("tools/qa-operator-flow.cjs must guard the v243 operator side panel alignment.");
if (!appJs.includes("renderOperatorFinalShortcutV245") || !appJs.includes("operator-final-shortcut-v245") || !appJs.includes("!state.finalRace")) fail("src/app.js is missing the v245 final shortcut placement.");
if (appJs.includes('<section class="final-box"><h2>${isCrowMode() ? "9강 최종 준결" : "최종 결승"}')) fail("src/app.js must not render the old pending final summary card.");
if (!appCss.includes("v245: final launch action sits directly under the round buttons")) fail("src/styles/app.css is missing the v245 final shortcut layer.");
if (!operatorQa.includes("operatorFinalShortcutV245")) fail("tools/qa-operator-flow.cjs must guard the v245 final shortcut placement.");
if (!appJs.includes("getOperatorControlContextV246") || !appJs.includes("operator-overview-controls-v246")) fail("src/app.js is missing the v246 merged overview controls.");
if (appJs.includes("<small>현재 경기</small>")) fail("src/app.js must not render the duplicate current-game controller header.");
if (!appCss.includes("v246: current-game controls are merged into the top operator overview card")) fail("src/styles/app.css is missing the v246 merged overview layer.");
if (!operatorQa.includes("operatorMergedOverviewV246")) fail("tools/qa-operator-flow.cjs must guard the v246 merged overview.");
if (!appJs.includes("point-stage-trim-v247")) fail("src/app.js is missing the v247 point stage header trim marker.");
if (appJs.includes('stage.pointOptions.join(" / ")}점')) fail("src/app.js must not render the deleted point-stage score-rule header.");
if (!operatorQa.includes("operatorPointStageTrimV247")) fail("tools/qa-operator-flow.cjs must guard the v247 point stage header trim.");
if (appJs.includes("operator-queue-panel-v227")) fail("src/app.js must not render the v248 deleted operator queue panel.");
if (!operatorQa.includes("operatorQueuePanelGoneV248")) fail("tools/qa-operator-flow.cjs must guard the v248 operator queue panel removal.");
if (!appJs.includes("operator-titlebar-v249")) fail("src/app.js is missing the v249 operator header polish marker.");
if (!appCss.includes("v249: operator header polish") || !appCss.includes("operator-titlebar-v249") || !appCss.includes("operator-mobile-dock-v233 > button")) fail("src/styles/app.css is missing the v249 operator polish layer.");
if (!operatorQa.includes("operatorHeaderPolishV249") || !operatorQa.includes("operatorEmergencyPanelV249") || !operatorQa.includes("operatorMobileDockAlignmentV249")) fail("tools/qa-operator-flow.cjs must guard the v249 operator polish pass.");
if (!appCss.includes("v250: compact operator rhythm") || !operatorQa.includes("operatorCompactRhythmV250")) fail("operator compact rhythm v250 guards are missing.");
if (!appCss.includes("v251: mobile dock buttons share the same optical height") || !operatorQa.includes("operatorMobileDockOpticalV251")) fail("operator mobile dock optical alignment v251 guards are missing.");
if (!appCss.includes("v252: mobile dock button backgrounds fill the same framed area") || !operatorQa.includes("operatorMobileDockBackgroundV252")) fail("operator mobile dock background alignment v252 guards are missing.");
if (!appCss.includes("v253: mobile dock button background columns are equal width") || !operatorQa.includes("operatorMobileDockWidthV253")) fail("operator mobile dock equal-width v253 guards are missing.");
if (!appCss.includes("v254: operator frame rhythm keeps like areas aligned") || !operatorQa.includes("operatorFrameRhythmV254")) fail("operator frame/button rhythm v254 guards are missing.");
if (!appCss.includes("v263: mobile DB roster uses card rows") || !operatorQa.includes("firstRowBadControlCount") || !operatorQa.includes("DB mobile roster card structure mismatch")) fail("mobile DB roster card v263 guards are missing.");
if (!operatorQa.includes("operatorMobileRewriteV255") || !operatorQa.includes("operatorMobileDockFrameV262")) fail("tools/qa-operator-flow.cjs must guard the v255 mobile operator rewrite and v262 dock frame.");
if (appJs.includes("<details class=\"operator-page")) fail("src/app.js must not render operator setup/tools as folding details panels.");
if (!appJs.includes('title: "기타"') || !appJs.includes("안내와 기록") || !appJs.includes("안내 열기") || !appJs.includes("기록 저장")) fail("src/app.js is missing the v237 operator misc copy.");
if (!operatorQa.includes('["경기", "설정", "기타"]')) fail("tools/qa-operator-flow.cjs must expect the v237 misc dock label.");
if (!appCss.includes("live route fallback and mobile control polish")) fail("src/styles/app.css is missing the live route/mobile control polish layer.");
if (!appJs.includes("function persistCurrentState()")) fail("src/app.js is missing persistCurrentState helper.");
if (!appJs.includes("MINI4WD_BUILD_META")) fail("src/app.js is not wired to centralized build metadata.");
if (!appJs.includes("isPublicViewerRoute")) fail("src/app.js is missing the public viewer auth guard.");
if (!buildJs.includes("data-build-version")) fail("src/core/build.js must stamp the build version on the document element.");
if (!appJs.includes("__mini4wdCurrentRelease")) fail("src/app.js is missing the current release state object.");
if (!appJs.includes("data-release-version")) fail("src/app.js must stamp the current release version.");
if (!appJs.includes("removedLegacyRuntime")) fail("src/app.js must describe removed legacy runtime in the current release state.");
if (!appJs.includes("settings-checkline-v182")) fail("src/app.js is missing the v182 settings checkbox class.");
if (!appJs.includes("__publicLiveWatchFallbackTimer")) fail("src/app.js is missing the public live fallback timer guard.");
if (!appJs.includes("currentPublicLiveWatchMatchesRoute()")) fail("src/app.js must guard public LIVE fallback/callbacks against stale hash routes.");
if (!appJs.includes("connectLatestPublicLiveV267") || !appJs.includes("findLatestPublicLiveEntryV267")) fail("src/app.js is missing the v267 latest public LIVE auto-connect path.");
if (!appJs.includes("syncLiveForViewerOpenV267") || !appJs.includes("live-button-open-v267")) fail("src/app.js is missing the v267 operator LIVE button direct viewer sync path.");
if (!appJs.includes("__publicLiveWatchPollTimerV268") || !appJs.includes("PUBLIC_LIVE_WATCH_POLL_MS_V268") || !appJs.includes("pollLivePayloadV268")) fail("src/app.js is missing the v268 public LIVE polling refresh fallback.");
if (!appJs.includes("syncOperatorLiveStateV269") || !appJs.includes("publishLiveStateFallbackV269") || !appJs.includes("scheduleOperatorRenderLiveSyncV269")) fail("src/app.js is missing the v269 operator LIVE stale-state publish fallback.");
if (!appJs.includes("ensureWritableLeaseForBackgroundSyncV270") || !appJs.includes("__mini4wdCanPublishLiveNowV270") || !appJs.includes("isBackgroundLiveSyncReasonV270")) fail("src/app.js is missing the v270 operator lease retry guard for background LIVE sync.");
if (!appJs.includes("makeCrowSemiSlot") || !appJs.includes("sourcePlayerId") || !appJs.includes('syncOperatorLiveStateV269("createFinalRace")') || !appJs.includes('syncOperatorLiveStateV269("toggleFinalWinner")') || !appJs.includes("createCrowSemiFinal|createCrowFinalFromSemi|toggleFinalWinner")) fail("src/app.js is missing the v271 final LIVE sync and 9강 slot-id guard.");
if (!appJs.includes("writeFreshLiveValueV272") || !appJs.includes("shouldAcceptFreshLiveValueV272") || !appJs.includes("scheduleSettledLiveSyncV272") || !appJs.includes("-settle-v272-") || !appJs.includes('scheduleSettledLiveSyncV272("confirmRoundFinalist")')) fail("src/app.js is missing the v272 fresh LIVE write guard and settled point-final sync.");
if (!appJs.includes("lane: player.lane || null")) fail("src/app.js must sanitize public finalist lane values so Firebase publicLive writes never contain undefined.");
if (!appJs.includes("participantInputTextV274") || !appJs.includes("stabilizeParticipantInputV274") || !appJs.includes("participantTextFromRoundsV274") || !appJs.includes("function parseParticipants(text = participantInputTextV274())") || !appJs.includes("inputText,")) fail("src/app.js is missing the v274 refresh-stable participant input path.");
if (!matchSimulationQa.includes("points3 legacy refresh changed participant names") || !matchSimulationQa.includes("points3 running refresh allowed unlocked participant input")) fail("tools/qa-match-simulation.cjs must guard points3 participant stability across refresh restore.");
if (!appJs.includes("confirmNoFinalistV275") || !appJs.includes("isRoundNoFinalistV275") || !appJs.includes("showFinalRaceUnavailableV275") || !appJs.includes("showCrowSemiUnavailableV275") || !appJs.includes("noFinalistReason")) fail("src/app.js is missing the v275 no-finalist round flow.");
if (!operatorQa.includes("point-final-no-finalist-v275") || !operatorQa.includes("final-race-no-finalist-v275") || !operatorQa.includes("crow-no-finalist-v275")) fail("tools/qa-operator-flow.cjs must guard the v275 no-finalist round flow.");
if (!appJs.includes("getForcedGroupCountForStageV276") || !operatorQa.includes("forced-group-first-stage-v276")) fail("src/app.js and tools/qa-operator-flow.cjs must guard the v276 first-stage forced group count flow.");
if (!operatorQa.includes("public-payload-privacy") || !appJs.includes("cleanPointSummary") || appJs.includes("return { ...stage, groups:")) fail("v277 public LIVE payload privacy allowlist or regression guard is missing.");
if (!operatorQa.includes("h2hNamesSanitized") || !appJs.includes("item?.opponent ? publicDisplayName(item.opponent)")) fail("v278 public LIVE head-to-head names must follow the public nickname policy.");
if (!operatorQa.includes("remote-auto-close-privacy-v278") || !appJs.includes("const publicState = makePublicStatePayload(nextState)") || !appJs.includes("state: publicState")) fail("v278 remote auto-close must publish only the public LIVE DTO.");
if (!operatorQa.includes("freshTournamentNotClosed") || !operatorQa.includes("freshnessRejectedAndRolledBack") || !operatorQa.includes("pendingRegistryPreservedBeforeRepair") || !operatorQa.includes("autoCloseRollbackRegistryRestored") || !operatorQa.includes("registryConflictConverged") || !operatorQa.includes("autoCloseRegistryConflictConverged") || !operatorQa.includes("doubleFailureSelfHealed") || !operatorQa.includes("finalizeFailureSelfHealed") || !operatorQa.includes("parentTimestampNotClosed") || !operatorQa.includes("concurrentPublisherLeaseHeld") || !operatorQa.includes("autoCloseHistoryPublished") || !appJs.includes("currentLastAt") || !appJs.includes("recordRef.transaction") || !appJs.includes("autoClosePublishPending") || !appJs.includes("ensureActiveRegistryForRunningV278") || !appJs.includes("retireSupersededPublicRunningV278") || !appJs.includes("AUTO_CLOSE_PUBLISH_LEASE_MS_V278") || !appJs.includes("remoteAutoCloseFinalizeCompleteV278")) fail("v278 remote auto-close must reject stale-list/freshness races, honor parent timestamps, preserve and reconcile the active registry, publish history only after terminal acceptance, lease publication, and self-heal write/finalize failures transactionally.");
if (!operatorQa.includes("current-auto-close-exact-lease-release-v278") || !operatorQa.includes("currentAutoCloseExactLeaseReleaseV278") || !appJs.includes('await window.releaseOperationLeaseV178(false, venueId, {')) fail("v278 current-tab auto-close must release its exact operation lease immediately after terminal sync.");
if (!operatorQa.includes("finish-sync-failure-v278") || !operatorQa.includes("recoveredLiveIdPreserved") || !operatorQa.includes("privatePendingWrittenBeforePublic") || !operatorQa.includes("remotePrivatePendingAfterFailure") || !operatorQa.includes("remoteScanRecoveredPendingFinish") || !operatorQa.includes("finishPendingHonorsNewerRunning") || !operatorQa.includes("renderAutosaveHonorsNewerRunning") || !operatorQa.includes("pendingCancelHidden") || !operatorQa.includes("pendingPublicFallbackBlocked") || !operatorQa.includes("staleLocalRetryHonorsNewerRunning") || !appJs.includes("syncFinishedTournamentStateV278") || !appJs.includes("syncFinishedTournamentAndAdvanceV278") || !appJs.includes("repairRemoteFinishedSyncV278") || !appJs.includes("rollbackRemoteFinishedSyncV278") || !appJs.includes("recoverRemotePendingFinishesV278") || !appJs.includes("reconcileLocalRunningFinishConflictV278") || !appJs.includes("forcePublishPublicLiveV50") || !appJs.includes("private-first-v278") || !appJs.includes("finishSyncTerminalUpdatedAt") || !appJs.includes("v104FinishSyncPending") || !appJs.includes("terminal-sync-pending") || !appJs.includes("finishSyncPending") || !appJs.includes("pending-first-v278") || !appJs.includes("terminalLiveId")) fail("v278 tournament finish must preserve recovered LIVE IDs, write a durable pending marker before public sync, recover it in foreground/background from another session, keep the active registry during reconciliation, block generic and v104 autosave, force fallbacks through private-first order, honor newer running state including stale local retries, and stop draft rollover until retry succeeds.");
if (!appJs.includes("writeFreshTournamentStateV278") || !appJs.includes("tournamentRecordWithStateV278") || !operatorQa.includes("legacy flat record") || !operatorQa.includes("completedTerminalGenericSyncBlocked")) fail("v278 private LIVE writes must be root-shape-aware and terminal states must never re-enter generic remote autosave.");
if (!appJs.includes("mergeNewerPublicRunningStateV278") || !appJs.includes("ensurePublicParticipantAliasesV278") || !appJs.includes("publicParticipantAliases") || !operatorQa.includes("participantSetChangeIdsStable") || !operatorQa.includes("autoCloseRollbackMergedNewerProgress") || !operatorQa.includes("finishRollbackMergedNewerProgress") || !operatorQa.includes("slots.reverse()")) fail("v278 freshness rollback must use durable opaque public participant aliases and rehydrate reordered or expanded newer progression without losing private identity.");
if (!appJs.includes("publishFinishedTournamentRecordV278") || !operatorQa.includes("noHistoryBeforeTerminalPublic") || !operatorQa.includes("staleTerminalCreatedNoFalseHistory")) fail("v278 result history must publish only after terminal LIVE acceptance and must not survive a stale finish rejection.");
if (!appJs.includes("buildUniqueTournamentIdV278") || !appJs.includes("activeRegistryGeneration") || !appJs.includes("explicitLiveId") || !operatorQa.includes("generationConflictProtected") || !operatorQa.includes("oldGenerationReleasePreservedNewClaim") || !operatorQa.includes("activeCleanupRacePreservedNewClaim") || !operatorQa.includes("forceEndUniqueIdClosedExactRemote")) fail("v278 tournament instances, unique LIVE IDs, force-end, and active-registry cleanup/release must remain generation-safe under same-ID races.");
if (!appJs.includes("startTournamentInFlightV278") || !appJs.includes("runStartTournamentV278") || !appJs.includes("draftStillMatchesStartSnapshot") || !appJs.includes("ACTIVE_REGISTRY_START_GRACE_MS_V278") || !appJs.includes("post-reservation lease target verification failed") || !appJs.includes('label: "대회 시작", onClick: "startTournament()"') || !matchSimulationQa.includes("startTournamentAsync()")) fail("v278 tournament start must be single-flight, freeze and recheck its validated draft/venue, reserve an exact generation-safe lease, protect fresh active claims, and expose no direct draft round-start bypass.");
if (!appJs.includes("V278_PENDING_MUTATION_KEY") || !appJs.includes("v278MarkPendingLiveMutation") || !appJs.includes("v278RecordPublicAck") || !appJs.includes("OPERATOR_SESSION_RESUME_STORAGE_KEY_V278") || !appJs.includes("pendingClaimToken") || !appJs.includes("preflightDeferred") || !operatorQa.includes("reload-pending-mutation-v278") || !operatorQa.includes("pendingCreated") || !operatorQa.includes("pendingCleared")) fail("v278 unsynced running mutations must survive a real reload through an exact-predecessor WAL replay and a serialized reserve/fence/finalize lease claim.");
if (!appJs.includes("retireDivergentTerminalPendingV278") || !appJs.includes("retireLocalDivergentFinishPendingV278") || !appJs.includes("isExactRetiredFinishConflictV278") || !appJs.includes("retryingExistingPending") || !appJs.includes("terminalSyncConflictV278") || !operatorQa.includes("divergentTerminalConflictsRetired") || !operatorQa.includes("local-terminal-conflict-convergence-v278") || !operatorQa.includes("directConvergedWithoutFalseHistory") || !operatorQa.includes("retiredRetryConvergedWithoutRepending") || !operatorQa.includes("manualRolloverSkippedConflictHistory")) fail("v278 divergent terminal attempts must converge locally/remotely, stop retrying, skip false history, and release only the retired attempt's ownership.");
if (!appJs.includes('releaseOperationLeaseV178(false, finishedVenueId') || !appJs.includes("finishedRegistryGeneration") || !appJs.includes("releaseClaimedOperationLeaseExactV278") || (appJs.match(/releaseClaimedOperationLeaseExactV278\(/g) || []).length < 10 || !operatorQa.includes("staleCleanupPreservedNewExactLease") || !matchSimulationQa.includes("guarded v278 flow")) fail("v278 finish and stale post-claim cleanup must release only their exact venue/id/generation lease so a newer same-tab claim survives and the next guarded tournament can start.");
if (!appJs.includes("normalizeOptionalKeyV278") || !appJs.includes("const rawPinnedVenueId") || !operatorQa.includes("optional-key-fallback-v278") || !operatorQa.includes("freshAdminDraftUsesVenueName") || !operatorQa.includes("legacyRunningBlankIdAvoidsDefault") || !operatorQa.includes("legacyTerminalBlankIdAvoidsDefault") || !operatorQa.includes("malformedVenueRejectedBeforeDefaultRegistry")) fail("v278 optional venue/LIVE IDs must preserve blank as blank, fall back to real venue/canonical IDs, and reject malformed missing-venue remotes before the default sentinel path.");
if (!appJs.includes("__mini4wdMarkSemanticLiveMutationV278") || !appJs.includes("semanticReason") || !appJs.includes("function emergencyAddParticipant") || !appJs.includes("function emergencyWithdrawParticipant") || !appJs.includes("function forceStageLane") || !appJs.includes("function forceFinalLane")) fail("v278 semantic operator mutations must enter the reload-safe live WAL and remain protected by the operation lease.");
if (!appJs.includes("snapshot-safe-v278") || !appJs.includes("operator-revert-v278") || !appJs.includes("sameRunningInstance") || !appJs.includes("serverHasGeneration") || !appJs.includes("return false;\n    }\n\n    function shouldAcceptFreshLiveValueV272") || !operatorQa.includes("snapshotRestoreCannotReviveTerminal") || !operatorQa.includes("operatorUndoCannotReviveTerminal") || !operatorQa.includes("snapshotRestoreRejectsLegacyGenerationMix") || !operatorQa.includes("snapshotRestoreClaimsExactVenue")) fail("v278 snapshot/undo restore must verify the exact remote private/public/registry generation and venue, reject mixed legacy generations, and never resurrect a terminal tournament.");
if (appJs.includes('onclick="reopenTournament()')) fail("v278 must not expose local-only reopen controls for terminal states.");
if (!appJs.includes('data-app-action="delete-admin-tournament-record"') || !appJs.includes('data-app-action="open-live-viewer"') || !adminQa.includes("delegated-xss-actions")) fail("v277 delegated untrusted-ID action guards are missing.");
if (appJs.includes('onclick="deleteAdminTournamentRecord(\'') || appJs.includes('onclick="openLiveViewerV89(\'')) fail("untrusted record/LIVE IDs must not return to inline JavaScript handlers.");
if (!adminQa.includes("remove-failure-not-success-v278") || !appJs.includes("async function deleteAdminTournamentRecord") || appJs.includes(".remove().catch(() => {})")) fail("v278 admin record deletion must surface Firebase remove failures without reporting success.");
if (!resultMatrixQa.includes("fresh-write-failure") || !appJs.includes("Firebase transaction was not committed")) fail("v277 Firebase write failures must reject and remain covered by QA.");
if (!resultMatrixQa.includes("snapshot-access-and-cap-v278") || !appJs.includes("snapshots[key] = snapshot") || !appJs.includes("Object.values(loadSnapshotMap())") || !appJs.includes("LOCAL_SNAPSHOT_MAX_ENTRIES_V278") || !appJs.includes("snapshotDisplayTextV278")) fail("v278 cross-tournament snapshot access and bounded retention guard is missing.");
if (!operatorMobileCss.includes("v277: mobile operator focus remains visible") || !operatorMobileCss.includes("button:focus-visible") || !operatorMobileCss.includes("forced-colors: active")) fail("v277 mobile operator focus visibility guard is missing.");
if (!appCss.includes("v271: final mobile alignment contract")) fail("src/styles/app.css is missing the v271 mobile alignment contract.");
if (!operatorMobileCss.includes("v271: final dock geometry")) fail("src/styles/operator-mobile.css is missing the v271 final dock geometry layer.");
if (!operatorQa.includes("liveConnectV267") || !operatorQa.includes("notifyFirebaseListeners") || !operatorQa.includes("pollUpdated") || !operatorQa.includes("liveRoundFallbackV269") || !operatorQa.includes("liveLeaseRetryV270")) fail("tools/qa-operator-flow.cjs must verify public LIVE realtime, polling, operator fallback, and lease retry refresh.");
if (!appJs.includes("operatorOpsAreaV183")) fail("src/app.js is missing the v183 operator ops dock target.");
if (!appJs.includes("scrollOperatorSectionV147('operatorOpsAreaV183')")) fail("src/app.js must route the mobile dock operations button to the operator ops section.");
if (!appJs.includes("renderOperatorMobileDockV226") || !appJs.includes("ui-workspace-v224")) fail("src/app.js is missing the operator UI foundation DOM.");
if (!appJs.includes("operator-mobile-top-route-v233") || !appJs.includes("operator-mobile-dock-v233") || !appJs.includes("openDbPage()") || !appJs.includes("openDashboardPage()") || !appJs.includes("openLiveLobbyPage()")) fail("src/app.js is missing the v233 mobile operator top route navigation.");
if (appJs.includes("operator-mobile-route-v232")) fail("src/app.js must not put route navigation back into the fixed mobile operator dock.");
if (!appJs.includes("renderOperatorControlConsoleV226") || !appJs.includes("operator-control-console-v226") || !appJs.includes("operator-round-rail-v226")) fail("src/app.js is missing the v226 operator frame DOM.");
if (!appJs.includes("operator-current-task-v227") || !appJs.includes("operator-stage-board-v227") || !appJs.includes("operator-side-panel-v227")) fail("src/app.js is missing the v227 operator lower workflow DOM.");
if (!appJs.includes("isConfirmableRoundFinalStageV228") || !appJs.includes("operator-feedback-v228")) fail("src/app.js is missing the v228 finalist action feedback DOM.");
if (!appJs.includes("logTournamentAction(\"진출자 변경\"") || !appJs.includes("saveLiveState();")) fail("src/app.js is missing the v229 advance selection save path.");
if (!appJs.includes("renderOperatorSubheadV230") || !appJs.includes("operator-unified-section-v230") || !appJs.includes("operator-tool-primary-row-v230")) fail("src/app.js is missing the v230 operator side panel DOM.");
if (!appJs.includes("operator-static-panel-v236")) fail("src/app.js is missing the v236 always-visible operator side panel DOM.");
if (!appJs.includes("firebaseStatusSummaryV231")) fail("src/app.js is missing the v231 UI copy cleanup helper.");
[
  "LIVE ID",
  "경기별 자동 고유값",
  "EMPTY SLOT",
  "LIVE WAITING",
  "RECENT RESULT",
  "운영 안정화",
  "도구 · 안정화",
  "운영 도구",
  "사용설명서",
  "기록 내려받기",
  "도움말",
  "선수 DB"
].forEach(copy => {
  if (appJs.includes(copy)) fail(`src/app.js still contains removed v231 UI copy: ${copy}`);
});
if (!appJs.includes("admin-overview-v186")) fail("src/app.js is missing the v186 admin overview surface.");
if (!appJs.includes("isRoundFinalResultStageV187")) fail("src/app.js is missing the v187 final-stage result guard.");
if (!appJs.includes("getQualifierStageResultV187")) fail("src/app.js is missing the v187 qualifier result classifier.");
if (!appJs.includes("getPointTieBreakStageResultV188")) fail("src/app.js is missing the v188 point tie-break result classifier.");
if (!appJs.includes("isLowScorePointRecordV188")) fail("src/app.js is missing the v188 low-score point record detector.");
if (!appJs.includes("isRankWinnerResultV188")) fail("src/app.js is missing the v188 rank winner dashboard detector.");
if (!appJs.includes("isLegacyLowScorePointRecordV189")) fail("src/app.js is missing the v189 legacy points5 low-score detector.");
if (!appJs.includes("[...privateLogs, ...publicHistory, ...local]")) fail("src/app.js must prefer Firebase dashboard records before stale local logs.");
if (!appJs.includes("isCountableWinResultV192")) fail("src/app.js is missing the v192 countable win result helper.");
if (appJs.includes('["진출", "최종결승진출", "최종우승", "결승진출"]') || appJs.includes('["진출", "결승진출", "최종결승진출", "최종우승"]')) fail("src/app.js must not count plain 진출 rows as wins.");
if (!resultMatrixQa.includes("runBasicCase") || !resultMatrixQa.includes("runPoints3Case") || !resultMatrixQa.includes("runPoints5TreeCase") || !resultMatrixQa.includes("runRevivalCase") || !resultMatrixQa.includes("runCrowCase")) fail("tools/qa-result-matrix.cjs must cover every tournament result mode.");
if (!resultMatrixQa.includes("runLegacyUnmarkedPoints5Case")) fail("tools/qa-result-matrix.cjs must cover unmarked legacy points5 records.");
if (!resultMatrixQa.includes("runPlainAdvanceDoesNotCountCase")) fail("tools/qa-result-matrix.cjs must cover plain 진출 rows not counting as wins.");
if (!matchSimulationQa.includes('const modes = ["basic", "points3", "points5Tree", "revival", "crow"]') || !matchSimulationQa.includes("createRevivalStage(0)") || !matchSimulationQa.includes("createCrowFinalFromSemi()") || !matchSimulationQa.includes("finishStandardFinal")) fail("tools/qa-match-simulation.cjs must run full actual-match simulations for every tournament mode.");
if (!matchSimulationQa.includes("points3 stale publicLive write regressed to round 1") || !matchSimulationQa.includes("points3 stale remote state write regressed to round 1")) fail("tools/qa-match-simulation.cjs must guard stale v272 LIVE writes after points3 finalist advancement.");
if (appJs.includes('isFinalist ? "최종결승진출" : isAdvanced')) fail("src/app.js must not classify every round-finalist appearance as 최종결승진출.");
if (appJs.includes('openLiveLobbyPage()">LIVE</button>')) fail("src/app.js must not put the LIVE shortcut back in the mobile operator dock.");
if (!appJs.includes("operationLocks/leases/{venueId}")) fail("src/app.js is missing the v178 operation lease path marker.");
if (!appJs.includes("operationLocks/sessions/{venueId}/{uid}/{sessionId}")) fail("src/app.js is missing the v178 operator session path marker.");
if (!appJs.includes("ACTION_LOG_MAX_PER_TOURNAMENT")) fail("src/app.js is missing action log pruning limits.");
if (!appJs.includes("DASHBOARD_PUBLIC_HISTORY_LIMIT")) fail("src/app.js is missing dashboard public history query limits.");
if (!appJs.includes('view === "live-list" || view === "live-lobby" || view === "lobby"')) fail("src/app.js must route live-lobby as a public lobby alias.");
if (appJs.includes("publicLive.state = privateState")) fail("src/app.js must not publish private state through publicLive.");
if (appJs.includes("state: privateState")) fail("src/app.js must not embed private state in publicLive metadata.");
if (!appJs.includes("makePublicLivePayload(privateState)")) fail("src/app.js must build public live payloads through the sanitizer.");
if (!databaseRules.includes("\".indexOn\": [\"updatedAt\", \"status\", \"venueId\"]")) fail("database.rules.json is missing publicLive indexes.");
if (!databaseRules.includes("\".indexOn\": [\"createdAt\", \"endedAtISO\", \"venueId\"]")) fail("database.rules.json is missing publicHistory indexes.");
if (!databaseRules.includes("\".indexOn\": [\"createdAt\"]")) fail("database.rules.json is missing createdAt indexes for bounded queries.");
if (appJs.includes("function boot()")) fail("src/app.js must not reintroduce the legacy boot() router.");
if (appJs.includes("installV123DeviceSplitPatch")) fail("src/app.js must not reintroduce the obsolete v123 render wrapper.");
[
  "function runV77CleanupAudit",
  "function runCommercialSelfAuditV58",
  "function runProductionAuditV85",
  "function runFinalPracticeAuditV95",
  "runV102HotfixAudit",
  "function shouldRunStartupAuditsV152",
  "function runMini4wdAuditsV152",
  "function stopLiveSession",
  "function resumeLiveSession",
  "function makeSnapshotUrl",
  "function makeLiveTvUrl",
  "function openTvView",
  "function copyOrShare",
  "function copyText",
  "function syncLiveNow",
  "function resetTournament",
  "function refreshInput",
  "function rowMatchesMetricPlayer",
  "function setTournamentIdDraft",
  "function setTournamentId",
  "function loadFirebaseStateOnce",
  "function encodePayload",
  "function renderTvLiveView",
  "function renderReadOnlyPayload",
  "function renderTvPlayerCore",
  "function renderTvH2hMetrics",
  "function renderTvLaneLabel",
  "function getTvDisplayNickname",
  "function getTvPlayerNameFitClass",
  "function archiveTournament",
  "function copyLiveLink",
  "function shareMobileView",
  "function openFirebaseTvLive",
  "function exportRosterJson",
  "function quickImportRosterLines",
  "function importRosterJsonFromText",
  "v102WrapAction",
  "installV102MobileTvLiveSyncHotfix",
  "syncLiveNowV102",
  "syncLiveNowV104",
  "mini4wdTournamentLastSafeStateV102",
  "__mini4wdV102UnloadFlushWrapped",
  "watchFirebaseStateV102",
  "__mini4wdLegacyBuildHistory",
  "__mini4wdV163LegacyCleanup",
  "__mini4wdV164DatabaseOptimization",
  "__mini4wdV170LiveSyncLatency",
  "__mini4wdV171LiveRouteRefresh",
  "__mini4wdV173MobileSurfaceUnification",
  "__mini4wdV175LiveResultVisibility",
  "__mini4wdV176UiFoundationPass",
  "__mini4wdV177AdminMobileListPolish",
  "__mini4wdV178OperatorSessionLease",
  "__mini4wdV179LegacyPatchCleanup",
  "__mini4wdV181LegacyRuntimeTrim",
  "__mini4wdV182CheckboxSizeFix",
  "__mini4wdV183MobileDockOpsNav",
  "__mini4wdV184LiveRouteFallbackGuard",
  "__mini4wdV122PerformancePatch",
  "__mini4wdV124DeviceUiAuditPatch",
  "__mini4wdV135ActiveBackupAutoClosePatch",
  "__mini4wdV104PerformancePatch",
  "__publicLiveWatchFallbackV184",
  "currentPublicLiveWatchMatchesV184",
  "isPublicViewerRouteV163"
].forEach(marker => {
  if (appJs.includes(marker)) fail(`src/app.js must not reintroduce obsolete runtime audit/dead wrapper: ${marker}.`);
});
if (appCss.includes("live-lobby-shell-v88") || appCss.includes("live-lobby-v87")) fail("src/styles/app.css must not reintroduce obsolete v87/v88 live lobby blocks.");
if (appCss.includes("v163: legacy CSS cleanup") || appCss.includes("v179: legacy patch cleanup marker")) fail("src/styles/app.css must not reintroduce obsolete legacy cleanup marker comments.");
if (appCss.includes("v193: tighter admin mobile action rows")) fail("src/styles/app.css must keep admin mobile density integrated into v191 instead of adding a v193 override block.");
if (!appCss.includes("v195: unused versioned CSS cleanup")) fail("src/styles/app.css is missing the v195 unused CSS cleanup marker.");
if (!appCss.includes("v196: tournament prep action layer flattened")) fail("src/styles/app.css is missing the v196 prep action layer marker.");
if (!appCss.includes("v197: session lease header keeps text and actions in separate rows")) fail("src/styles/app.css is missing the v197 session lease layout marker.");
if (!appCss.includes("v209: admin account permission toggles use fixed chip sizing across PC/mobile")) fail("src/styles/app.css is missing the v209 admin toggle sizing marker.");
if (!appCss.includes("v199: match records keep source labels out of rows and stay single-line")) fail("src/styles/app.css is missing the v199 admin match row marker.");
if (!appCss.includes("v200: shared page shells keep the same top rhythm as the operator header")) fail("src/styles/app.css is missing the v200 header top alignment marker.");
if (!appCss.includes("v201: DB mobile primary actions stay compact inside the v191 mobile table layer")) fail("src/styles/app.css is missing the v201 DB primary action density marker.");
if (!appCss.includes("v202: player DB command bar groups navigation, file actions, and account state")) fail("src/styles/app.css is missing the v202 DB toolbar group marker.");
if (!appCss.includes("v203: player DB roster table fits desktop without horizontal scroll and keeps star controls inside cells")) fail("src/styles/app.css is missing the v203 DB roster fit marker.");
[
  "live-lobby-card-v88",
  "live-lobby-card-v89",
  "live-eyebrow-v89",
  "live-header-actions-v89",
  "live-lobby-v89",
  "prep-hero-v115",
  "prep-title-v115",
  "prep-sub-v115",
  "prep-action-v115",
  "prep-meta-grid-v115",
  "prep-preview-main-v116",
  "prep-title-v116",
  "prep-sub-v116",
  "db-batch-add-card-v119",
  "db-actions-toolbar-v121",
  "db-batch-add-card-v121",
  "db-venue-line-v131",
  "db-top-actions-v131",
  "group-size-control-v133",
  "group-size-control-v136",
  "group-size-control-v138",
  "group-size-label-v138",
  "group-size-buttons-v138",
  "group-size-button-v138",
  "group-size-control-v143",
  "group-size-label-v143",
  "group-size-buttons-v143",
  "group-size-button-v143",
  "prep-summary-copy-v143",
  "mobile-point-score-v145",
  "mobile-operator-layout",
  "mobile-section-stack",
  "mobile-section-card",
  "quick-step-panel",
  "slot-player-line",
  "team-inline",
  "tv-team-inline",
  "tv-h2h-inline",
  "tv-lane-no-main",
  "page-link",
  "section-label",
  "firebase-autosave",
  "needs-contact",
  "identity-note",
  "current-page-action"
].forEach(cls => {
  if (appCss.includes(cls)) fail(`src/styles/app.css must not reintroduce obsolete unused CSS class: ${cls}.`);
});
[
  "prep-preview-v116",
  "prep-summary-v143"
].forEach(cls => {
  if (appJs.includes(cls) || appCss.includes(cls)) fail(`Tournament prep actions must not reintroduce the obsolete wrapper layer class: ${cls}.`);
});
if (appJs.includes("admin-actions-v186")) fail("Admin account management buttons must stay merged into permission-toggle-v204 chips.");
if (!appJs.includes("permission-toggle-v204")) fail("Admin account permissions must render clickable permission-toggle-v204 chips.");
if (!appJs.includes("admin-account-main-v205")) fail("Admin account rows must render venue above account inside admin-account-main-v205.");
if (appJs.includes("renderDashboardToolbarV146")) fail("Dashboard must not reintroduce the retired renderDashboardToolbarV146 layer.");
if (appCss.includes("dashboard-toolbar-v146")) fail("Dashboard must not reintroduce retired dashboard-toolbar-v146 CSS.");
if (!appJs.includes("dashboard-account-strip-v207")) fail("Dashboard account strip must render through dashboard-account-strip-v207.");
if (!appCss.includes("dashboard-account-strip-v207")) fail("Dashboard account strip styles must exist in src/styles/app.css.");
if (appCss.includes("admin-toolbar-spacer-v145")) fail("Admin toolbar spacer CSS must stay removed; use the current toolbar grid/flex layout.");
if (appCss.includes("admin-venue-chip-v186")) fail("Admin venue chip CSS must stay removed; venue text now renders through admin-account-venue-v205.");
[
  "html body.surface-admin-accounts:not(.tv-mode) .admin-table-v177 td::before",
  "html body.surface-admin-accounts:not(.tv-mode) .admin-table-v177 tbody {\n    display: grid",
  "html body.surface-admin-accounts.ui-page-admin:not(.tv-mode) .admin-light-page table.admin-table.admin-table-v177 thead {\n    display: none"
].forEach(pattern => {
  if (appCssLf.includes(pattern)) fail("src/styles/app.css must not reintroduce the old admin mobile card table conversion.");
});
if (fs.existsSync(path.join(root, "mini4wd_v149_surface_specific_ui_system_patch.zip"))) fail("Do not keep obsolete patch ZIP artifacts in the deploy root.");
if (!configJs.includes("const FIREBASE_CONFIG")) fail("src/core/config.js is missing FIREBASE_CONFIG.");

const expectedSurfaces = Array.isArray(buildMeta.surfaces) ? buildMeta.surfaces : [];
if (!expectedSurfaces.length) fail("src/core/build.js must define expected surfaces.");
if (!appJs.includes("MINI4WD_SURFACE_CLASSES")) fail("src/app.js must build surface classes from centralized metadata.");

expectedSurfaces.forEach(surface => {
  if (!appCss.includes(`surface-${surface}`)) fail(`src/styles/app.css is missing surface styles: ${surface}.`);
});

const expectedSurfaceHooks = Array.isArray(buildMeta.rendererSurfaceHooks)
  ? buildMeta.rendererSurfaceHooks.map(([name, surface]) => [name, `setUiSurfaceV149("${surface}")`])
  : [];
if (!expectedSurfaceHooks.length) fail("src/core/build.js must define renderer surface hooks.");

expectedSurfaceHooks.forEach(([name, hook]) => {
  if (!appJs.includes(`function ${name}`)) fail(`src/app.js is missing renderer: ${name}.`);
  if (!appJs.includes(hook)) fail(`src/app.js is missing surface hook for ${name}: ${hook}.`);
});

if (errors.length) {
  console.error("Static verification failed:");
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log("Static verification passed.");
