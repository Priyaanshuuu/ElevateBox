import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ATTRIBUTION,
  attributionEmailHref,
  attributionLine,
} from "../lib/attribution.ts";

const repoRoot = new URL("../../", import.meta.url);
const footerSource = readFileSync(
  new URL("../app/showcase/page.tsx", import.meta.url),
  "utf8",
);
const notice = readFileSync(new URL("NOTICE", repoRoot), "utf8");
const gitignore = readFileSync(
  new URL("../.gitignore", import.meta.url),
  "utf8",
);

describe("showcase attribution", () => {
  it("keeps the author's exact details in the tracked source", () => {
    assert.equal(ATTRIBUTION.author, "Priyanshu Sinha");
    assert.equal(ATTRIBUTION.email, "priyanshusinha636@gmail.com");
    assert.equal(ATTRIBUTION.project, "Voice Sales · ElevateBox");
    assert.equal(
      ATTRIBUTION.linkedin,
      "https://www.linkedin.com/in/priyanshu-sinha-519147225/",
    );
    assert.equal(ATTRIBUTION.x, "https://x.com/Priyyaanshuuu");
    assert.equal(attributionEmailHref, "mailto:priyanshusinha636@gmail.com");
    assert.equal(attributionLine, "Priyanshu Sinha · priyanshusinha636@gmail.com");
  });

  it("renders the credit and social links from the shared source", () => {
    assert.match(footerSource, /href=\{attributionEmailHref\}/);
    assert.match(footerSource, /href=\{ATTRIBUTION\.linkedin\}/);
    assert.match(footerSource, /href=\{ATTRIBUTION\.x\}/);
    assert.match(footerSource, /\{ATTRIBUTION\.author\}/);
    assert.match(footerSource, /\{ATTRIBUTION\.project\}/);
    assert.match(footerSource, /\{attributionLine\}/);

    // Details must not be hardcoded in the page: removal has to happen in the
    // guarded module, which is exactly what this gate prevents.
    assert.equal(footerSource.includes("priyanshusinha636@gmail.com"), false);
    assert.equal(footerSource.includes("priyanshu-sinha-519147225"), false);
    assert.equal(footerSource.includes("Priyyaanshuuu"), false);
  });

  it("does not store or render a phone number", () => {
    assert.equal("phone" in ATTRIBUTION, false);
    assert.equal(footerSource.includes("attributionPhoneHref"), false);
    assert.equal(footerSource.includes("tel:"), false);
    assert.equal(footerSource.includes("83177"), false);
    assert.equal(notice.includes("+918317733528"), false);
  });

  it("keeps the repository notice intact", () => {
    assert.match(notice, /Priyanshu Sinha/);
    assert.match(notice, /priyanshusinha636@gmail\.com/);
    assert.match(notice, /linkedin\.com\/in\/priyanshu-sinha-519147225\//);
    assert.match(notice, /x\.com\/Priyyaanshuuu/);
  });

  it("does not hide attribution files in .gitignore", () => {
    const ignored = gitignore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    for (const file of ["lib/attribution.ts", "app/showcase/page.tsx"]) {
      assert.equal(
        ignored.some((line) => file.includes(line.replace(/^\//, ""))),
        false,
        `${file} must stay tracked`,
      );
    }
  });
});
