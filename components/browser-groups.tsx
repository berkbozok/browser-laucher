"use client";

import { useState } from "react";
import type { BrowserInfo } from "@/lib/types";

/** A named selection of browsers that the person saved. */
export type SavedGroup = { name: string; ids: string[] };

const FAMILIES: { engine: BrowserInfo["engine"]; label: string }[] = [
  { engine: "chromium", label: "Chrome family" },
  { engine: "firefox", label: "Firefox family" },
  { engine: "webkit", label: "Safari family" },
];

const chip =
  "rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs outline-none transition hover:border-zinc-500 focus-visible:ring-3 focus-visible:ring-blue-500/40 dark:border-zinc-700 dark:hover:border-zinc-400";

/**
 * Quick ways to tick a set of browsers at once: by family, or a selection
 * saved under a name.
 */
export function BrowserGroups({
  installed,
  selected,
  groups,
  onPick,
  onSave,
  onDelete,
}: {
  installed: BrowserInfo[];
  selected: ReadonlySet<string>;
  groups: SavedGroup[];
  /** Tick exactly these browsers. */
  onPick: (ids: string[]) => void;
  /** Save the current selection under this name. */
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const installedIds = new Set(installed.map((browser) => browser.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">
        Pick:
      </span>
      {FAMILIES.flatMap(({ engine, label }) => {
        const ids = installed
          .filter((browser) => browser.engine === engine)
          .map((browser) => browser.id);
        return ids.length > 1
          ? [
              <button
                key={engine}
                type="button"
                className={chip}
                onClick={() => onPick(ids)}
              >
                {label} · {ids.length}
              </button>,
            ]
          : [];
      })}

      {groups.map((group) => {
        const ids = group.ids.filter((id) => installedIds.has(id));
        return (
          <span key={group.name} className={`${chip} flex items-center gap-1 pr-1`}>
            <button
              type="button"
              className="outline-none focus-visible:underline"
              onClick={() => onPick(ids)}
            >
              {group.name} · {ids.length}
            </button>
            <button
              type="button"
              aria-label={`Delete the group ${group.name}`}
              className="rounded-full px-1 leading-none opacity-50 outline-none hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onDelete(group.name)}
            >
              ×
            </button>
          </span>
        );
      })}

      {naming ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            onSave(trimmed);
            setName("");
            setNaming(false);
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this selection"
            aria-label="Name for this selection of browsers"
            maxLength={30}
            className="h-6 w-40 rounded-full border border-zinc-300 bg-transparent px-2.5 text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
          />
          <button type="submit" className={chip}>
            Save
          </button>
          <button
            type="button"
            className={chip}
            onClick={() => {
              setName("");
              setNaming(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className={`${chip} border-dashed`}
          disabled={selected.size === 0}
          onClick={() => setNaming(true)}
        >
          + Save this selection
        </button>
      )}
    </div>
  );
}
