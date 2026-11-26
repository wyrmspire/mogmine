import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const target = await fetch("http://127.0.0.1:9224/json/new?http://localhost:3124/trades/mes-opening-scalp", { method: "PUT" }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(String(data));
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, timeout = 15_000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out: ${expression}`);
};
const clickText = (text) => evaluate(`(() => {
  const item = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === ${JSON.stringify(text)});
  if (!item) return false; item.click(); return true;
})()`);
const screenshot = async (path) => {
  const result = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(path, Buffer.from(result.data, "base64"));
};

try {
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor(`document.readyState === "complete" && Boolean(document.querySelector("button"))`);
  try {
    await waitFor(`Boolean([...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Indicators"))`);
  } catch (error) {
    console.error("Page text:", await evaluate(`document.body.innerText.slice(0, 2000)`));
    throw error;
  }
  await waitFor(`Boolean(document.querySelector("[data-ready]"))`, 20_000);
  const initial = await evaluate(`({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, ready: Boolean(document.querySelector("[data-ready]")) })`);
  assert.deepEqual({ width: initial.width, height: initial.height }, { width: 390, height: 844 });
  assert.ok(initial.scrollWidth <= 390, `horizontal overflow: ${initial.scrollWidth}`);

  assert.equal(await clickText("Indicators"), true);
  await waitFor(`Boolean([...document.querySelectorAll("button")].find((button) => button.textContent.includes("Add indicator")))`);
  assert.equal(await clickText("＋ Add indicator"), true);
  await waitFor(`Boolean([...document.querySelectorAll("button")].find((button) => button.textContent.includes("ADR bands")))`);
  assert.equal(await clickText("ADR bandsAverage daily range bands, anchored to a session open.＋"), true);
  await waitFor(`document.body.textContent.includes("Inner multiplier") && document.body.textContent.includes("Days back")`);
  const settings = await evaluate(`({
    scrollWidth: document.documentElement.scrollWidth,
    length: document.querySelector('input[type="number"]')?.value,
    hasAnchor: [...document.querySelectorAll("option")].some((option) => option.textContent.includes("RTH open"))
  })`);
  assert.equal(settings.length, "14");
  assert.equal(settings.hasAnchor, true);
  assert.ok(settings.scrollWidth <= 390, `settings overflow: ${settings.scrollWidth}`);
  await screenshot("ik3-mobile-adr-settings.png");
  assert.equal(await clickText("Style"), true);
  await waitFor(`document.body.textContent.includes("Band fill")`);
  await screenshot("ik3-mobile-adr-style.png");

  assert.equal(await clickText("← Active indicators"), true);
  await waitFor(`document.body.textContent.includes("ADR 14")`);
  assert.equal(await clickText("＋ Add indicator"), true);
  assert.equal(await clickText("ADR bandsAverage daily range bands, anchored to a session open.＋"), true);
  assert.equal(await clickText("← Active indicators"), true);
  await waitFor(`document.body.textContent.match(/ADR 14/g)?.length >= 2`);
  const active = await evaluate(`({ adrCount: [...document.querySelectorAll("button")].filter((button) => button.textContent.includes("ADR 14")).length, scrollWidth: document.documentElement.scrollWidth })`);
  assert.ok(active.adrCount >= 2, `ADR instances: ${active.adrCount}`);
  assert.ok(active.scrollWidth <= 390, `active list overflow: ${active.scrollWidth}`);
  await screenshot("ik3-mobile-indicators.png");
  console.log("IK-3 mobile check passed:", { initial, settings, active });
} finally {
  socket.close();
}
