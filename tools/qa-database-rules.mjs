#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import { get, ref, remove, runTransaction, set, update } from "firebase/database";

const PROJECT_ID = "demo-mtm-rules";
const EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "127.0.0.1:9000";
const hostMatch = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(EMULATOR_HOST);

if (!PROJECT_ID.startsWith("demo-") || !hostMatch) {
  throw new Error("Rules QA is restricted to a loopback Firebase demo project.");
}

const host = hostMatch[1];
const port = Number(hostMatch[2]);
const rulesPath = fileURLToPath(new URL("../database.rules.json", import.meta.url));
const rules = await readFile(rulesPath, "utf8");

const PROTOCOL = 279;
const VENUE_A = "qa-venue-a";
const VENUE_B = "qa-venue-b";
const VENUE_AUTO = "qa-venue-auto";
const VENUE_LEGACY = "qa-venue-legacy";
const UID_A = "qa-operator-a";
const UID_TAKEOVER = "qa-operator-takeover";
const UID_B = "qa-operator-b";
const UID_AUTO = "qa-operator-auto";
const UID_AUTO_CLEANER = "qa-operator-auto-cleaner";
const UID_LEGACY = "qa-operator-legacy";
const UID_PENDING = "qa-pending";
const UID_BOOTSTRAP_ADMIN = "qa-bootstrap-admin";
const BOOTSTRAP_ADMIN_EMAIL = "chaser.escane@gmail.com";
const EMAILS = {
  [UID_A]: "operator-a@example.test",
  [UID_TAKEOVER]: "operator-takeover@example.test",
  [UID_B]: "operator-b@example.test",
  [UID_AUTO]: "operator-auto@example.test",
  [UID_AUTO_CLEANER]: "operator-auto-cleaner@example.test",
  [UID_LEGACY]: "operator-legacy@example.test",
  [UID_PENDING]: "pending@example.test",
  [UID_BOOTSTRAP_ADMIN]: BOOTSTRAP_ADMIN_EMAIL
};

function venueProfile(uid, venueId) {
  return {
    uid,
    email: EMAILS[uid],
    role: "venue",
    approved: true,
    venueId,
    venueName: venueId,
    permissions: { operate: true, dashboard: true }
  };
}

function makeState({
  id,
  venueId,
  generation,
  fenceToken,
  fenceSequence,
  updatedAt,
  status = "running",
  score = 0,
  endedAtISO = "",
  tournamentPatch = {}
}) {
  return {
    remoteWriteProtocolV279: PROTOCOL,
    inputText: "Racer A/Team A\nRacer B/Team B",
    settings: { laneCount: 3, matchMode: "basic", firebaseAutoSave: status === "running" },
    tournament: {
      remoteWriteProtocolV279: PROTOCOL,
      liveId: id,
      name: `Rules QA ${id}`,
      venue: venueId,
      venueId,
      activeRegistryGeneration: generation,
      liveWriteFenceV278: fenceToken,
      liveWriteFenceSequenceV278: fenceSequence,
      status,
      startedAtISO: "2026-08-22T00:00:00.000Z",
      endedAtISO,
      ...tournamentPatch
    },
    activeRoundIndex: 0,
    broadcast: { mode: "stage", roundIndex: 0, stageIndex: 0 },
    qualifierRounds: [{
      id: "round-1",
      index: 0,
      title: "Round 1",
      stages: [{
        id: "stage-1",
        name: "Stage 1",
        groups: [{ id: "group-1", points: { "racer-a": score } }]
      }]
    }],
    finalRace: null,
    updatedAt
  };
}

function privateEnvelope(state) {
  return {
    protocolVersion: PROTOCOL,
    venueId: state.tournament.venueId,
    registryGeneration: state.tournament.activeRegistryGeneration,
    status: state.tournament.status,
    state,
    updatedAt: state.updatedAt
  };
}

function publicEnvelope(state) {
  return {
    protocolVersion: PROTOCOL,
    id: state.tournament.liveId,
    venueId: state.tournament.venueId,
    venueName: state.tournament.venue,
    registryGeneration: state.tournament.activeRegistryGeneration,
    status: state.tournament.status,
    live: state.tournament.status === "running",
    updatedAt: state.updatedAt,
    state: structuredClone(state)
  };
}

function reserveLease({
  venueId,
  uid,
  sessionId,
  tournamentId,
  generation,
  fenceToken,
  sequence,
  now,
  current = null,
  legacyMigrationV279 = false
}) {
  return {
    ...(current || {
      protocolVersion: PROTOCOL,
      scope: "venue",
      venueId,
      uid,
      sessionId: "",
      claimSequence: 0,
      fenceSequenceHighWater: 0,
      fenceToken: "",
      tournamentId: "",
      registryGeneration: "",
      leaseUntil: 0,
      status: "reserving"
    }),
    protocolVersion: PROTOCOL,
    scope: "venue",
    venueId,
    fenceSequenceHighWater: sequence,
    pendingClaimToken: `pending-${sessionId}-${sequence}`,
    pendingUid: uid,
    pendingSessionId: sessionId,
    pendingSessionLineageId: `lineage-${sessionId}`,
    pendingClaimSequence: sequence,
    pendingFenceToken: fenceToken,
    pendingTournamentId: tournamentId,
    pendingRegistryGeneration: generation,
    pendingVenueId: venueId,
    pendingReason: "rules-qa",
    pendingAt: now,
    updatedAt: now,
    ...(legacyMigrationV279 ? { legacyMigrationV279: true } : {})
  };
}

function finalizeLease({ reservation, uid, sessionId, now }) {
  return {
    protocolVersion: PROTOCOL,
    scope: "venue",
    venueId: reservation.pendingVenueId,
    venueName: reservation.pendingVenueId,
    uid,
    email: EMAILS[uid],
    sessionId,
    sessionLineageId: `lineage-${sessionId}`,
    claimSequence: reservation.pendingClaimSequence,
    fenceSequenceHighWater: reservation.pendingClaimSequence,
    fenceToken: reservation.pendingFenceToken,
    tournamentId: reservation.pendingTournamentId,
    registryGeneration: reservation.pendingRegistryGeneration,
    tournamentName: "Rules QA",
    status: "running",
    reason: "rules-qa-finalize",
    leaseUntil: now + 30_000,
    clientUpdatedAt: now,
    updatedAt: now,
    build: "BUILD v279 RULES QA"
  };
}

function activeEnvelope({ venueId, tournamentId, generation, fenceToken, fenceSequence, uid, updatedAt }) {
  return {
    protocolVersion: PROTOCOL,
    venueId,
    venueName: venueId,
    tournamentId,
    registryGeneration: generation,
    tournamentName: "Rules QA",
    raceClass: "Open",
    status: "running",
    fenceToken,
    fenceSequence,
    uid,
    updatedAt
  };
}

