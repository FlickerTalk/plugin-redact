// Cover what should not be seen, for FlickerTalk (Plan §53–§55): drag over a face, a name or a
// number and it is painted over — in the pixels, not on top of them. The picture is written again
// before it goes, so nothing of what was underneath, and nothing the camera wrote, is left.

/** A drag, whichever way it went, as a box inside the picture. A tap covers nothing. */
export function normalRect(from, to, bounds) {
  const left = Math.max(0, Math.min(from.x, to.x));
  const top = Math.max(0, Math.min(from.y, to.y));
  const right = Math.min(bounds.width, Math.max(from.x, to.x));
  const bottom = Math.min(bounds.height, Math.max(from.y, to.y));
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width < 6 || height < 6) return null;
  return { x: Math.round(left), y: Math.round(top), width, height };
}

/** The blocks of a mosaic over that box; the last ones are cut short so the box is covered whole. */
export function blocksOf(rect, cell) {
  const blocks = [];
  for (let y = rect.y; y < rect.y + rect.height; y += cell) {
    for (let x = rect.x; x < rect.x + rect.width; x += cell) {
      blocks.push({
        x,
        y,
        width: Math.min(cell, rect.x + rect.width - x),
        height: Math.min(cell, rect.y + rect.height - y),
      });
    }
  }
  return blocks;
}

/** What the picture is called once something in it has been covered. */
export function outName(name) {
  const base = String(name).split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "") ?? "";
  return `${base.trim() || "image"}-covered.jpg`;
}

/** How big a mosaic block is, as a share of the longest side: coarse enough to hide a face. */
const CELL = 0.035;

const STYLE = `
:host { display: block; font: 14px system-ui, sans-serif; color: #111; }
@media (prefers-color-scheme: dark) { :host { color: #f4f4f4; } }
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 0 10px; }
button {
  appearance: none; border: 1px solid currentColor; background: transparent; color: inherit;
  border-radius: 10px; min-width: 44px; height: 40px; font-size: 18px; cursor: pointer; opacity: .75;
}
button:disabled { opacity: .25; }
button.on { opacity: 1; background: currentColor; }
button.on > span { filter: invert(1); }
.grow { flex: 1; }
.note { font-size: 12px; opacity: .6; }
.stage { position: relative; display: grid; place-items: center; min-height: 160px; }
canvas { max-width: 100%; touch-action: none; border-radius: 8px; }
.box { position: absolute; border: 2px dashed currentColor; pointer-events: none; }
`;

