import { test } from "node:test";
import assert from "node:assert/strict";
import { inferBuildProfile } from "../memory-bench/result.js";

test("inferBuildProfile detects release and debug paths", () => {
  assert.equal(inferBuildProfile("target/release/plethora-tauri"), "release");
  assert.equal(inferBuildProfile("src-tauri/target/debug/plethora-tauri"), "debug");
  assert.equal(inferBuildProfile("target/release/plethora-tauri", "debug"), "debug");
  assert.equal(inferBuildProfile("/foo/bar"), "debug");
});
