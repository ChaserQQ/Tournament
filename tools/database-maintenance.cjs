#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ACTION_LOG_LIMIT = 120;
const DEFAULT_PUBLIC_LIVE_TTL_DAYS = 14;

function usage() {
  console.log([
    "Usage:",
    "  node tools/database-maintenance.cjs audit --input <rtdb-export.json>",
    "  node tools/database-maintenance.cjs plan --input <rtdb-export.json> --output <patch.json>",
    "",
    "Options:",
    "  --action-log-limit <n>       Default: 120 per venue/tournament",
    "  --public-live-ttl-days <n>   Default: 14 for stale non-running publicLive cleanup",
    "  --include-stale-live-deletes Include stale non-running publicLive deletions in the patch",
    "  --now <yyyy-mm-dd>           Override current date for deterministic planning"
  ].join("\n"));
}

function parseArgs(argv) {
  const args = { command: argv[2] || "" };
  for (let i = 3; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function resolveFile(file) {
  if (!file) throw new Error("Missing --input");
  return path.resolve(process.cwd(), String(file));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value == null ? null : value), "utf8");
}

function childCount(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function toTimeValue(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function topLevelSummary(data) {
  return Object.keys(data || {}).map(key => ({
    key,
    children: childCount(data[key]),
    bytes: jsonBytes(data[key])
  })).sort((a, b) => b.bytes - a.bytes);
}

function getLiveUpdatedAt(item) {
  return toTimeValue(item?.updatedAt || item?.state?.updatedAt || item?.state?.tournament?.updatedAt);
}

function normalizeActionLogRows(actionLogs = {}) {
  const rows = [];
  Object.entries(actionLogs || {}).forEach(([venueId, tournaments]) => {
    Object.entries(tournaments || {}).forEach(([tournamentId, logs]) => {
      const entries = Object.entries(logs || {}).map(([key, value]) => ({
        key,
        createdAt: value?.createdAt || "",
        bytes: jsonBytes(value)
      }));
      entries.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
      rows.push({
        venueId,
        tournamentId,
        count: entries.length,
        bytes: jsonBytes(logs || {}),
        first: entries[0]?.createdAt || "",
        last: entries[entries.length - 1]?.createdAt || "",
        entries
      });
    });
  });
  return rows.sort((a, b) => b.bytes - a.bytes);
}

function sanitizePublicState(sourceState = {}) {
  let sequence = 0;
  const idMap = new Map();
  const publicId = original => {
    const key = String(original || `empty-${sequence + 1}`);
    if (!idMap.has(key)) idMap.set(key, `pub-${++sequence}`);
    return idMap.get(key);
  };
  const cleanPlayer = player => {
    if (!player) return player;
    if (player.isEmptyLane) {
      return {
        id: `empty-${player.lane || ++sequence}`,
        lane: player.lane || null,
        name: "빈 레인",
        team: "",
        isEmptyLane: true
      };
    }
    const displayName = player.nickname || player.name || player.realName || "참가자";
    const clean = {
      id: publicId(player.id || displayName),
      lane: player.lane || null,
      name: displayName,
      nickname: displayName,
      team: player.team || ""
    };
    if (player.crowRank != null) clean.crowRank = player.crowRank;
    if (player.sourceRoundIndex != null) clean.sourceRoundIndex = player.sourceRoundIndex;
    return clean;
  };
  const cleanGroup = group => {
    const slots = (group?.slots || []).map(cleanPlayer);
    const advanceIds = (group?.advanceIds || []).map(id => idMap.get(String(id)) || publicId(id));
    const points = {};
    Object.entries(group?.points || {}).forEach(([id, value]) => {
      points[idMap.get(String(id)) || publicId(id)] = value;
    });
    return {
      id: group?.id || "",
      name: group?.name || "",
      slots,
      advanceIds,
      points
    };
  };
  const cleanStage = stage => ({
    id: stage?.id || "",
    name: stage?.name || "",
    type: stage?.type || "",
    groups: (stage?.groups || []).map(cleanGroup)
  });
  const cleanRound = round => ({
    id: round?.id || "",
    index: round?.index || 0,
    title: round?.title || "",
    stagePlan: round?.stagePlan || [],
    stages: (round?.stages || []).map(cleanStage),
    finalist: round?.finalist ? cleanPlayer(round.finalist) : null,
    crowFinalists: (round?.crowFinalists || []).map(cleanPlayer)
  });
  const tournament = sourceState.tournament || {};
  const publicTournament = {
    name: tournament.name || "",
    venue: tournament.venue || "",
    venueId: tournament.venueId || "",
    raceClass: tournament.raceClass || "",
    status: tournament.status || "draft",
    startedAtISO: tournament.startedAtISO || "",
    startedAtDisplay: tournament.startedAtDisplay || "",
    endedAtISO: tournament.endedAtISO || "",
    endedAtDisplay: tournament.endedAtDisplay || ""
  };
  const cleanFinalRace = sourceState.finalRace ? {
    id: sourceState.finalRace.id || "",
    name: sourceState.finalRace.name || "",
    type: sourceState.finalRace.type || "",
    groups: (sourceState.finalRace.groups || []).map(cleanGroup),
    group: sourceState.finalRace.group ? cleanGroup(sourceState.finalRace.group) : undefined
  } : null;
  return {
    settings: sourceState.settings ? {
      laneCount: sourceState.settings.laneCount,
      matchMode: sourceState.settings.matchMode
    } : {},
    tournament: publicTournament,
    activeRoundIndex: sourceState.activeRoundIndex || 0,
    broadcast: sourceState.broadcast || { mode: "stage", roundIndex: 0, stageIndex: 0 },
    qualifierRounds: (sourceState.qualifierRounds || []).map(cleanRound),
    finalRace: cleanFinalRace,
    updatedAt: sourceState.updatedAt || Date.now()
  };
}

function buildPlan(data, options = {}) {
  const actionLogLimit = Math.max(1, Number(options.actionLogLimit || DEFAULT_ACTION_LOG_LIMIT));
  const ttlDays = Math.max(1, Number(options.publicLiveTtlDays || DEFAULT_PUBLIC_LIVE_TTL_DAYS));
  const now = options.now ? new Date(options.now) : new Date();
  const nowMs = Number.isNaN(now.getTime()) ? Date.now() : now.getTime();
  const staleBefore = nowMs - (ttlDays * 24 * 60 * 60 * 1000);
  const patch = {};
  const summary = {
    generatedAt: new Date().toISOString(),
    actionLogLimit,
    publicLiveTtlDays: ttlDays,
    publicLiveStateCompactions: 0,
    publicLiveBytesBefore: 0,
    publicLiveBytesAfterEstimate: 0,
    stalePublicLiveCandidates: 0,
    stalePublicLiveDeletes: 0,
    actionLogDeletes: 0,
    actionLogBytesBefore: 0,
    actionLogBytesDeleteEstimate: 0
  };

  Object.entries(data.publicLive || {}).forEach(([id, item]) => {
    const state = item?.state;
    if (state && state.tournament) {
      const clean = sanitizePublicState(state);
      const before = jsonBytes(state);
      const after = jsonBytes(clean);
      summary.publicLiveStateCompactions += 1;
      summary.publicLiveBytesBefore += before;
      summary.publicLiveBytesAfterEstimate += after;
      if (after < before) patch[`publicLive/${id}/state`] = clean;
    }
    const status = item?.status || item?.state?.tournament?.status || "";
    const live = Boolean(item?.live);
    const updatedAt = getLiveUpdatedAt(item);
    if (!live && status !== "running" && updatedAt && updatedAt < staleBefore) {
      summary.stalePublicLiveCandidates += 1;
      if (options.includeStaleLiveDeletes) {
        patch[`publicLive/${id}`] = null;
        summary.stalePublicLiveDeletes += 1;
      }
    }
  });

  normalizeActionLogRows(data.actionLogs || {}).forEach(row => {
    summary.actionLogBytesBefore += row.bytes;
    const overflow = row.entries.length - actionLogLimit;
    if (overflow <= 0) return;
    row.entries.slice(0, overflow).forEach(entry => {
      patch[`actionLogs/${row.venueId}/${row.tournamentId}/${entry.key}`] = null;
      summary.actionLogDeletes += 1;
      summary.actionLogBytesDeleteEstimate += entry.bytes;
    });
  });

  return { summary, patch };
}

function audit(data) {
  const top = topLevelSummary(data);
  const actionRows = normalizeActionLogRows(data.actionLogs || {});
  const liveRows = Object.entries(data.publicLive || {}).map(([id, item]) => ({
    id,
    bytes: jsonBytes(item),
    stateBytes: jsonBytes(item?.state || {}),
    status: item?.status || item?.state?.tournament?.status || "",
    updatedAt: item?.updatedAt || item?.state?.updatedAt || ""
  })).sort((a, b) => b.bytes - a.bytes);
  return {
    topLevel: top,
    largestActionLogs: actionRows.slice(0, 12).map(({ entries, ...row }) => row),
    publicLiveLargest: liveRows.slice(0, 12)
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.command || args.help) {
    usage();
    return;
  }
  const input = resolveFile(args.input);
  const data = readJson(input);
  if (args.command === "audit") {
    console.log(JSON.stringify(audit(data), null, 2));
    return;
  }
  if (args.command === "plan") {
    if (!args.output) throw new Error("Missing --output");
    const plan = buildPlan(data, {
      actionLogLimit: args["action-log-limit"],
      publicLiveTtlDays: args["public-live-ttl-days"],
      includeStaleLiveDeletes: Boolean(args["include-stale-live-deletes"]),
      now: args.now
    });
    writeJson(path.resolve(process.cwd(), String(args.output)), plan.patch);
    console.log(JSON.stringify(plan.summary, null, 2));
    return;
  }
  usage();
  process.exitCode = 2;
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
