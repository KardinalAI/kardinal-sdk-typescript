// scripts/sync-doc-examples.mjs copies the "Full payload" block of a
// case-study page, and only that block, so the test that compares an example
// plan with it does not depend on how many JSON blocks the page has before it.
import { expect, it } from "vitest";
// @ts-expect-error the script is plain JavaScript, outside the type-checked sources
import { fullPayload } from "../scripts/sync-doc-examples.mjs";

const PAGE = `# Case study

\`\`\`json
{"an": "earlier block"}
\`\`\`

<Accordion title="Full payload — ready to submit as POST /plans">

\`\`\`json
{
  "name": "full"
}
\`\`\`

</Accordion>
`;

it("takes the Full payload block, not an earlier json block", () => {
  expect(fullPayload("case-studies/x.mdx", PAGE)).toBe('{\n  "name": "full"\n}\n');
});

it("stops with a message when the page has no Full payload accordion", () => {
  expect(() => fullPayload("case-studies/x.mdx", "```json\n{}\n```\n")).toThrow(/case-studies\/x\.mdx.*Full payload/);
});

it("stops when the Full payload block is not JSON", () => {
  const page = '<Accordion title="Full payload">\n```json\n{oops\n```\n</Accordion>\n';
  expect(() => fullPayload("case-studies/x.mdx", page)).toThrow(/not valid JSON/);
});

it("does not take a json block that comes after the accordion", () => {
  const page = '<Accordion title="Full payload">\nno block here\n</Accordion>\n\n```json\n{"later": 1}\n```\n';
  expect(() => fullPayload("case-studies/x.mdx", page)).toThrow(/no ```json block/);
});
