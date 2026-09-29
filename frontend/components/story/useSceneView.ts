"use client";

import { useEffect, useMemo } from "react";
import { useApp, simInfo } from "@/lib/store";
import { useSearch } from "@/lib/ui/search";
import { loadAux, loadManifest } from "@/lib/ui/snapshotAux";
import { useSnapshotFile } from "@/lib/ui/useSnapshotFile";
import { sceneView, type SceneView, type SearchSnapshot } from "@/lib/ui/storyFigures";
import { loadFacts, nextScene, stepLabel, STORY_MISSION, useStory, type StoryScene } from "@/lib/ui/story";
import { eligibleCandidates } from "@/lib/agent/catalog";
import { SEARCH_FUTURES, shortModel, simLensFor } from "@/lib/ui/agentBridge";
import { optionName } from "@/components/planner/labels";

const RUNNING = new Set(["parsing", "planning", "evaluating", "critiquing", "finalizing"]);

/** Everything the story card needs for the scene on screen, recomputed only when an input changes. */
export function useSceneView(id: StoryScene): SceneView {
  const ready = useApp((s) => s.status === "ready");
  const baseline = useApp((s) => s.baseline);
  const current = useApp((s) => s.current);
  const scenario = useApp((s) => s.scenario);
  const trips = useApp((s) => s.trips);
  const busy = useApp((s) => s.busy);
  const { data: aux } = useSnapshotFile(loadAux, ready);
  const { data: manifest } = useSnapshotFile(loadManifest, ready);

  const facts = useStory((s) => s.facts);
  const revealed = useStory((s) => s.revealed);
  const bridgeOnly = useStory((s) => s.bridgeOnly);
  const topWorld = useStory((s) => s.topWorld);
  const routeTrip = useStory((s) => s.routeTrip);
  const settling = useStory((s) => s.settling);
  const stoppedAt = useStory((s) => s.stoppedAt);

  const m = useSearch((s) => s.m);
  const health = useSearch((s) => s.health);
  const catalog = useSearch((s) => s.catalog);
  const futures = useSearch((s) => s.futures);
  const bundles = useSearch((s) => s.bundles);
  const draft = useSearch((s) => s.draft);

  useEffect(() => {
    if (ready) void loadFacts();
  }, [ready]);

  const futuresDone = futures.done;
  const futuresPlanned = futures.before + futures.roundTotal;

  const search: SearchSnapshot = useMemo(() => {
    const phase = m?.phase ?? "idle";
    const title = (ids: string[]) => ids.map((c) => optionName(catalog, c)).join(" + ");
    const screening = phase === "planning" && m?.mode === "deterministic" && !!m.progress && !m.screened ? m.progress : null;
    return {
      phase,
      mode: phase === "idle" && !m?.mission ? null : (m?.mode ?? null),
      aiAvailable: health.status === "available",
      plannerModel: health.status === "available" ? shortModel(health.info.roles.planner) : null,
      screening,
      futuresDone,
      futuresPlanned,
      futuresPerOption: SEARCH_FUTURES.n[simLensFor(m?.mission?.lens ?? draft.lens)],
      seed: SEARCH_FUTURES.seed,
      // The options the story's search can use, from the catalog's own eligibility rule (never typed in).
      catalogCount: catalog ? eligibleCandidates(catalog, { lens: STORY_MISSION.lens, maxCostTier: STORY_MISSION.maxCostTier, types: [] }).length : null,
      targetDeltaS: m?.mission?.goal.targetDelta ?? draft.targetDelta,
      costTier: m?.mission?.constraints.maxCostTier ?? draft.maxCostTier,
      finalists: (m?.finalists ?? []).map((f) => ({ bundleId: f.bundleId, title: title(f.candidateIds), costTier: f.costTier, pGoal: bundles[f.bundleId]?.pGoal ?? null })),
      appliedBundleId: m?.appliedBundleId ?? null,
      stopped: phase === "idle" && stoppedAt !== null && !RUNNING.has(phase),
    };
  }, [m, health, catalog, futuresDone, futuresPlanned, bundles, draft, stoppedAt]);

  const next = nextScene();
  return useMemo(() => {
    const info = simInfo();
    return sceneView(id, {
      baseline,
      current,
      scenario,
      trips,
      aux,
      params: info ? info.params : null,
      osmDate: manifest?.osmDate ?? null,
      facts,
      revealed,
      bridgeOnly,
      topWorld: topWorld?.out ?? null,
      routeShown: routeTrip !== null,
      settling: settling || busy,
      search,
      nextStep: stepLabel(next),
    });
  }, [id, baseline, current, scenario, trips, aux, manifest, facts, revealed, bridgeOnly, topWorld, routeTrip, settling, busy, search, next]);
}
