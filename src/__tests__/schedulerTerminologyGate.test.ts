import { execSync } from "node:child_process";
import path from "node:path";

describe("scheduler terminology gate", () => {
  it("maintained source tree has zero forbidden legacy scheduler references", () => {
    const script = path.join(process.cwd(), "scripts/check-scheduler-terminology.mjs");
    expect(() => {
      execSync(`node "${script}"`, { encoding: "utf8", stdio: "pipe" });
    }).not.toThrow();
  }, 15_000);
});
