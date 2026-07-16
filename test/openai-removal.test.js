import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const scannedRoots = ["server", "public"];
const forbiddenActivePatterns = [
  /\bfrom\s+["']openai["']/i,
  /\brequire\(["']openai["']\)/i,
  /\bnew\s+OpenAI\b/,
  /\bOPENAI_API_KEY\b/,
  /\bOPENAI_MODEL_(?:DEFAULT|PREMIUM)\b/,
  /\bchat\.completions\b/i,
  /\bresponses\.parse\b/i,
  /\/openai\b/i
];

function filesUnder(directory) {
  const absolute = join(root, directory);
  return readdirSync(absolute).flatMap((entry) => {
    const fullPath = join(absolute, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return filesUnder(join(directory, entry));
    return /\.(js|json|html|css)$/.test(entry) ? [fullPath] : [];
  });
}

test("no existen integraciones activas con OpenAI en servidor ni frontend", () => {
  const files = [...scannedRoots.flatMap(filesUnder), join(root, "package.json")];
  const violations = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbiddenActivePatterns) {
      if (pattern.test(content)) violations.push(`${file}: ${pattern}`);
    }
  }

  assert.deepEqual(violations, []);
});
