import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCitationsFromResponseText,
  normalizeCitation,
  parseRefPathDetails,
  renderApiBodyTemplate,
  withCitationInstruction,
} from "./run-chat-runner.mjs";

test("parseRefPathDetails splits ref path, pages, and scope", () => {
  assert.deepEqual(parseRefPathDetails("wra_primer_bullet_help.json (Pages 2-3; personal document scope)"), {
    ref_path: "wra_primer_bullet_help.json",
    pages: "Pages 2-3",
    scope: "personal document scope",
  });
});

test("withCitationInstruction injects exact Sources block guidance without spreadsheet refs", () => {
  const prompt = withCitationInstruction("Tell me about bullets");

  assert.match(prompt, /Tell me about bullets/);
  assert.match(prompt, /\*\*Sources\*\*/);
  assert.doesNotMatch(prompt, /Provided document references:/);
  assert.match(prompt, /Do not collapse these onto one line and do not omit labels\./);
  assert.match(prompt, /Only include a Ref path when the response itself is grounded enough to provide one\./);
});

test("extractCitationsFromResponseText preserves title, url, ref_path, pages, and scope", () => {
  const text = [
    "**Sources**",
    "",
    "- Source title: WRA Co Primer and Bullet Help",
    "URL: https://cartridge-corner.com/wrahelp.htm",
    "Ref path: wra_primer_bullet_help.json (Pages 2-3; personal document scope)",
    "- Source title: Common Bullet Types",
    "URL: https://cartridge-corner.com/Bullets.html",
    "Ref path: common_bullet_types.json (Page 1; personal document scope)",
  ].join("\n");

  assert.deepEqual(extractCitationsFromResponseText(text), [
    {
      title: "WRA Co Primer and Bullet Help",
      url: "https://cartridge-corner.com/wrahelp.htm",
      ref_path: "wra_primer_bullet_help.json",
      pages: "Pages 2-3",
      scope: "personal document scope",
    },
    {
      title: "Common Bullet Types",
      url: "https://cartridge-corner.com/Bullets.html",
      ref_path: "common_bullet_types.json",
      pages: "Page 1",
      scope: "personal document scope",
    },
  ]);
});

test("renderApiBodyTemplate safely escapes quoted multiline prompts", () => {
  const prompt = 'Line 1\nQuoted "value"';
  const body = renderApiBodyTemplate('{"messages":[{"role":"user","content":"{{query}}"}]}', prompt);

  assert.deepEqual(body, {
    messages: [{ role: "user", content: 'Line 1\nQuoted "value"' }],
  });
});

test("normalizeCitation keeps ref metadata aliases", () => {
  assert.deepEqual(
    normalizeCitation({
      title: "Alias test",
      url: "https://example.test",
      refPath: "alias.json",
      refPages: "Page 7",
      refScope: "team docs",
    }),
    {
      title: "Alias test",
      url: "https://example.test",
      ref_path: "alias.json",
      pages: "Page 7",
      scope: "team docs",
    },
  );
});
