import assert from "node:assert/strict";
import { test } from "node:test";
import { findNeighbourTrades } from "../neighbour-trades.ts";
import { normalizeTrade } from "../trades.ts";

test("findNeighbourTrades: finds nearby trades on same instrument and excludes active trade", () => {
  const active = normalizeTrade({
    id: "active-mes",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:30:00Z",
    exit_time: "2026-11-20T15:00:00Z",
    entry_price: 6840,
    exit_price: 6850,
    quantity: 1,
  });

  const nearbySameSymbol = normalizeTrade({
    id: "neighbour-1",
    symbol: "MES",
    direction: "SHORT",
    entry_time: "2026-11-20T16:00:00Z",
    exit_time: "2026-11-20T16:30:00Z",
    entry_price: 6855,
    exit_price: 6845,
    quantity: 1,
  });

  const nearbyDifferentSymbol = normalizeTrade({
    id: "diff-sym",
    symbol: "MNQ",
    direction: "LONG",
    entry_time: "2026-11-20T14:45:00Z",
    exit_time: "2026-11-20T15:15:00Z",
    entry_price: 21000,
    exit_price: 21050,
    quantity: 1,
  });

  const farAwaySameSymbol = normalizeTrade({
    id: "far-away",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-22T14:30:00Z", // 2 days later
    exit_time: "2026-11-22T15:00:00Z",
    entry_price: 6870,
    exit_price: 6880,
    quantity: 1,
  });

  const all = [active, nearbySameSymbol, nearbyDifferentSymbol, farAwaySameSymbol];
  const neighbours = findNeighbourTrades(active, all, { windowHours: 4 });

  assert.equal(neighbours.length, 1);
  assert.equal(neighbours[0].tradeId, "neighbour-1");
  assert.equal(neighbours[0].symbol, "MES");
  assert.equal(neighbours[0].direction, "SHORT");
  assert.equal(neighbours[0].isProfit, true);
  assert.equal(neighbours[0].opacity, 0.12);
});
