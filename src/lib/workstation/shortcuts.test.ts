import test from "node:test";
import assert from "node:assert/strict";
import { bindingConflict, defaultShortcuts, keyBinding, matchCommand, restoreShortcuts } from "./shortcuts";

const key = (value: string, modifiers = {}) => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...modifiers });
test("chart shortcuts are focused, remappable, disableable and respect modifiers", () => {
  const prefs = defaultShortcuts();
  assert.equal(matchCommand(key("r"), prefs, "chart")?.tool, "ray");
  assert.equal(matchCommand(key("r"), prefs, "workstation"), undefined);
  assert.equal(matchCommand(key("F", { shiftKey: true }), prefs, "chart")?.id, "workspace.focus");
  prefs.bindings["tool.ray"] = "Shift+Y";
  assert.equal(matchCommand(key("r"), prefs, "chart"), undefined);
  assert.equal(matchCommand(key("Y", { shiftKey: true }), prefs, "chart")?.tool, "ray");
  prefs.singleKeys = false;
  assert.equal(matchCommand(key("Y", { shiftKey: true }), prefs, "chart"), undefined);
  assert.equal(matchCommand(key("z", { metaKey: true }), prefs, "chart")?.id, "drawing.undo");
  prefs.enabled = false;
  assert.equal(matchCommand(key("z", { ctrlKey: true }), prefs, "chart"), undefined);
});
test("conflicts, reserved browser keys and corrupt saved preferences are handled", () => {
  assert.match(bindingConflict("tool.ray", "H", defaultShortcuts())!, /Already assigned/);
  assert.match(bindingConflict("tool.ray", "Mod+R", defaultShortcuts())!, /reserved/);
  assert.match(bindingConflict("tool.ray", "Escape", defaultShortcuts())!, /normal behavior/);
  assert.equal(bindingConflict("tool.ray", "Shift+Y", defaultShortcuts()), null);
  const restored = restoreShortcuts({ version: 1, bindings: { "tool.ray": "H", "chart.date": "Mod+R", "tool.text": null } });
  assert.equal(restored.bindings["tool.ray"], null);
  assert.equal(restored.bindings["chart.date"], null);
  assert.equal(restored.bindings["tool.text"], null);
  assert.deepEqual(restoreShortcuts({ version: 99 }), defaultShortcuts());
  assert.equal(keyBinding(key("?", { shiftKey: true })), "?");
  assert.equal(keyBinding(key("Dead", { isComposing: true })), null);
});

test("new chart actions have scoped defaults and preserve existing customized keys", () => {
  const prefs = defaultShortcuts();
  for (const [letter, id] of [["B", "chart.beforeTrade"], ["T", "chart.fit"], ["E", "chart.session"]]) {
    assert.equal(matchCommand(key(letter, { shiftKey: true }), prefs, "chart")?.id, id);
    assert.equal(matchCommand(key(letter, { shiftKey: true }), prefs, "workstation"), undefined);
    const saved = restoreShortcuts({ version: 1, bindings: { "trade.next": `Shift+${letter}` } });
    assert.equal(saved.bindings["trade.next"], `Shift+${letter}`);
    assert.equal(saved.bindings[id], null);
  }
  assert.equal(restoreShortcuts({ version: 1, bindings: { "chart.session": null } }).bindings["chart.session"], null);
  assert.equal(restoreShortcuts({ version: 1, bindings: { "chart.session": "Shift+B" } }).bindings["chart.beforeTrade"], null);
});