class Redact extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.solid = true;
    this.name = "image.jpg";
    this.base = null;
    this.from = null;
  }

  connectedCallback() {
    this.root.innerHTML = `
      <style>${STYLE}</style>
      <div class="bar">
        <button data-act="pick" aria-label="Pick a picture"><span>🖼️</span></button>
        <button data-act="solid" aria-label="Paint it black" disabled><span>⬛</span></button>
        <button data-act="mosaic" aria-label="Make it a mosaic" disabled><span>🔳</span></button>
        <button data-act="undo" aria-label="Start again" disabled><span>↩️</span></button>
        <span class="grow"></span>
        <button data-act="send" aria-label="Send it" disabled><span>➤</span></button>
      </div>
      <div class="stage"><canvas></canvas><div class="box" hidden></div></div>
      <p class="note" hidden></p>
    `;
    this.canvas = this.root.querySelector("canvas");
    this.boxEl = this.root.querySelector(".box");
    this.noteEl = this.root.querySelector(".note");
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.canvas.addEventListener("pointerdown", (event) => this.onDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onUp(event));
    globalThis.ft?.onOpen(() => {
      if (!this.base) this.ask();
    });
  }

  onClick(event) {
    const act = event.target.closest("button")?.dataset.act;
    if (act === "pick") this.ask();
    else if (act === "solid") this.pick(true);
    else if (act === "mosaic") this.pick(false);
    else if (act === "undo") this.again();
    else if (act === "send") this.send();
  }

  async ask() {
    const picked = await globalThis.ft.pickFile("image/*");
    if (!picked) return;
    this.name = picked.name;
    const image = new Image();
    image.src = `data:${picked.mime || "image/jpeg"};base64,${picked.data}`;
    await image.decode().catch(() => {});
    if (!image.naturalWidth) {
      this.say("😕");
      return;
    }
    this.source = image;
    this.again();
  }

  pick(solid) {
    this.solid = solid;
    this.show();
  }

  /** Back to the picture as it was picked: everything covered comes back. */
  again() {
    if (!this.source) return;
    const canvas = document.createElement("canvas");
    canvas.width = this.source.naturalWidth;
    canvas.height = this.source.naturalHeight;
    canvas.getContext("2d")?.drawImage(this.source, 0, 0);
    this.base = canvas;
    this.covered = 0;
    this.show();
  }

  /** Where a pointer is, in the picture's own pixels. */
  at(event) {
    const box = this.canvas.getBoundingClientRect();
    const scale = this.base.width / (box.width || 1);
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  }

  onDown(event) {
    if (!this.base) return;
    this.from = this.at(event);
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  onMove(event) {
    if (!this.from) return;
    const rect = normalRect(this.from, this.at(event), this.base);
    if (rect) this.outline(rect);
  }

  onUp(event) {
    if (!this.from) return;
    const rect = normalRect(this.from, this.at(event), this.base);
    this.from = null;
    this.boxEl.hidden = true;
    if (!rect) return;
    this.cover(rect);
    this.covered += 1;
    this.show();
  }

  /** Paints over that box, once and for good, in the picture itself. */
  cover(rect) {
    const context = this.base.getContext("2d");
    if (!context) return;
    if (this.solid) {
      context.fillStyle = "#000";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    }
    const cell = Math.max(6, Math.round(Math.max(this.base.width, this.base.height) * CELL));
    for (const block of blocksOf(rect, cell)) {
      const { data } = context.getImageData(block.x, block.y, block.width, block.height);
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let at = 0; at < data.length; at += 4) {
        red += data[at];
        green += data[at + 1];
        blue += data[at + 2];
      }
      const pixels = Math.max(1, data.length / 4);
      context.fillStyle = `rgb(${Math.round(red / pixels)},${Math.round(green / pixels)},${Math.round(blue / pixels)})`;
      context.fillRect(block.x, block.y, block.width, block.height);
    }
  }

  outline(rect) {
    const box = this.canvas.getBoundingClientRect();
    const scale = (box.width || 1) / this.base.width;
    Object.assign(this.boxEl.style, {
      left: `${this.canvas.offsetLeft + rect.x * scale}px`,
      top: `${this.canvas.offsetTop + rect.y * scale}px`,
      width: `${rect.width * scale}px`,
      height: `${rect.height * scale}px`,
    });
    this.boxEl.hidden = false;
  }

  show() {
    const has = Boolean(this.base);
    for (const act of ["solid", "mosaic", "undo", "send"]) {
      const button = this.root.querySelector(`[data-act="${act}"]`);
      if (button) button.disabled = !has;
    }
    this.root.querySelector('[data-act="solid"]').classList.toggle("on", this.solid);
    this.root.querySelector('[data-act="mosaic"]').classList.toggle("on", !this.solid);
    if (!has) return;

    const scale = Math.min(1, 1024 / Math.max(this.base.width, this.base.height));
    this.canvas.width = Math.max(1, Math.round(this.base.width * scale));
    this.canvas.height = Math.max(1, Math.round(this.base.height * scale));
    this.canvas.getContext("2d")?.drawImage(this.base, 0, 0, this.canvas.width, this.canvas.height);
    this.say(this.covered ? `${this.covered} ⬛ · 🚫📍` : "👆");
  }

  send() {
    if (!this.base) return;
    let made = "";
    try {
      made = this.base.toDataURL("image/jpeg", 0.85);
    } catch {
      return;
    }
    globalThis.ft.send(outName(this.name), "image/jpeg", made.split(",")[1] ?? "");
  }

  say(text) {
    this.noteEl.textContent = text;
    this.noteEl.hidden = !text;
  }
}

customElements.define("ft-redact", Redact);
