"use client";

import { ExternalLink } from "lucide-react";
import { fmtAbout, METHODOLOGY_URL, PEOPLE_GT10_RANGE, REPORTED_DETOUR, ROUTER_CHECK, STUDY_CONCLUSIONS, STUDY_REFERENCE, STUDY_VARIANTS } from "@/lib/ui/methodology";

const n = (v: number) => v.toLocaleString("en-US");

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="display mb-4 mt-14 text-xl font-medium text-text">{children}</h2>;
}

/**
 * The /methodology page: the sensitivity study in plain language, with its two key tables. Every figure comes from
 * lib/ui/methodology.ts, which test/ui/story.test.ts checks against pipeline/sensitivity/out. The full study is
 * docs/METHODOLOGY.md (linked).
 */
export default function MethodologyContent() {
  const total = STUDY_REFERENCE.variants;
  return (
    <div className="text-base leading-7 text-text-2">
      <H2>How the model works</H2>
      <ol className="list-decimal space-y-3 pl-5 marker:text-muted">
        <li>
          <span className="text-text">Roads as they were on 1 March 2024</span>, from OpenStreetMap, three weeks before the collapse. Each road takes its length divided
          by its speed limit: no traffic lights, jams or turns.
        </li>
        <li>
          <span className="text-text">People and jobs on a grid of small hexagons</span>, spread from U.S. Census estimates.
        </li>
        <li>
          <span className="text-text">Removing the bridge</span> closes its six road segments; every drive time is then recomputed with exact shortest paths.
        </li>
        <li>
          <span className="text-text">Three views read the same drive times:</span> the drive to the region&apos;s job centers, the jobs across the river a
          person can reach within 30 minutes, and the time to the nearest fire or ambulance station.
        </li>
      </ol>

      <H2>What the reference run says</H2>
      <p>
        With the Key Bridge removed, the average drive to the region&apos;s job centers gets <span className="text-text">{STUDY_REFERENCE.regionalAddedS} seconds</span>{" "}
        longer. Of {n(STUDY_REFERENCE.popCovered)} people, <span className="text-text">{n(STUDY_REFERENCE.peopleGt10)}</span> can reach over 10% fewer jobs across the
        river within 30 minutes. The time to the nearest station does not change.
      </p>

      <H2>What held up, and what did not</H2>
      <p>
        We wrote down six conclusions first, then changed one assumption at a time (speeds, the time limit, tunnel delays, where the shoreline is drawn, and more) in{" "}
        {total} variants.
      </p>
      <table className="mt-6 w-full text-left text-sm">
        <caption className="sr-only">How many variants each conclusion survived</caption>
        <thead>
          <tr className="text-xs uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="pb-2 font-medium">
              Conclusion
            </th>
            <th scope="col" className="w-32 pb-2 text-right font-medium">
              Held in
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {STUDY_CONCLUSIONS.map((c) => (
            <tr key={c.id}>
              <th scope="row" className="py-3 pr-4 font-normal text-text">
                {c.plain}
              </th>
              <td className="num py-3 text-right">
                <span className={c.held === total ? "text-ok" : "text-warn"}>{c.held}</span>
                <span className="text-muted"> of {total}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <H2>The people count depends on assumptions</H2>
      <p>
        The count of people affected is a cliff-edge number: a trip that takes 29 minutes counts, 31 does not. Small changes in speed or in the time limit move it a lot,
        from about {fmtAbout(PEOPLE_GT10_RANGE.lo)} to about {fmtAbout(PEOPLE_GT10_RANGE.hi)}. The added drive time moves much less. That is why the story always shows the
        count with its range.
      </p>
      <table className="mt-6 w-full text-left text-sm">
        <caption className="sr-only">Selected variants of the study</caption>
        <thead>
          <tr className="text-xs uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="pb-2 font-medium">
              What we changed
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              People affected
            </th>
            <th scope="col" className="pb-2 pl-4 text-right font-medium">
              Avg added
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <th scope="row" className="py-3 pr-4 font-normal text-text">
              Nothing (the reference run)
            </th>
            <td className="num py-3 text-right text-text">{n(STUDY_REFERENCE.peopleGt10)}</td>
            <td className="num py-3 pl-4 text-right">{STUDY_REFERENCE.meanAddedS} s</td>
          </tr>
          {STUDY_VARIANTS.map((v) => (
            <tr key={v.name}>
              <th scope="row" className="py-3 pr-4 font-normal text-text">
                {v.plain}
              </th>
              <td className="num py-3 text-right">{n(v.peopleGt10)}</td>
              <td className="num py-3 pl-4 text-right">{v.meanAddedS} s</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted">Avg added: the average extra time to jobs across the river, per person.</p>

      <H2>Where the model falls short</H2>
      <ul className="list-disc space-y-3 pl-5 marker:text-muted">
        <li>
          <span className="text-text">It has no traffic jams, so it is a lower bound.</span> One reported commute from {REPORTED_DETOUR.pair} went from about{" "}
          {REPORTED_DETOUR.beforeMin} to {REPORTED_DETOUR.afterMin} minutes; the model adds {REPORTED_DETOUR.modelAddedMin} minutes for that trip.
        </li>
        <li>
          <span className="text-text">If the tunnels slow down after the closure,</span> the typical resident is no longer unaffected (the table above shows how much).
        </li>
        <li>
          <span className="text-text">Its drive times rank places like a public road router does</span> (rank agreement {ROUTER_CHECK.spearman}), but they run faster, because
          the model has no traffic lights.
        </li>
      </ul>

      <p className="mt-14">
        <a className="link inline-flex items-center gap-2 text-text" href={METHODOLOGY_URL} target="_blank" rel="noreferrer">
          Read the full study, with every table and script <ExternalLink size={14} aria-hidden />
        </a>
      </p>
    </div>
  );
}
