"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useApp } from "@/lib/store";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

/** Cmd-K command bar. A stub: a short fixed list wired to real actions. */
export default function CommandBar() {
  const open = useApp((s) => s.commandOpen);
  return <AnimatePresence>{open && <CommandBarInner key="cmd" />}</AnimatePresence>;
}

function CommandBarInner() {
  const setOpen = useApp((s) => s.setCommandOpen);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const cmds = useMemo<Cmd[]>(() => {
    const s = useApp.getState();
    return [
      { id: "remove", label: "Remove Key Bridge link", run: () => void s.removeBridge() },
      { id: "restore", label: "Restore Key Bridge link", run: () => void s.restoreBridge() },
      { id: "reset", label: "Reset world", hint: "R", run: () => void s.resetWorld() },
      { id: "present", label: "Toggle presentation mode", hint: "P", run: () => s.togglePresentation() },
      { id: "orbit", label: "Toggle camera orbit", run: () => s.toggleOrbit() },
      { id: "assume", label: "Open assumptions", run: () => s.setAssumptionsOpen(true) },
      { id: "intro", label: "Replay intro", run: () => s.setIntroOpen(true) },
      { id: "find", label: "Find a better future (not wired up yet)", disabled: true, run: () => {} },
    ];
  }, []);

  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));

  const exec = (c: Cmd | undefined) => {
    if (!c || c.disabled) return;
    setOpen(false);
    c.run();
  };

  return (
    <>
      {(
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
          style={{ background: "rgb(10 14 20 / 0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div role="dialog" aria-label="Command bar" className="panel w-[560px] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search size={16} className="text-muted" aria-hidden />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((v) => Math.min(list.length - 1, v + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((v) => Math.max(0, v - 1));
                  } else if (e.key === "Enter") exec(list[sel]);
                }}
                placeholder="Type a command"
                aria-label="Command"
                className="h-12 flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
              />
              <span className="kbd">Esc</span>
            </div>
            <ul className="max-h-[320px] overflow-y-auto p-2">
              {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matching command</li>}
              {list.map((c, i) => (
                <li key={c.id}>
                  <button
                    disabled={c.disabled}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => exec(c)}
                    className="flex w-full items-center justify-between rounded-ctl px-3 py-2 text-left text-sm disabled:opacity-50"
                    style={{ background: i === sel ? "var(--color-surface-2)" : "transparent" }}
                  >
                    <span>{c.label}</span>
                    {c.hint && <span className="kbd">{c.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </>
  );
}
