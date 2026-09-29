/**
 * Fire/EMS stations and hospitals from the snapshot's facilities.json, as small precise marks:
 * a ring for a fire station, a diamond for an EMS station, a square with a cross for a hospital.
 * Drawn only where the scene asks (the "held" scene, the EMS lens): they are the inputs of that lens.
 */
import type { Layer } from "@deck.gl/core";
import { IconLayer } from "@deck.gl/layers";

import { ON_TOP } from "./terrainLayers";

export interface Facility {
  id: string;
  kind: "fire_station" | "ems_station" | "hospital";
  name: string;
  lat: number;
  lng: number;
  active: boolean;
}

let facP: Promise<Facility[]> | null = null;
export function loadFacilities(): Promise<Facility[]> {
  facP ??= fetch("/snapshot/facilities.json")
    .then((r) => {
      if (!r.ok) throw new Error(`facilities.json: HTTP ${r.status}`);
      return r.json() as Promise<Facility[]>;
    })
    .then((rows) => rows.filter((f) => f.active))
    .catch((e) => {
      facP = null;
      throw e;
    });
  return facP;
}

export const FACILITY_LABEL: Record<Facility["kind"], string> = {
  fire_station: "Fire station",
  ems_station: "EMS station",
  hospital: "Hospital",
};

const CELL = 64;
let atlas: string | null = null;

/** Alpha-only atlas (tinted by color): ring, diamond, square-with-cross. */
function iconAtlas(): string {
  if (atlas) return atlas;
  const c = document.createElement("canvas");
  c.width = CELL * 3;
  c.height = CELL;
  const g = c.getContext("2d");
  if (!g) return "";
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  // fire station: ring with a center dot
  g.lineWidth = 9;
  g.beginPath();
  g.arc(CELL / 2, CELL / 2, 22, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(CELL / 2, CELL / 2, 7, 0, Math.PI * 2);
  g.fill();
  // EMS station: diamond
  g.beginPath();
  g.moveTo(CELL * 1.5, 6);
  g.lineTo(CELL * 1 + 58, CELL / 2);
  g.lineTo(CELL * 1.5, CELL - 6);
  g.lineTo(CELL * 1 + 6, CELL / 2);
  g.closePath();
  g.fill();
  // hospital: rounded square, cross knocked out
  const x0 = CELL * 2 + 8;
  g.beginPath();
  g.roundRect(x0, 8, CELL - 16, CELL - 16, 8);
  g.fill();
  g.globalCompositeOperation = "destination-out";
  g.fillRect(x0 + 21, 17, 6, 30);
  g.fillRect(x0 + 9, 29, 30, 6);
  atlas = c.toDataURL("image/png");
  return atlas;
}

const MAPPING = {
  fire_station: { x: 0, y: 0, width: CELL, height: CELL, mask: true },
  ems_station: { x: CELL, y: 0, width: CELL, height: CELL, mask: true },
  hospital: { x: CELL * 2, y: 0, width: CELL, height: CELL, mask: true },
};

const TEAL: [number, number, number] = [45, 212, 191];
const HOSPITAL: [number, number, number] = [230, 237, 243];

export function stationLayers(facilities: Facility[], stations: number, hospitals: number): Layer[] {
  if (typeof document === "undefined") return [];
  const out: Layer[] = [];
  const mk = (id: string, data: Facility[], a: number, size: number) => {
    if (a <= 0.02 || data.length === 0) return;
    out.push(
      // Wide dark under-mark then the bright mark: legible on any terrain color.
      new IconLayer<Facility>({
        id: `${id}-under`,
        data,
        iconAtlas: iconAtlas(),
        iconMapping: MAPPING,
        getIcon: (f) => f.kind,
        getPosition: (f) => [f.lng, f.lat, 20],
        getSize: size + 5,
        sizeUnits: "pixels",
        getColor: [6, 10, 16, 200 * a],
        parameters: ON_TOP,
        pickable: false,
        updateTriggers: { getColor: a },
      }),
      new IconLayer<Facility>({
        id,
        data,
        iconAtlas: iconAtlas(),
        iconMapping: MAPPING,
        getIcon: (f) => f.kind,
        getPosition: (f) => [f.lng, f.lat, 22],
        getSize: size,
        sizeUnits: "pixels",
        getColor: (f) => [...(f.kind === "hospital" ? HOSPITAL : TEAL), 255 * a] as [number, number, number, number],
        parameters: ON_TOP,
        pickable: true,
        updateTriggers: { getColor: a },
      }),
    );
  };
  mk("stations", facilities.filter((f) => f.kind !== "hospital"), stations, 13);
  mk("hospitals", facilities.filter((f) => f.kind === "hospital"), hospitals, 17);
  return out;
}