function context(testEnv, uid) {
  return testEnv.authenticatedContext(uid, { email: EMAILS[uid] }).database();
}

const results = [];
const contractFailures = [];
async function qaCase(name, action) {
  await action();
  results.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

async function expectedAllowed(name, action) {
  try {
    await assertSucceeds(action());
    process.stdout.write(`PASS ${name}\n`);
    return true;
  } catch (error) {
    contractFailures.push({ name, error });
    process.stderr.write(`FAIL ${name}: ${error?.code || error?.message || error}\n`);
    return false;
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  database: { host, port, rules }
});

try {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async adminContext => {
    await set(ref(adminContext.database(), "userProfiles"), {
      [UID_A]: venueProfile(UID_A, VENUE_A),
      [UID_TAKEOVER]: venueProfile(UID_TAKEOVER, VENUE_A),
      [UID_B]: venueProfile(UID_B, VENUE_B),
      [UID_AUTO]: venueProfile(UID_AUTO, VENUE_AUTO),
      [UID_AUTO_CLEANER]: venueProfile(UID_AUTO_CLEANER, VENUE_AUTO),
      [UID_LEGACY]: venueProfile(UID_LEGACY, VENUE_LEGACY),
      [UID_PENDING]: {
        uid: UID_PENDING,
        email: EMAILS[UID_PENDING],
        role: "pending",
        approved: false,
        venueId: VENUE_B,
        venueName: VENUE_B,
        permissions: { operate: false, dashboard: false }
      }
    });
  });

  const unauthDb = testEnv.unauthenticatedContext().database();
  const dbA = context(testEnv, UID_A);
  const dbTakeover = context(testEnv, UID_TAKEOVER);
  const dbB = context(testEnv, UID_B);
  const dbAuto = context(testEnv, UID_AUTO);
  const dbAutoCleaner = context(testEnv, UID_AUTO_CLEANER);
  const dbLegacy = context(testEnv, UID_LEGACY);
  const dbPending = context(testEnv, UID_PENDING);
  const dbBootstrapAdmin = context(testEnv, UID_BOOTSTRAP_ADMIN);

  await qaCase("public-read-private-deny", async () => {
    await assertSucceeds(get(ref(unauthDb, "publicLive/missing-public-record")));
    await assertSucceeds(get(ref(unauthDb, "publicHistory/missing-history-record")));
    await assertFails(get(ref(unauthDb, "tournaments/missing-private-record")));
    await assertFails(get(ref(unauthDb, `activeTournaments/${VENUE_A}`)));
    await assertFails(set(ref(unauthDb, "publicLive/unauthorized-write"), { id: "unauthorized-write" }));
  });

  await qaCase("profile-self-escalation-deny", async () => {
    await assertFails(update(ref(dbPending, `userProfiles/${UID_PENDING}`), {
      role: "admin",
      approved: true,
      venueId: "all",
      permissions: { operate: true, dashboard: true }
    }));
    await assertFails(update(ref(dbA, `userProfiles/${UID_A}`), { venueId: VENUE_B }));
    const pendingProfile = (await get(ref(dbPending, `userProfiles/${UID_PENDING}`))).val();
    assert.equal(pendingProfile.role, "pending");
    assert.equal(pendingProfile.approved, false);
  });

  const tournamentId = "qa-rules-main-v279";
  const generation = "generation-main-v279";
  const fence1 = "fence-main-1";
  const fence2 = "fence-main-2";
  const session1 = "session-main-1";
  const session2 = "session-main-2";
  const startAt = Date.now();
  const leasePath = `operationLocks/leases/${VENUE_A}`;
  const activePath = `activeTournaments/${VENUE_A}`;
  const privatePath = `tournaments/${tournamentId}`;
  const publicPath = `publicLive/${tournamentId}`;
  let lease1;
  let active1;
  let scoreState;
  let lease2;
  let active2;
  let takeoverState;
  let finishedState;
  let releasedLease;
  let lease3;
  let cancelledLease;

  await qaCase("reserve-finalize-active-private-public-allow", async () => {
    const reservation1 = reserveLease({
      venueId: VENUE_A,
      uid: UID_A,
      sessionId: session1,
      tournamentId,
      generation,
      fenceToken: fence1,
      sequence: 1,
      now: startAt
    });
    await assertSucceeds(set(ref(dbA, leasePath), reservation1));

    lease1 = finalizeLease({ reservation: reservation1, uid: UID_A, sessionId: session1, now: startAt + 1 });
    await assertSucceeds(set(ref(dbA, leasePath), lease1));

    active1 = activeEnvelope({
      venueId: VENUE_A,
      tournamentId,
      generation,
      fenceToken: fence1,
      fenceSequence: 1,
      uid: UID_A,
      updatedAt: startAt + 2
    });
    await assertSucceeds(set(ref(dbA, activePath), active1));

    const initialState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence1,
      fenceSequence: 1,
      updatedAt: startAt + 3
    });
    await assertSucceeds(set(ref(dbA, privatePath), privateEnvelope(initialState)));
    await assertSucceeds(set(ref(dbA, publicPath), publicEnvelope(initialState)));

    const publicValue = (await get(ref(unauthDb, publicPath))).val();
    await assertFails(get(ref(unauthDb, privatePath)));
    assert.equal(publicValue.registryGeneration, generation);
    assert.equal(publicValue.state.tournament.liveWriteFenceV278, fence1);
  });

  await qaCase("score-update-allow", async () => {
    scoreState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence1,
      fenceSequence: 1,
      updatedAt: startAt + 1_000,
      score: 7
    });
    await assertSucceeds(set(ref(dbA, privatePath), privateEnvelope(scoreState)));
    await assertSucceeds(set(ref(dbA, publicPath), publicEnvelope(scoreState)));
    const stored = (await get(ref(dbA, privatePath))).val();
    assert.equal(stored.state.qualifierRounds[0].stages[0].groups[0].points["racer-a"], 7);
  });

  await qaCase("cross-venue-deny", async () => {
    await assertFails(get(ref(dbB, privatePath)));
    const crossStoreState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence1,
      fenceSequence: 1,
      updatedAt: startAt + 1_100,
      score: 8
    });
    await assertFails(set(ref(dbB, privatePath), privateEnvelope(crossStoreState)));
    await assertFails(set(ref(dbB, leasePath), reserveLease({
      venueId: VENUE_A,
      uid: UID_B,
      sessionId: "session-cross-store",
      tournamentId,
      generation,
      fenceToken: "cross-store-fence",
      sequence: 2,
      now: Date.now(),
      current: lease1
    })));
  });

  await qaCase("takeover-new-fence-allow-old-fence-deny-timestamp-aligned-envelope", async () => {
    const takeoverAt = Date.now();
    const reservation2 = reserveLease({
      venueId: VENUE_A,
      uid: UID_TAKEOVER,
      sessionId: session2,
      tournamentId,
      generation,
      fenceToken: fence2,
      sequence: 2,
      now: takeoverAt,
      current: lease1
    });
    await assertSucceeds(set(ref(dbTakeover, leasePath), reservation2));

    takeoverState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence2,
      fenceSequence: 2,
      updatedAt: startAt + 1_001,
      score: 7
    });
    const timestampMismatchedEnvelope = privateEnvelope(takeoverState);
    timestampMismatchedEnvelope.updatedAt = takeoverState.updatedAt - 1;
    await assertFails(set(ref(dbTakeover, privatePath), timestampMismatchedEnvelope));
    await assertSucceeds(set(ref(dbTakeover, privatePath), privateEnvelope(takeoverState)));

    lease2 = finalizeLease({ reservation: reservation2, uid: UID_TAKEOVER, sessionId: session2, now: takeoverAt + 1 });
    await assertSucceeds(set(ref(dbTakeover, leasePath), lease2));

    active2 = activeEnvelope({
      venueId: VENUE_A,
      tournamentId,
      generation,
      fenceToken: fence2,
      fenceSequence: 2,
      uid: UID_TAKEOVER,
      updatedAt: takeoverAt + 2
    });
    await assertSucceeds(set(ref(dbTakeover, activePath), active2));
    await assertSucceeds(set(ref(dbTakeover, publicPath), publicEnvelope(takeoverState)));

    const stalePrivateState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence1,
      fenceSequence: 1,
      updatedAt: startAt + 2_000,
      score: 99
    });
    await assertFails(set(ref(dbA, privatePath), privateEnvelope(stalePrivateState)));
    await assertFails(set(ref(dbA, publicPath), publicEnvelope(stalePrivateState)));
    await assertFails(set(ref(dbA, leasePath), { ...lease1, updatedAt: Date.now() }));

    const authoritative = (await get(ref(dbTakeover, privatePath))).val();
    assert.equal(authoritative.protocolVersion, PROTOCOL);
    assert.equal(authoritative.state.remoteWriteProtocolV279, PROTOCOL);
    assert.equal(authoritative.state.tournament.remoteWriteProtocolV279, PROTOCOL);
    assert.equal(authoritative.updatedAt, authoritative.state.updatedAt);
    assert.equal(authoritative.state.tournament.liveWriteFenceV278, fence2);
    assert.equal(authoritative.state.tournament.liveWriteFenceSequenceV278, 2);
    assert.equal(authoritative.state.qualifierRounds[0].stages[0].groups[0].points["racer-a"], 7);
  });

  await qaCase("same-venue-other-account-running-active-delete-deny", async () => {
    await assertFails(runTransaction(
      ref(dbA, activePath),
      () => null,
      { applyLocally: false }
    ));
    const active = (await get(ref(dbTakeover, activePath))).val();
    assert.equal(active.status, "running");
    assert.equal(active.uid, UID_TAKEOVER);
  });

  await qaCase("finish-history-allow", async () => {
    const finishAt = startAt + 3_000;
    const endedAtISO = "2026-08-22T01:00:00.000Z";
    finishedState = makeState({
      id: tournamentId,
      venueId: VENUE_A,
      generation,
      fenceToken: fence2,
      fenceSequence: 2,
      updatedAt: finishAt,
      status: "finished",
      score: 7,
      endedAtISO,
      tournamentPatch: { finishSyncPending: false, recordId: "record-main-v279" }
    });
    const poisonedFinishState = structuredClone(finishedState);
    poisonedFinishState.tournament.liveWriteFenceV278 = "poisoned-terminal-fence-v279";
    poisonedFinishState.tournament.liveWriteFenceSequenceV278 = 3;
    await assertFails(set(ref(dbTakeover, privatePath), privateEnvelope(poisonedFinishState)));

    const expiredAt = Date.now() - 1_000;
    const expiredLease = {
      ...lease2,
      leaseUntil: expiredAt,
      clientUpdatedAt: expiredAt,
      updatedAt: expiredAt
    };
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), leasePath), expiredLease);
    });
    await assertFails(set(ref(dbTakeover, privatePath), privateEnvelope(finishedState)));

    const renewAt = Date.now();
    const renewedLease = {
      ...expiredLease,
      reason: "rules-qa-same-session-finish-renew",
      leaseUntil: renewAt + 30_000,
      clientUpdatedAt: renewAt,
      updatedAt: { ".sv": "timestamp" }
    };
    await assertSucceeds(set(ref(dbTakeover, leasePath), renewedLease));
    lease2 = (await get(ref(dbTakeover, leasePath))).val();
    await assertSucceeds(set(ref(dbTakeover, privatePath), privateEnvelope(finishedState)));
    await assertSucceeds(set(ref(dbTakeover, publicPath), publicEnvelope(finishedState)));

    const privateHistory = {
      protocolVersion: PROTOCOL,
      id: "record-main-v279",
      sourceTournamentId: tournamentId,
      registryGeneration: generation,
      venueId: VENUE_A,
      venueName: VENUE_A,
      endedAtISO,
      createdAt: endedAtISO,
      rows: []
    };
    const publicHistory = { ...privateHistory, rows: [] };
    await assertSucceeds(set(ref(dbTakeover, `privateResultLogs/${VENUE_A}/${privateHistory.id}`), privateHistory));
    await assertSucceeds(set(ref(dbTakeover, `publicHistory/${publicHistory.id}`), publicHistory));

    assert.equal((await get(ref(unauthDb, `publicHistory/${publicHistory.id}`))).val().sourceTournamentId, tournamentId);
  });

  await qaCase("same-venue-other-account-exact-terminal-active-delete-allow", async () => {
    const deleteResult = await assertSucceeds(runTransaction(
      ref(dbA, activePath),
      current => current ? null : current,
      { applyLocally: false }
    ));
    assert.equal(deleteResult.committed, true);
    assert.equal(deleteResult.snapshot.exists(), false);

    releasedLease = {
      ...lease2,
      sessionId: "",
      sessionLineageId: "",
      leaseUntil: 0,
      status: "released",
      reason: "release",
      releasedAt: finishedState.updatedAt + 2,
      updatedAt: finishedState.updatedAt + 2
    };
    await assertSucceeds(set(ref(dbTakeover, leasePath), releasedLease));

    assert.equal((await get(ref(dbTakeover, activePath))).exists(), false);
  });

  await qaCase("missing-public-running-terminal-first-create-exact-mirror-only", async () => {
    const now = Date.now();
    const id = "qa-missing-public-terminal-create-v279";
    const generation = "generation-missing-public-v279";
    const fenceToken = "fence-missing-public-v279";
    const sessionId = "session-missing-public-v279";
    const isolatedLeasePath = `operationLocks/leases/${VENUE_B}`;
    const isolatedActivePath = `activeTournaments/${VENUE_B}`;
    const isolatedPrivatePath = `tournaments/${id}`;
    const isolatedPublicPath = `publicLive/${id}`;
    const reservation = reserveLease({
      venueId: VENUE_B,
      uid: UID_B,
      sessionId,
      tournamentId: id,
      generation,
      fenceToken,
      sequence: 1,
      now
    });
    await assertSucceeds(set(ref(dbB, isolatedLeasePath), reservation));
    const lease = finalizeLease({ reservation, uid: UID_B, sessionId, now: now + 1 });
    await assertSucceeds(set(ref(dbB, isolatedLeasePath), lease));
    await assertSucceeds(set(ref(dbB, isolatedActivePath), activeEnvelope({
      venueId: VENUE_B,
      tournamentId: id,
      generation,
      fenceToken,
      fenceSequence: 1,
      uid: UID_B,
      updatedAt: now + 2
    })));
    const runningState = makeState({
      id,
      venueId: VENUE_B,
      generation,
      fenceToken,
      fenceSequence: 1,
      updatedAt: now + 3
    });
    await assertSucceeds(set(ref(dbB, isolatedPrivatePath), privateEnvelope(runningState)));
    assert.equal((await get(ref(unauthDb, isolatedPublicPath))).exists(), false);

    const terminalState = makeState({
      id,
      venueId: VENUE_B,
      generation,
      fenceToken,
      fenceSequence: 1,
      updatedAt: now + 4,
      status: "finished",
      endedAtISO: "2026-08-22T04:00:00.000Z",
      tournamentPatch: { finishSyncPending: true }
    });
    await assertSucceeds(set(ref(dbB, isolatedPrivatePath), privateEnvelope(terminalState)));

    const mismatchedPublic = publicEnvelope(terminalState);
    mismatchedPublic.updatedAt += 1;
    mismatchedPublic.state.updatedAt += 1;
    await assertFails(set(ref(dbB, isolatedPublicPath), mismatchedPublic));
    await assertSucceeds(set(ref(dbB, isolatedPublicPath), publicEnvelope(terminalState)));
    assert.equal((await get(ref(unauthDb, isolatedPublicPath))).val().status, "finished");
  });

  await qaCase("stale-active-delete-strict-main-durable-pending-and-expired-start-proof", async () => {
    const now = Date.now();
    const seedStaleActive = async ({ id, generation, activeFence, terminalFence, lease }) => {
      const terminalState = makeState({
        id,
        venueId: VENUE_AUTO,
        generation,
        fenceToken: terminalFence,
        fenceSequence: 2,
        updatedAt: now,
        status: "finished",
        endedAtISO: "2026-08-22T05:00:00.000Z"
      });
      await testEnv.withSecurityRulesDisabled(async adminContext => {
        const adminDb = adminContext.database();
        await set(ref(adminDb, `activeTournaments/${VENUE_AUTO}`), activeEnvelope({
          venueId: VENUE_AUTO,
          tournamentId: id,
          generation,
          fenceToken: activeFence,
          fenceSequence: 1,
          uid: UID_AUTO,
          updatedAt: now - 1
        }));
        await set(ref(adminDb, `tournaments/${id}`), privateEnvelope(terminalState));
        await set(ref(adminDb, `operationLocks/leases/${VENUE_AUTO}`), lease);
      });
    };
    const deleteActive = database => runTransaction(
      ref(database, `activeTournaments/${VENUE_AUTO}`),
      current => current ? null : current,
      { applyLocally: false }
    );

    const mainId = "qa-stale-active-main-proof-v279";
    const mainGeneration = "generation-stale-active-main-v279";
    const mainActiveFence = "fence-stale-active-main-1";
    const mainTerminalFence = "fence-stale-active-main-2";
    const mainLease = {
      protocolVersion: PROTOCOL,
      scope: "venue",
      venueId: VENUE_AUTO,
      uid: UID_AUTO,
      sessionId: "",
      sessionLineageId: "",
      claimSequence: 2,
      fenceSequenceHighWater: 2,
      fenceToken: "mismatched-main-fence",
      tournamentId: mainId,
      registryGeneration: mainGeneration,
      leaseUntil: 0,
      status: "released",
      updatedAt: now - 1
    };
    await seedStaleActive({
      id: mainId,
      generation: mainGeneration,
      activeFence: mainActiveFence,
      terminalFence: mainTerminalFence,
      lease: mainLease
    });
    await assertFails(deleteActive(dbAuto));
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}/fenceToken`), mainTerminalFence);
    });
    await assertFails(deleteActive(dbB));
    await assertSucceeds(deleteActive(dbAuto));

    const pendingId = "qa-stale-active-pending-proof-v279";
    const pendingGeneration = "generation-stale-active-pending-v279";
    const pendingActiveFence = "fence-stale-active-pending-1";
    const pendingTerminalFence = "fence-stale-active-pending-2";
    const pendingLease = {
      protocolVersion: PROTOCOL,
      scope: "venue",
      venueId: VENUE_AUTO,
      uid: UID_AUTO,
      sessionId: "session-stale-active-pending-old",
      sessionLineageId: "lineage-stale-active-pending-old",
      claimSequence: 1,
      fenceSequenceHighWater: 2,
      fenceToken: pendingActiveFence,
      tournamentId: pendingId,
      registryGeneration: pendingGeneration,
      leaseUntil: now - 1,
      status: "running",
      pendingClaimToken: "pending-stale-active-proof-v279",
      pendingUid: UID_AUTO,
      pendingSessionId: "session-stale-active-pending-new",
      pendingSessionLineageId: "lineage-stale-active-pending-new",
      pendingClaimSequence: 2,
      pendingFenceToken: "mismatched-pending-terminal-fence",
      pendingTournamentId: pendingId,
      pendingRegistryGeneration: pendingGeneration,
      pendingVenueId: VENUE_AUTO,
      pendingReason: "rules-qa-stale-active",
      pendingAt: now - 46_000,
      updatedAt: now - 1
    };
    await seedStaleActive({
      id: pendingId,
      generation: pendingGeneration,
      activeFence: pendingActiveFence,
      terminalFence: pendingTerminalFence,
      lease: pendingLease
    });
    await assertFails(deleteActive(dbAuto));
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await update(ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}`), {
        pendingFenceToken: pendingTerminalFence,
        pendingClaimSequence: 3,
        fenceSequenceHighWater: 3
      });
    });
    await assertFails(deleteActive(dbAuto));
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await update(ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}`), {
        pendingClaimSequence: 2,
        fenceSequenceHighWater: 2,
        pendingRegistryGeneration: "mismatched-pending-generation"
      });
    });
    await assertFails(deleteActive(dbAuto));
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(
        ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}/pendingRegistryGeneration`),
        pendingGeneration
      );
    });
    await assertSucceeds(deleteActive(dbAuto));

    const startCrashId = "qa-start-crash-active-only-v279";
    const startCrashGeneration = "generation-start-crash-v279";
    const startCrashFence = "fence-start-crash-v279";
    const startCrashActive = activeEnvelope({
      venueId: VENUE_AUTO,
      tournamentId: startCrashId,
      generation: startCrashGeneration,
      fenceToken: startCrashFence,
      fenceSequence: 1,
      uid: UID_AUTO,
      updatedAt: now
    });
    const expiredStartLease = {
      protocolVersion: PROTOCOL,
      scope: "venue",
      venueId: VENUE_AUTO,
      uid: UID_AUTO,
      sessionId: "",
      sessionLineageId: "",
      claimSequence: 1,
      fenceSequenceHighWater: 1,
      fenceToken: startCrashFence,
      tournamentId: startCrashId,
      registryGeneration: startCrashGeneration,
      leaseUntil: now - 1,
      status: "released",
      updatedAt: now - 1
    };
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      await set(ref(adminDb, `activeTournaments/${VENUE_AUTO}`), startCrashActive);
      await set(ref(adminDb, `operationLocks/leases/${VENUE_AUTO}`), expiredStartLease);
      await remove(ref(adminDb, `tournaments/${startCrashId}`));
      await remove(ref(adminDb, `publicLive/${startCrashId}`));
    });
    await assertFails(deleteActive(dbAutoCleaner));

    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await update(ref(adminContext.database(), `activeTournaments/${VENUE_AUTO}`), {
        updatedAt: now - 31_000
      });
      await update(ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}`), {
        leaseUntil: now + 30_000,
        status: "starting",
        updatedAt: now
      });
    });
    await assertFails(deleteActive(dbAutoCleaner));

    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await update(ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}`), {
        fenceToken: "mismatched-start-crash-fence",
        leaseUntil: now - 1,
        status: "released",
        updatedAt: now - 1
      });
    });
    await assertFails(deleteActive(dbAutoCleaner));
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(
        ref(adminContext.database(), `operationLocks/leases/${VENUE_AUTO}/fenceToken`),
        startCrashFence
      );
    });
    await assertSucceeds(deleteActive(dbAutoCleaner));
  });

  await qaCase("terminal-private-score-and-round-mutation-deny", async () => {
    const scoreMutation = structuredClone(finishedState);
    scoreMutation.qualifierRounds[0].stages[0].groups[0].points["racer-a"] = 999;
    scoreMutation.updatedAt += 10;
    await assertFails(set(ref(dbTakeover, privatePath), privateEnvelope(scoreMutation)));

    const roundMutation = structuredClone(finishedState);
    roundMutation.qualifierRounds[0].title = "Mutated terminal round";
    roundMutation.updatedAt += 11;
    await assertFails(set(ref(dbTakeover, privatePath), privateEnvelope(roundMutation)));

    const pendingTerminalState = structuredClone(finishedState);
    pendingTerminalState.tournament.finishSyncPending = true;
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), privatePath), privateEnvelope(pendingTerminalState));
    });
    const publisherClaim = structuredClone(pendingTerminalState);
    publisherClaim.tournament.finishSyncPublisherToken = "rules-qa-finish-publisher-token";
    publisherClaim.tournament.finishSyncPublisherAt = Date.now();
    await assertSucceeds(set(ref(dbTakeover, privatePath), privateEnvelope(publisherClaim)));

    const finalizedPendingState = structuredClone(publisherClaim);
    finalizedPendingState.tournament.finishSyncPending = false;
    delete finalizedPendingState.tournament.finishSyncPublisherToken;
    delete finalizedPendingState.tournament.finishSyncPublisherAt;
    await assertSucceeds(set(ref(dbTakeover, privatePath), privateEnvelope(finalizedPendingState)));

    const stored = (await get(ref(dbTakeover, privatePath))).val();
    assert.equal(stored.state.qualifierRounds[0].stages[0].groups[0].points["racer-a"], 7);
    assert.equal(stored.state.qualifierRounds[0].title, "Round 1");
  });

  await qaCase("public-history-cross-venue-source-generation-overwrite-deny", async () => {
    const historyPath = "publicHistory/record-main-v279";
    const original = (await get(ref(unauthDb, historyPath))).val();
    await assertFails(set(ref(dbB, historyPath), {
      ...original,
      venueId: VENUE_B,
      venueName: VENUE_B
    }));
    await assertFails(set(ref(dbTakeover, historyPath), {
      ...original,
      sourceTournamentId: "qa-rules-wrong-source-v279"
    }));
    await assertFails(set(ref(dbTakeover, historyPath), {
      ...original,
      registryGeneration: "generation-wrong-v279"
    }));

    const stored = (await get(ref(unauthDb, historyPath))).val();
    assert.equal(stored.venueId, VENUE_A);
    assert.equal(stored.sourceTournamentId, tournamentId);
    assert.equal(stored.registryGeneration, generation);
  });

  await qaCase("released-lease-next-sequence-reserve-finalize-allow", async () => {
    const reuseAt = Date.now();
    const reservation3 = reserveLease({
      venueId: VENUE_A,
      uid: UID_A,
      sessionId: "session-main-3",
      tournamentId: "qa-rules-next-v279",
      generation: "generation-next-v279",
      fenceToken: "fence-main-3",
      sequence: 3,
      now: reuseAt,
      current: releasedLease
    });
    await assertSucceeds(set(ref(dbA, leasePath), reservation3));
    lease3 = finalizeLease({ reservation: reservation3, uid: UID_A, sessionId: "session-main-3", now: reuseAt + 1 });
    await assertSucceeds(set(ref(dbA, leasePath), lease3));

    const storedLease = (await get(ref(dbA, leasePath))).val();
    assert.equal(storedLease.uid, UID_A);
    assert.equal(storedLease.claimSequence, 3);
    assert.equal(storedLease.fenceSequenceHighWater, 3);
    assert.equal(storedLease.fenceToken, "fence-main-3");
    assert.equal(storedLease.tournamentId, "qa-rules-next-v279");
  });

  await qaCase("pending-future-and-mutating-cancel-deny-valid-cancel-allow", async () => {
    const pendingAt = Date.now();
    const futureReservation = reserveLease({
      venueId: VENUE_A,
      uid: UID_A,
      sessionId: "session-main-4",
      tournamentId: "qa-rules-fourth-v279",
      generation: "generation-fourth-v279",
      fenceToken: "fence-main-4",
      sequence: 4,
      now: pendingAt + 60_000,
      current: lease3
    });
    await assertFails(set(ref(dbA, leasePath), futureReservation));

    const reservation4 = reserveLease({
      venueId: VENUE_A,
      uid: UID_A,
      sessionId: "session-main-4",
      tournamentId: "qa-rules-fourth-v279",
      generation: "generation-fourth-v279",
      fenceToken: "fence-main-4",
      sequence: 4,
      now: pendingAt,
      current: lease3
    });
    await assertSucceeds(set(ref(dbA, leasePath), reservation4));

    const cancelBase = {
      ...lease3,
      fenceSequenceHighWater: 4,
      updatedAt: pendingAt + 1
    };
    await assertFails(set(ref(dbA, leasePath), {
      ...cancelBase,
      leaseUntil: cancelBase.leaseUntil + 1
    }));
    await assertFails(set(ref(dbA, leasePath), {
      ...cancelBase,
      status: "released"
    }));
    await assertFails(set(ref(dbA, leasePath), {
      ...cancelBase,
      tournamentId: "qa-rules-mutated-on-cancel-v279"
    }));

    cancelledLease = cancelBase;
    await assertSucceeds(set(ref(dbA, leasePath), cancelledLease));
    const stored = (await get(ref(dbA, leasePath))).val();
    assert.equal(Object.hasOwn(stored, "pendingClaimToken"), false);
    assert.equal(stored.fenceSequenceHighWater, 4);
    assert.equal(stored.leaseUntil, lease3.leaseUntil);
    assert.equal(stored.status, lease3.status);
    assert.equal(stored.tournamentId, lease3.tournamentId);
  });

  {
    const forceReleaseAt = Date.now();
    const forceReleasePayload = {
      ...cancelledLease,
      sessionId: "",
      sessionLineageId: "",
      leaseUntil: 0,
      status: "released",
      reason: "force-release",
      releasedAt: forceReleaseAt,
      updatedAt: forceReleaseAt
    };
    await expectedAllowed(
      "bootstrap-admin-force-release-foreign-strict-lease-allow",
      () => set(ref(dbBootstrapAdmin, leasePath), forceReleasePayload)
    );
  }

  await qaCase("expired-missing-field-legacy-lease-migration-reserve-finalize-allow", async () => {
    const migrationAt = Date.now();
    const legacyLeasePath = `operationLocks/leases/${VENUE_LEGACY}`;
    const freshLegacyLease = {
      protocolVersion: 278,
      scope: "venue",
      venueId: VENUE_LEGACY,
      uid: UID_LEGACY,
      sessionId: "legacy-session-v278",
      sessionLineageId: "legacy-lineage-v278",
      tournamentId: "legacy-tournament-v278",
      leaseUntil: migrationAt + 30_000,
      status: "running",
      updatedAt: migrationAt
    };
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), legacyLeasePath), freshLegacyLease);
    });

    const freshReservation = {
      ...reserveLease({
        venueId: VENUE_LEGACY,
        uid: UID_LEGACY,
        sessionId: "migrated-session-v279",
        tournamentId: "migrated-tournament-v279",
        generation: "migrated-generation-v279",
        fenceToken: "migrated-fence-v279",
        sequence: 1,
        now: migrationAt,
        current: freshLegacyLease,
        legacyMigrationV279: true
      }),
      claimSequence: 0,
      fenceToken: "",
      registryGeneration: ""
    };
    await assertFails(set(ref(dbLegacy, legacyLeasePath), freshReservation));

    const sparseLegacyLease = {
      protocolVersion: 278,
      venueId: VENUE_LEGACY
    };
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), legacyLeasePath), sparseLegacyLease);
    });

    const reservation = {
      ...reserveLease({
        venueId: VENUE_LEGACY,
        uid: UID_LEGACY,
        sessionId: "migrated-session-v279",
        tournamentId: "migrated-tournament-v279",
        generation: "migrated-generation-v279",
        fenceToken: "migrated-fence-v279",
        sequence: 1,
        now: migrationAt,
        current: sparseLegacyLease,
        legacyMigrationV279: true
      }),
      uid: UID_LEGACY,
      sessionId: "",
      claimSequence: 0,
      fenceToken: "",
      tournamentId: "",
      registryGeneration: "",
      leaseUntil: 0,
      status: "reserving"
    };
    await assertSucceeds(set(ref(dbLegacy, legacyLeasePath), reservation));

    const migratedLease = finalizeLease({
      reservation,
      uid: UID_LEGACY,
      sessionId: "migrated-session-v279",
      now: migrationAt + 1
    });
    await assertSucceeds(set(ref(dbLegacy, legacyLeasePath), migratedLease));

    const stored = (await get(ref(dbLegacy, legacyLeasePath))).val();
    assert.equal(stored.protocolVersion, PROTOCOL);
    assert.equal(stored.uid, UID_LEGACY);
    assert.equal(stored.claimSequence, 1);
    assert.equal(stored.fenceSequenceHighWater, 1);
    assert.equal(stored.tournamentId, "migrated-tournament-v279");
    assert.equal(Object.hasOwn(stored, "pendingClaimToken"), false);
  });

  await qaCase("stale-auto-close-allow-fresh-auto-close-deny", async () => {
    const now = Date.now();
    const staleId = "qa-stale-auto-close-v279";
    const freshId = "qa-fresh-auto-close-v279";
    const staleAt = now - 3_700_000;
    const freshAt = now - 60_000;
    const autoGeneration = "generation-auto-v279";
    const staleState = makeState({
      id: staleId,
      venueId: VENUE_AUTO,
      generation: autoGeneration,
      fenceToken: "fence-auto-stale",
      fenceSequence: 4,
      updatedAt: staleAt
    });
    const freshState = makeState({
      id: freshId,
      venueId: VENUE_AUTO,
      generation: autoGeneration,
      fenceToken: "fence-auto-fresh",
      fenceSequence: 5,
      updatedAt: freshAt
    });
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      await set(ref(adminDb, `tournaments/${staleId}`), privateEnvelope(staleState));
      await set(ref(adminDb, `publicLive/${staleId}`), publicEnvelope(staleState));
      await set(ref(adminDb, `tournaments/${freshId}`), privateEnvelope(freshState));
      await set(ref(adminDb, `publicLive/${freshId}`), publicEnvelope(freshState));
    });

    const staleEndedAt = "2026-08-22T02:00:00.000Z";
    const staleFinished = makeState({
      id: staleId,
      venueId: VENUE_AUTO,
      generation: autoGeneration,
      fenceToken: "fence-auto-stale",
      fenceSequence: 4,
      updatedAt: now,
      status: "finished",
      endedAtISO: staleEndedAt,
      tournamentPatch: {
        autoClosed: true,
        autoClosePublishPending: true,
        autoClosePreviousUpdatedAt: staleAt,
        autoCloseAttemptId: "auto-close-stale-v279"
      }
    });
    await assertSucceeds(set(ref(dbAuto, `tournaments/${staleId}`), privateEnvelope(staleFinished)));
    await assertSucceeds(set(ref(dbAuto, `publicLive/${staleId}`), publicEnvelope(staleFinished)));

    const freshFinished = makeState({
      id: freshId,
      venueId: VENUE_AUTO,
      generation: autoGeneration,
      fenceToken: "fence-auto-fresh",
      fenceSequence: 5,
      updatedAt: now + 1,
      status: "finished",
      endedAtISO: "2026-08-22T02:01:00.000Z",
      tournamentPatch: {
        autoClosed: true,
        autoClosePublishPending: true,
        autoClosePreviousUpdatedAt: freshAt,
        autoCloseAttemptId: "auto-close-fresh-v279"
      }
    });
    await assertFails(set(ref(dbAuto, `tournaments/${freshId}`), privateEnvelope(freshFinished)));
    assert.equal((await get(ref(dbAuto, `tournaments/${freshId}`))).val().status, "running");
  });

  await qaCase("auto-close-rollback-marker-specific-timestamp-guard", async () => {
    const now = Date.now();
    const previousAt = now - 3_700_000;
    const newerPublicAt = now - 1_000;
    const autoGeneration = "generation-auto-rollback-v279";
    const cases = [
      {
        id: "qa-auto-close-rollback-allowed-v279",
        autoClosePreviousUpdatedAt: previousAt,
        finishSyncPreviousUpdatedAt: undefined,
        allowed: true
      },
      {
        id: "qa-auto-close-rollback-wrong-marker-v279",
        autoClosePreviousUpdatedAt: newerPublicAt + 1,
        finishSyncPreviousUpdatedAt: previousAt,
        allowed: false
      },
      {
        id: "qa-auto-close-rollback-older-public-v279",
        autoClosePreviousUpdatedAt: newerPublicAt,
        finishSyncPreviousUpdatedAt: undefined,
        allowed: false
      }
    ];

    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      for (const testCase of cases) {
        const fenceToken = `fence-${testCase.id}`;
        const terminalState = makeState({
          id: testCase.id,
          venueId: VENUE_AUTO,
          generation: autoGeneration,
          fenceToken,
          fenceSequence: 12,
          updatedAt: previousAt + 1,
          status: "finished",
          endedAtISO: "2026-08-22T03:00:00.000Z",
          tournamentPatch: {
            autoClosed: true,
            autoClosePublishPending: true,
            autoClosePreviousUpdatedAt: testCase.autoClosePreviousUpdatedAt,
            ...(testCase.finishSyncPreviousUpdatedAt === undefined
              ? {}
              : { finishSyncPreviousUpdatedAt: testCase.finishSyncPreviousUpdatedAt })
          }
        });
        const publicRunningState = makeState({
          id: testCase.id,
          venueId: VENUE_AUTO,
          generation: autoGeneration,
          fenceToken,
          fenceSequence: 12,
          updatedAt: newerPublicAt
        });
        await set(ref(adminDb, `tournaments/${testCase.id}`), privateEnvelope(terminalState));
        await set(ref(adminDb, `publicLive/${testCase.id}`), publicEnvelope(publicRunningState));
      }
    });

    for (const testCase of cases) {
      const rollbackState = makeState({
        id: testCase.id,
        venueId: VENUE_AUTO,
        generation: autoGeneration,
        fenceToken: `fence-${testCase.id}`,
        fenceSequence: 12,
        updatedAt: newerPublicAt
      });
      const write = () => set(ref(dbAuto, `tournaments/${testCase.id}`), privateEnvelope(rollbackState));
      if (testCase.allowed) await assertSucceeds(write());
      else await assertFails(write());
    }
  });

  await qaCase("superseded-public-live-delete-requires-terminal-private-and-different-active", async () => {
    const supersededAt = Date.now();
    const allowedId = "qa-superseded-delete-allowed-v279";
    const runningPrivateId = "qa-superseded-delete-running-private-v279";
    const sameActiveId = "qa-superseded-delete-same-active-v279";
    const replacementId = "qa-superseded-replacement-v279";
    const supersededGeneration = "generation-superseded-v279";

    const runningState = id => makeState({
      id,
      venueId: VENUE_AUTO,
      generation: supersededGeneration,
      fenceToken: `fence-${id}`,
      fenceSequence: 10,
      updatedAt: supersededAt
    });
    const terminalState = id => makeState({
      id,
      venueId: VENUE_AUTO,
      generation: supersededGeneration,
      fenceToken: `fence-${id}`,
      fenceSequence: 10,
      updatedAt: supersededAt + 1,
      status: "finished",
      endedAtISO: "2026-08-22T04:00:00.000Z"
    });

    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      await set(ref(adminDb, `tournaments/${allowedId}`), privateEnvelope(terminalState(allowedId)));
      await set(ref(adminDb, `publicLive/${allowedId}`), publicEnvelope(runningState(allowedId)));
      await set(ref(adminDb, `tournaments/${runningPrivateId}`), privateEnvelope(runningState(runningPrivateId)));
      await set(ref(adminDb, `publicLive/${runningPrivateId}`), publicEnvelope(runningState(runningPrivateId)));
      await set(ref(adminDb, `tournaments/${sameActiveId}`), privateEnvelope(terminalState(sameActiveId)));
      await set(ref(adminDb, `publicLive/${sameActiveId}`), publicEnvelope(runningState(sameActiveId)));
      await set(ref(adminDb, `activeTournaments/${VENUE_AUTO}`), activeEnvelope({
        venueId: VENUE_AUTO,
        tournamentId: replacementId,
        generation: supersededGeneration,
        fenceToken: "fence-superseded-replacement-v279",
        fenceSequence: 11,
        uid: UID_AUTO,
        updatedAt: supersededAt + 2
      }));
    });

    await assertSucceeds(remove(ref(dbAuto, `publicLive/${allowedId}`)));
    await assertFails(remove(ref(dbAuto, `publicLive/${runningPrivateId}`)));

    await testEnv.withSecurityRulesDisabled(async adminContext => {
      await set(ref(adminContext.database(), `activeTournaments/${VENUE_AUTO}`), activeEnvelope({
        venueId: VENUE_AUTO,
        tournamentId: sameActiveId,
        generation: supersededGeneration,
        fenceToken: `fence-${sameActiveId}`,
        fenceSequence: 10,
        uid: UID_AUTO,
        updatedAt: supersededAt + 3
      }));
    });
    await assertFails(remove(ref(dbAuto, `publicLive/${sameActiveId}`)));

    assert.equal((await get(ref(unauthDb, `publicLive/${allowedId}`))).exists(), false);
    assert.equal((await get(ref(unauthDb, `publicLive/${runningPrivateId}`))).exists(), true);
    assert.equal((await get(ref(unauthDb, `publicLive/${sameActiveId}`))).exists(), true);
  });

  await qaCase("venue-operator-strict-record-delete-deny", async () => {
    const deleteId = "qa-bootstrap-admin-delete-v279";
    const historyId = "record-bootstrap-admin-delete-v279";
    const deleteGeneration = "generation-bootstrap-delete-v279";
    const deleteState = makeState({
      id: deleteId,
      venueId: VENUE_A,
      generation: deleteGeneration,
      fenceToken: "fence-bootstrap-delete-v279",
      fenceSequence: 6,
      updatedAt: Date.now(),
      status: "finished",
      endedAtISO: "2026-08-22T03:00:00.000Z"
    });
    const privateHistory = {
      protocolVersion: PROTOCOL,
      id: historyId,
      sourceTournamentId: deleteId,
      registryGeneration: deleteGeneration,
      venueId: VENUE_A,
      venueName: VENUE_A,
      endedAtISO: "2026-08-22T03:00:00.000Z",
      createdAt: "2026-08-22T03:00:00.000Z",
      rows: []
    };
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      await set(ref(adminDb, `tournaments/${deleteId}`), privateEnvelope(deleteState));
      await set(ref(adminDb, `publicLive/${deleteId}`), publicEnvelope(deleteState));
      await set(ref(adminDb, `privateResultLogs/${VENUE_A}/${historyId}`), privateHistory);
      await set(ref(adminDb, `publicHistory/${historyId}`), { ...privateHistory });
    });

    await assertFails(remove(ref(dbA, `tournaments/${deleteId}`)));
    await assertFails(remove(ref(dbA, `publicLive/${deleteId}`)));
    await assertFails(remove(ref(dbA, `privateResultLogs/${VENUE_A}/${historyId}`)));
    await assertFails(remove(ref(dbA, `publicHistory/${historyId}`)));

    assert.equal((await get(ref(dbA, `tournaments/${deleteId}`))).exists(), true);
    assert.equal((await get(ref(unauthDb, `publicLive/${deleteId}`))).exists(), true);
  });

  {
    const deleteId = "qa-bootstrap-admin-delete-v279";
    const historyId = "record-bootstrap-admin-delete-v279";
    await expectedAllowed(
      "bootstrap-admin-delete-strict-public-live-allow",
      () => remove(ref(dbBootstrapAdmin, `publicLive/${deleteId}`))
    );
    await expectedAllowed(
      "bootstrap-admin-delete-strict-public-history-allow",
      () => remove(ref(dbBootstrapAdmin, `publicHistory/${historyId}`))
    );
    await expectedAllowed(
      "bootstrap-admin-delete-strict-private-history-allow",
      () => remove(ref(dbBootstrapAdmin, `privateResultLogs/${VENUE_A}/${historyId}`))
    );
    await expectedAllowed(
      "bootstrap-admin-delete-strict-tournament-allow",
      () => remove(ref(dbBootstrapAdmin, `tournaments/${deleteId}`))
    );
  }

  await qaCase("legacy-root-child-and-multipath-bypass-deny", async () => {
    const legacyId = "qa-legacy-bypass-v279";
    const legacyGeneration = "generation-legacy-v279";
    const legacyFence = "fence-legacy-v279";
    const legacyAt = Date.now();
    const protectedState = makeState({
      id: legacyId,
      venueId: VENUE_A,
      generation: legacyGeneration,
      fenceToken: legacyFence,
      fenceSequence: 9,
      updatedAt: legacyAt
    });
    const protectedLease = {
      protocolVersion: PROTOCOL,
      scope: "venue",
      venueId: VENUE_A,
      uid: UID_A,
      sessionId: "session-legacy-guard",
      claimSequence: 9,
      fenceSequenceHighWater: 9,
      fenceToken: legacyFence,
      tournamentId: legacyId,
      registryGeneration: legacyGeneration,
      status: "running",
      leaseUntil: legacyAt + 30_000,
      updatedAt: legacyAt
    };
    const protectedActive = activeEnvelope({
      venueId: VENUE_A,
      tournamentId: legacyId,
      generation: legacyGeneration,
      fenceToken: legacyFence,
      fenceSequence: 9,
      uid: UID_A,
      updatedAt: legacyAt
    });
    await testEnv.withSecurityRulesDisabled(async adminContext => {
      const adminDb = adminContext.database();
      await set(ref(adminDb, leasePath), protectedLease);
      await set(ref(adminDb, activePath), protectedActive);
      await set(ref(adminDb, `tournaments/${legacyId}`), privateEnvelope(protectedState));
      await set(ref(adminDb, `publicLive/${legacyId}`), publicEnvelope(protectedState));
    });

    const legacyState = {
      settings: { laneCount: 3, matchMode: "basic" },
      tournament: { liveId: legacyId, venueId: VENUE_A, status: "running" },
      qualifierRounds: [],
      updatedAt: legacyAt + 1_000
    };
    await assertFails(set(ref(dbA, `tournaments/${legacyId}`), { state: legacyState, updatedAt: legacyState.updatedAt }));
    await assertFails(set(ref(dbA, `tournaments/${legacyId}/state`), legacyState));
    await assertFails(set(ref(dbA, `publicLive/${legacyId}`), {
      id: legacyId,
      venueId: VENUE_A,
      status: "running",
      updatedAt: legacyState.updatedAt,
      state: legacyState
    }));
    await assertFails(set(ref(dbA, `publicLive/${legacyId}/state`), legacyState));
    await assertFails(update(ref(dbA), {
      [`tournaments/${legacyId}/state`]: legacyState,
      [`publicLive/${legacyId}/state`]: legacyState
    }));
    await assertFails(set(ref(dbA, activePath), {
      venueId: VENUE_A,
      tournamentId: legacyId,
      status: "running",
      updatedAt: legacyAt + 1_000
    }));

    const preserved = (await get(ref(dbA, `tournaments/${legacyId}`))).val();
    assert.equal(preserved.protocolVersion, PROTOCOL);
    assert.equal(preserved.registryGeneration, legacyGeneration);
    assert.equal(preserved.state.tournament.liveWriteFenceV278, legacyFence);
    assert.equal(preserved.updatedAt, legacyAt);
  });

  if (contractFailures.length) {
    throw new AggregateError(
      contractFailures.map(item => item.error),
      `RTDB rules contract failures: ${contractFailures.map(item => item.name).join(", ")}`
    );
  }
  process.stdout.write(`RTDB rules QA passed: ${results.length}/${results.length}\n`);
} finally {
  try {
    await testEnv.clearDatabase();
  } finally {
    await testEnv.cleanup();
  }
}
