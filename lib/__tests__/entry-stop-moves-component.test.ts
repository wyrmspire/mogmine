import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import type { DraftStopMove } from "../entry-form.ts";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
Object.assign(globalThis, { React: require("react") });
const jiti = createJiti(fileURLToPath(import.meta.url), {
  jsx: true,
  alias: { "@": fileURLToPath(new URL("../..", import.meta.url)) },
});
const { EntryStopMoves } = jiti("../../components/EntryStopMoves.tsx");

test("EntryStopMoves keeps validation errors visible while the empty section is collapsed", () => {
  const markup = renderToStaticMarkup(createElement(EntryStopMoves, {
    symbol: "MES",
    stopPrice: "",
    entryPrice: "6000",
    exitClock: "14:30",
    zone: "America/Chicago",
    rows: [] as DraftStopMove[],
    error: "Enter the initial stop above first.",
    widened: false,
    quickTags: [],
    onRows: () => undefined,
    onAcceptTag: () => undefined,
  }));

  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /role="alert">Enter the initial stop above first\.<\/span>/);
});
