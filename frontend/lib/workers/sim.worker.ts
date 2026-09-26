/// <reference lib="webworker" />
/**
 * Web Worker entry. Loaded by lib/workers/pool.ts via `new Worker(new URL("./sim.worker.ts", import.meta.url))`.
 */
import * as Comlink from "comlink";
import { createWorkerApi } from "./api";

Comlink.expose(createWorkerApi());
