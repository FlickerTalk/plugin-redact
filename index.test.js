// The plugin's own tests (Plan §53): what is covered is covered in the pixels themselves, so the
// picture that leaves the phone no longer holds what was underneath.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blocksOf, normalRect, outName } from "./dist/index.js";
import source from "./dist/index.js?raw";
import manifest from "./module.json";

// The app's languages (plugin-sdk, module.schema.json): English is the top level.
const languages = ["es", "pt", "fr", "de", "it", "ro", "ru", "uk", "pl", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];

// The schema counts characters, not UTF-16 units.
const length = (text) => [...text].length;

describe("manifest", () => {
  it("names and sums itself up in every language of the app", () => {
    expect(Object.keys(manifest.locales ?? {})).toEqual(languages);
    for (const code of languages) {
      const { name, summary, ...rest } = manifest.locales[code];
      expect(rest, code).toEqual({});
      expect(name?.trim(), code).toBeTruthy();
      expect(length(name), code).toBeLessThanOrEqual(64);
      expect(summary?.trim(), code).toBeTruthy();
      expect(length(summary), code).toBeLessThanOrEqual(200);
    }
  });

  // What it makes goes to the chat through ft.send or ft.say, which the core refuses without the
  // send permission (A2): the manifest has to ask for it, or the main action does nothing.
  it("asks to write in the chat, since it puts its result there", () => {
    expect(source).toMatch(/\bft\??\.(send|say)\(/);
    expect(manifest.permissions.send).toBe("propose");
  });
});

describe("cover", () => {
  it("turns a drag into a box inside the picture", () => {
    expect(normalRect({ x: 60, y: 80 }, { x: 20, y: 20 }, { width: 100, height: 100 })).toEqual({
      x: 20,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("ignores a tap that covers nothing", () => {
    expect(normalRect({ x: 10, y: 10 }, { x: 12, y: 12 }, { width: 100, height: 100 })).toBe(null);
  });

  // The mosaic is drawn block by block, so nothing of what was there survives in between.
  it("cuts a box into blocks that cover it whole", () => {
    const blocks = blocksOf({ x: 0, y: 0, width: 20, height: 10 }, 8);
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    const last = blocks[blocks.length - 1];
    expect(last.x + last.width).toBe(20);
    expect(last.y + last.height).toBe(10);
  });

  it("is one block when the box is smaller than one", () => {
    expect(blocksOf({ x: 5, y: 5, width: 4, height: 4 }, 16)).toEqual([{ x: 5, y: 5, width: 4, height: 4 }]);
  });

  it("names what it made after what it was given", () => {
    expect(outName("passport.png")).toBe("passport-covered.jpg");
    expect(outName("")).toBe("image-covered.jpg");
  });

  it("is a custom element the frame can show", () => {
    expect(customElements.get("ft-redact")).toBeTruthy();
  });
});

describe("the image of the Apps grid", () => {
  // icon.svg beside module.json and dist/, signed with the rest: the app draws it on the tile; the
  // Ionicon in module.json stays as the fallback (2026-10-08).
  const image = join(import.meta.dirname, "icon.svg");

  it("is a square 64 × 64 SVG of at most 4 KB at the root of the package, and not inside dist/", () => {
    expect(existsSync(image), "icon.svg").toBe(true);
    expect(statSync(image).size).toBeLessThanOrEqual(4096);
    const svg = readFileSync(image, "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(existsSync(join(import.meta.dirname, "dist", "icon.svg"))).toBe(false);
  });
});
