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

// Ionic draws the window (the app lends it to the frame, app 1.6.0); this is only what is the
// tool's own: the picture, the box over it and the line under it. The colours are the app's,
// through Ionic's variables, in light and dark.
const STYLE = `
ft-redact { display: flex; flex-direction: column; height: 100%; }
ft-redact ion-content { flex: 1; }
ft-redact .ft-i {
  display: block; width: 22px; height: 22px; background: currentColor;
  -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat;
}
ft-redact .note { font-size: 12px; color: var(--ion-color-medium, inherit); }
ft-redact .stage { position: relative; display: grid; place-items: center; min-height: 160px; }
ft-redact canvas { max-width: 100%; touch-action: none; border-radius: 8px; }
ft-redact .box { position: absolute; border: 2px dashed var(--ion-color-primary, currentColor); pointer-events: none; }
`;

/** An Ionicon in a button: Ionic's own `ion-icon` when the app lent it by name, else the one the
 *  app serves at `./icon/<name>.svg`, painted in the button's colour. Never a picture of ours. */
const icon = (name) =>
  globalThis.Ionicons?.map?.has(name)
    ? `<ion-icon slot="icon-only" name="${name}" aria-hidden="true"></ion-icon>`
    : `<i slot="icon-only" class="ft-i" style="--i:url(./icon/${name}.svg)" aria-hidden="true"></i>`;

class Redact extends HTMLElement {
  constructor() {
    super();
    this.solid = true;
    this.name = "image.jpg";
    this.base = null;
    this.from = null;
  }

  connectedCallback() {
    // In the page, not in a shadow root: the frame holds only this tool, and Ionic's global
    // styles (colours, typography) do not cross a shadow boundary.
    this.innerHTML = `
      <style>${STYLE}</style>
      <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button data-act="pick" aria-label="Pick a picture">${icon("image-outline")}</ion-button>
          <ion-button data-act="solid" aria-label="Paint it black" aria-pressed="true" fill="solid" disabled>${icon("square-outline")}</ion-button>
          <ion-button data-act="mosaic" aria-label="Make it a mosaic" aria-pressed="false" disabled>${icon("grid-outline")}</ion-button>
          <ion-button data-act="undo" aria-label="Start again" disabled>${icon("arrow-undo-outline")}</ion-button>
        </ion-buttons>
        <ion-buttons slot="end">
          <ion-button data-act="send" aria-label="Send it" disabled>${icon("send-outline")}</ion-button>
        </ion-buttons>
      </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <div class="stage"><canvas></canvas><div class="box" hidden></div></div>
        <p class="note" hidden></p>
      </ion-content>
    `;
    this.canvas = this.querySelector("canvas");
    this.boxEl = this.querySelector(".box");
    this.noteEl = this.querySelector(".note");
    this.querySelector("ion-toolbar").addEventListener("click", (event) => this.onClick(event));
    this.canvas.addEventListener("pointerdown", (event) => this.onDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onUp(event));
    globalThis.ft?.onOpen?.(() => {
      if (!this.base) this.ask();
    });
  }

  onClick(event) {
    const button = event.target.closest("ion-button");
    if (!button || button.disabled) return;
    const { act } = button.dataset;
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
      this.say("That picture cannot be read");
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
      const button = this.querySelector(`[data-act="${act}"]`);
      if (button) button.disabled = !has;
    }
    for (const [act, on] of [["solid", this.solid], ["mosaic", !this.solid]]) {
      const button = this.querySelector(`[data-act="${act}"]`);
      button.fill = on ? "solid" : undefined;
      button.setAttribute("aria-pressed", String(on));
    }
    if (!has) return;

    const scale = Math.min(1, 1024 / Math.max(this.base.width, this.base.height));
    this.canvas.width = Math.max(1, Math.round(this.base.width * scale));
    this.canvas.height = Math.max(1, Math.round(this.base.height * scale));
    this.canvas.getContext("2d")?.drawImage(this.base, 0, 0, this.canvas.width, this.canvas.height);
    this.say(this.covered ? `${this.covered} covered · no EXIF` : "Drag over what should not be seen");
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
