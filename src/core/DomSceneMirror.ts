/**
 * Miroir DOM -> Texture GPU Haute Précision (Vanilla TypeScript)
 *
 * Rastérise en temps réel les éléments lumineux, bordures, curseurs et typographies du DOM
 * dans une texture source WebGPU avec alignement métrique Skia/CoreText exact
 * (fontBoundingBoxAscent / Descent) et découpe stricte (clipping) des conteneurs.
 *
 * Zéro dépendance externe. Ne re-rastérise que lorsque le DOM, les polices,
 * le scroll ou la géométrie de la fenêtre changent (flag dirty).
 */
export class DomSceneMirror {
  private ignoreRoot: HTMLElement;
  private offscreenCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;

  private width = 0;
  private height = 0;
  private isDirty = true;

  private mutationObserver: MutationObserver | null = null;
  private bodyResizeObserver: ResizeObserver | null = null;
  private scrollHandler: (() => void) | null = null;
  private fontLoadHandler: (() => void) | null = null;
  private bgLinearColor: [number, number, number] = [0.0392, 0.0392, 0.0392]; // #0a0a0a (neutral-950)

  constructor(ignoreRoot: HTMLElement) {
    this.ignoreRoot = ignoreRoot;
    this.offscreenCanvas = document.createElement("canvas");
    this.ctx = this.offscreenCanvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
      willReadFrequently: false,
    });

    this.setupObservers();
  }

  private setupObservers(): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const targetEl =
          m.target.nodeType === Node.ELEMENT_NODE
            ? (m.target as HTMLElement)
            : m.target.parentElement;
        if (
          targetEl &&
          (this.ignoreRoot.contains(targetEl) ||
            targetEl.closest("[data-optical-ignore]"))
        ) {
          continue;
        }
        this.isDirty = true;
        break;
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-optical"],
    });

    if (typeof ResizeObserver !== "undefined") {
      this.bodyResizeObserver = new ResizeObserver(() => {
        this.isDirty = true;
      });
      this.bodyResizeObserver.observe(document.body);
    }

    this.scrollHandler = () => {
      this.isDirty = true;
    };

    window.addEventListener("scroll", this.scrollHandler, { passive: true });

    if (document.fonts) {
      document.fonts.ready.then(() => {
        this.isDirty = true;
      });
      this.fontLoadHandler = () => {
        this.isDirty = true;
      };
      document.fonts.addEventListener("loadingdone", this.fontLoadHandler);
    }
  }

  markDirty(): void {
    this.isDirty = true;
  }

  resize(deviceWidth: number, deviceHeight: number): void {
    const w = Math.max(1, Math.round(deviceWidth));
    const h = Math.max(1, Math.round(deviceHeight));
    if (this.width !== w || this.height !== h) {
      this.width = w;
      this.height = h;
      this.offscreenCanvas.width = w;
      this.offscreenCanvas.height = h;
      this.isDirty = true;
    }
  }

  getBackgroundColor(): [number, number, number] {
    return this.bgLinearColor;
  }

  /**
   * Met à jour la texture WebGPU cible si la scène DOM a changé.
   * Retourne `true` si la texture GPU a été ré-écrite.
   */
  syncToGpuTexture(device: GPUDevice, targetTexture: GPUTexture): boolean {
    if (!this.isDirty || !this.ctx || this.width === 0 || this.height === 0) {
      return false;
    }

    this.isDirty = false;
    this.rasterizeDomScene();

    try {
      device.queue.copyExternalImageToTexture(
        { source: this.offscreenCanvas, flipY: false },
        { texture: targetTexture, premultipliedAlpha: true },
        { width: this.width, height: this.height },
      );
      return true;
    } catch (err) {
      console.warn("[DomSceneMirror] Échec de copie vers GPUTexture :", err);
      return false;
    }
  }

  private parseColorAlpha(cssColor: string): number {
    if (
      !cssColor ||
      cssColor === "transparent" ||
      cssColor === "rgba(0, 0, 0, 0)"
    ) {
      return 0;
    }
    const rgbMatch = cssColor.match(
      /rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i,
    );
    if (rgbMatch) {
      if (rgbMatch[1] === undefined) return 1.0;
      return rgbMatch[1].endsWith("%")
        ? Number.parseFloat(rgbMatch[1]) / 100
        : Number.parseFloat(rgbMatch[1]);
    }
    const slashMatch = cssColor.match(/\/\s*([\d.]+%?)\s*\)/);
    if (slashMatch) {
      return slashMatch[1].endsWith("%")
        ? Number.parseFloat(slashMatch[1]) / 100
        : Number.parseFloat(slashMatch[1]);
    }
    return 1.0;
  }

  private getEffectiveOpacity(el: HTMLElement): number {
    let opacity = 1.0;
    let curr: HTMLElement | null = el;
    while (
      curr &&
      curr !== document.body &&
      curr !== document.documentElement
    ) {
      const s = window.getComputedStyle(curr);
      const op = Number.parseFloat(s.opacity);
      if (!Number.isNaN(op)) {
        opacity *= op;
      }
      if (opacity <= 0.01) return 0;
      curr = curr.parentElement;
    }
    return Math.max(0, Math.min(1, opacity));
  }

  /**
   * Calcule le rectangle de découpe (clipping) effectif d'un élément
   * en intersectant tous ses parents ayant un overflow caché/scrollable
   * ainsi que les bornes horizontales de son parent direct.
   */
  private getClippingRect(
    el: HTMLElement,
    cssW: number,
    cssH: number,
  ): { left: number; top: number; right: number; bottom: number } {
    const margin = 4;
    let left = margin;
    let top = margin;
    let right = cssW - margin;
    let bottom = cssH - margin;

    const parentRect = el.getBoundingClientRect();
    left = Math.max(left, parentRect.left - 2);
    right = Math.min(right, parentRect.right + 2);

    let curr: HTMLElement | null = el;
    while (
      curr &&
      curr !== document.body &&
      curr !== document.documentElement
    ) {
      const s = window.getComputedStyle(curr);
      const ox = s.overflowX;
      const oy = s.overflowY;
      const clipsX =
        ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll";
      const clipsY =
        oy === "hidden" || oy === "clip" || oy === "auto" || oy === "scroll";

      if (clipsX || clipsY) {
        const r = curr.getBoundingClientRect();
        if (clipsX) {
          left = Math.max(left, r.left);
          right = Math.min(right, r.right);
        }
        if (clipsY) {
          top = Math.max(top, r.top);
          bottom = Math.min(bottom, r.bottom);
        }
      }
      curr = curr.parentElement;
    }

    return { left, top, right, bottom };
  }

  private applyTextTransform(raw: string, transform: string): string {
    if (transform === "uppercase") return raw.toUpperCase();
    if (transform === "lowercase") return raw.toLowerCase();
    if (transform === "capitalize") {
      return raw.replace(/\b\w/g, (l) => l.toUpperCase());
    }
    return raw;
  }

  private normalizeLineWhitespace(raw: string, whiteSpace: string): string {
    if (
      whiteSpace === "pre" ||
      whiteSpace === "pre-wrap" ||
      whiteSpace === "break-spaces"
    ) {
      return raw.replace(/\r?\n/g, "").replace(/\s+$/, "");
    }
    return raw.replace(/\s+/g, " ").trim();
  }

  private renderWrappedTextByLines(
    ctx: CanvasRenderingContext2D,
    textNode: Text,
    style: CSSStyleDeclaration,
    cssW: number,
    cssH: number,
    lineRange: Range,
  ): void {
    const raw = textNode.nodeValue || "";
    const len = raw.length;
    if (len === 0) return;

    let lineStart = 0;
    let currentLineTop: number | null = null;
    let currentLineHeight = 16;
    let currentLineLeft = Number.POSITIVE_INFINITY;

    const flushLine = (
      start: number,
      end: number,
      top: number | null,
      left: number,
      height: number,
    ) => {
      if (top === null || !Number.isFinite(left) || end <= start) return;
      if (top + height < -32 || top > cssH + 32 || left > cssW - 4) {
        return;
      }
      const slice = this.normalizeLineWhitespace(
        raw.slice(start, end),
        style.whiteSpace,
      );
      if (!slice) return;

      const displayText = this.applyTextTransform(slice, style.textTransform);
      const metrics = ctx.measureText(displayText);
      const ascent =
        metrics.fontBoundingBoxAscent ??
        metrics.actualBoundingBoxAscent ??
        height * 0.78;
      const descent =
        metrics.fontBoundingBoxDescent ??
        metrics.actualBoundingBoxDescent ??
        height * 0.22;
      const baselineY = top + (height + ascent - descent) * 0.5;
      ctx.fillText(displayText, left, baselineY);
    };

    for (let i = 0; i < len; i++) {
      const ch = raw[i];
      if (ch === "\n") {
        flushLine(
          lineStart,
          i,
          currentLineTop,
          currentLineLeft,
          currentLineHeight,
        );
        lineStart = i + 1;
        currentLineTop = null;
        currentLineLeft = Number.POSITIVE_INFINITY;
        continue;
      }

      // Ignorer les espaces pour la détection de saut de ligne souple :
      // en Blink/WebKit, un espace en fin de ligne wrappée peut avoir width=0
      // avec left au bord droit de la ligne 1 et top sur la ligne 2.
      if (ch === " " || ch === "\t" || ch === "\r") {
        continue;
      }

      lineRange.setStart(textNode, i);
      lineRange.setEnd(textNode, i + 1);
      const charRects = lineRange.getClientRects();
      if (charRects.length === 0) continue;
      const cRect = charRects[0];
      if (cRect.width <= 0.2 || cRect.height <= 0.2) continue;

      if (currentLineTop === null) {
        currentLineTop = cRect.top;
        currentLineHeight = cRect.height;
        currentLineLeft = cRect.left;
      } else if (Math.abs(cRect.top - currentLineTop) > 4.0) {
        flushLine(
          lineStart,
          i,
          currentLineTop,
          currentLineLeft,
          currentLineHeight,
        );
        lineStart = i;
        currentLineTop = cRect.top;
        currentLineHeight = cRect.height;
        currentLineLeft = cRect.left;
      } else if (cRect.left < currentLineLeft) {
        currentLineLeft = cRect.left;
      }
    }

    flushLine(
      lineStart,
      len,
      currentLineTop,
      currentLineLeft,
      currentLineHeight,
    );
  }

  private drawElementBoxAndBorders(
    ctx: CanvasRenderingContext2D,
    el: HTMLElement,
    style: CSSStyleDeclaration,
    cssW: number,
    cssH: number,
  ): void {
    const tag = el.tagName;
    if (tag === "BODY" || tag === "HTML" || tag === "MAIN") {
      return;
    }

    const rect = el.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 4 ||
      rect.top >= cssH - 4 ||
      rect.right <= 4 ||
      rect.left >= cssW - 4
    ) {
      return;
    }

    const bgAlpha = this.parseColorAlpha(style.backgroundColor);
    const bt = Number.parseFloat(style.borderTopWidth) || 0;
    const br = Number.parseFloat(style.borderRightWidth) || 0;
    const bb = Number.parseFloat(style.borderBottomWidth) || 0;
    const bl = Number.parseFloat(style.borderLeftWidth) || 0;
    const hasBorder = bt > 0 || br > 0 || bb > 0 || bl > 0;

    if (bgAlpha <= 0.02 && !hasBorder) {
      return;
    }

    const effOpacity = this.getEffectiveOpacity(el);
    if (effOpacity <= 0.01) return;

    const radius = Math.min(
      rect.width * 0.5,
      rect.height * 0.5,
      Number.parseFloat(style.borderTopLeftRadius) || 0,
    );

    ctx.save();
    ctx.globalAlpha = effOpacity;

    // 1. Fond de l'élément (LED, curseur clignotant, boutons, badges)
    if (bgAlpha > 0.02) {
      ctx.fillStyle = style.backgroundColor;
      ctx.beginPath();
      if (radius > 0.5 && typeof ctx.roundRect === "function") {
        ctx.roundRect(rect.left, rect.top, rect.width, rect.height, radius);
      } else {
        ctx.rect(rect.left, rect.top, rect.width, rect.height);
      }
      ctx.fill();
    }

    // 2. Bordures de l'élément (cadres de boutons, séparateurs header/footer/dividers, inputs)
    if (hasBorder) {
      if (bt > 0 && br > 0 && bb > 0 && bl > 0) {
        const borderAlpha = this.parseColorAlpha(style.borderTopColor);
        if (borderAlpha > 0.02) {
          ctx.strokeStyle = style.borderTopColor;
          ctx.lineWidth = bt;
          ctx.beginPath();
          const half = bt * 0.5;
          if (radius > 0.5 && typeof ctx.roundRect === "function") {
            ctx.roundRect(
              rect.left + half,
              rect.top + half,
              Math.max(1, rect.width - bt),
              Math.max(1, rect.height - bt),
              Math.max(0, radius - half),
            );
          } else {
            ctx.rect(
              rect.left + half,
              rect.top + half,
              Math.max(1, rect.width - bt),
              Math.max(1, rect.height - bt),
            );
          }
          ctx.stroke();
        }
      } else {
        if (bt > 0 && this.parseColorAlpha(style.borderTopColor) > 0.02) {
          ctx.fillStyle = style.borderTopColor;
          ctx.fillRect(rect.left, rect.top, rect.width, bt);
        }
        if (bb > 0 && this.parseColorAlpha(style.borderBottomColor) > 0.02) {
          ctx.fillStyle = style.borderBottomColor;
          ctx.fillRect(rect.left, rect.bottom - bb, rect.width, bb);
        }
        if (bl > 0 && this.parseColorAlpha(style.borderLeftColor) > 0.02) {
          ctx.fillStyle = style.borderLeftColor;
          ctx.fillRect(rect.left, rect.top, bl, rect.height);
        }
        if (br > 0 && this.parseColorAlpha(style.borderRightColor) > 0.02) {
          ctx.fillStyle = style.borderRightColor;
          ctx.fillRect(rect.right - br, rect.top, br, rect.height);
        }
      }
    }

    ctx.restore();
  }

  private rasterizeDomScene(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const rootRect = this.ignoreRoot.getBoundingClientRect();
    const cssW =
      rootRect.width ||
      document.documentElement.clientWidth ||
      window.innerWidth ||
      1;
    const cssH =
      rootRect.height ||
      document.documentElement.clientHeight ||
      window.innerHeight ||
      1;
    const scaleX = this.width / cssW;
    const scaleY = this.height / cssH;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Fond de scène noir profond (#0a0a0a) pour la reconstruction optique CRT sans éblouissement
    this.bgLinearColor = [0.0392, 0.0392, 0.0392];

    ctx.scale(scaleX, scaleY);
    ctx.textBaseline = "alphabetic";

    // Marge de sécurité matérielle de 4px sur les 4 bords de la texture WebGPU :
    // garantit que les texels extrêmes (uv = 0.0 et uv = 1.0) sont toujours à rgba(0,0,0,0),
    // empêchant tout étirement (clamp-to-edge smearing) sur le bord droit du tube CRT !
    const safeBorderPx = 4;
    ctx.beginPath();
    ctx.rect(
      safeBorderPx,
      safeBorderPx,
      Math.max(1, cssW - safeBorderPx * 2),
      Math.max(1, cssH - safeBorderPx * 2),
    );
    ctx.clip();

    const range = document.createRange();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (this.ignoreRoot.contains(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            if (el.hasAttribute("data-optical-ignore")) {
              return NodeFilter.FILTER_REJECT;
            }
            const tag = el.tagName;
            if (
              tag === "SCRIPT" ||
              tag === "STYLE" ||
              tag === "NOSCRIPT" ||
              tag === "HEAD" ||
              tag === "META"
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            const style = window.getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number.parseFloat(style.opacity) <= 0.01
            ) {
              return NodeFilter.FILTER_REJECT;
            }
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let currentNode: Node | null = walker.nextNode();
    while (currentNode) {
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        const el = currentNode as HTMLElement;
        const style = window.getComputedStyle(el);

        if (
          el instanceof HTMLImageElement &&
          el.complete &&
          el.naturalWidth > 0
        ) {
          const rect = el.getBoundingClientRect();
          if (
            rect.bottom > safeBorderPx &&
            rect.top < cssH - safeBorderPx &&
            rect.right > safeBorderPx &&
            rect.left < cssW - safeBorderPx &&
            rect.width > 0 &&
            rect.height > 0
          ) {
            try {
              ctx.save();
              ctx.globalAlpha = this.getEffectiveOpacity(el);
              ctx.drawImage(el, rect.left, rect.top, rect.width, rect.height);
              ctx.restore();
            } catch {
              // Ignorer les images cross-origin non-CORS
            }
          }
        } else {
          this.drawElementBoxAndBorders(ctx, el, style, cssW, cssH);
        }
      } else if (currentNode.nodeType === Node.TEXT_NODE) {
        const rawText = currentNode.nodeValue;
        const parent = currentNode.parentElement;
        if (rawText && rawText.trim().length > 0 && parent) {
          const style = window.getComputedStyle(parent);
          const effOpacity = this.getEffectiveOpacity(parent);
          if (effOpacity > 0.01) {
            range.selectNodeContents(currentNode);
            const rects = range.getClientRects();

            if (rects.length > 0) {
              const clipBox = this.getClippingRect(parent, cssW, cssH);
              const clipW = clipBox.right - clipBox.left;
              const clipH = clipBox.bottom - clipBox.top;

              if (clipW > 1 && clipH > 1) {
                ctx.save();
                ctx.globalAlpha = effOpacity;
                ctx.beginPath();
                ctx.rect(clipBox.left, clipBox.top, clipW, clipH);
                ctx.clip();

                const fontWeight = style.fontWeight || "400";
                const fontStyle = style.fontStyle || "normal";
                const fontSize = style.fontSize || "16px";
                const fontFamily = style.fontFamily || "sans-serif";
                ctx.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
                ctx.fillStyle = style.color || "#ffffff";

                const letterSpacing = style.letterSpacing;
                if (
                  "letterSpacing" in ctx &&
                  letterSpacing &&
                  letterSpacing !== "normal"
                ) {
                  (
                    ctx as CanvasRenderingContext2D & { letterSpacing: string }
                  ).letterSpacing = letterSpacing;
                } else if ("letterSpacing" in ctx) {
                  (
                    ctx as CanvasRenderingContext2D & { letterSpacing: string }
                  ).letterSpacing = "0px";
                }

                if (rects.length === 1) {
                  const rect = rects[0];
                  if (
                    rect.bottom >= safeBorderPx &&
                    rect.top <= cssH - safeBorderPx &&
                    rect.right >= safeBorderPx &&
                    rect.left <= cssW - safeBorderPx
                  ) {
                    const preservedText =
                      style.whiteSpace === "pre" ||
                        style.whiteSpace === "pre-wrap" ||
                        style.whiteSpace === "break-spaces"
                        ? rawText.replace(/\r?\n/g, "")
                        : rawText.trim();
                    const displayText = this.applyTextTransform(
                      preservedText,
                      style.textTransform,
                    );
                    const metrics = ctx.measureText(displayText);
                    const ascent =
                      metrics.fontBoundingBoxAscent ??
                      metrics.actualBoundingBoxAscent ??
                      rect.height * 0.78;
                    const descent =
                      metrics.fontBoundingBoxDescent ??
                      metrics.actualBoundingBoxDescent ??
                      rect.height * 0.22;

                    const baselineY =
                      rect.top + (rect.height + ascent - descent) * 0.5;
                    ctx.fillText(displayText, rect.left, baselineY);
                  }
                } else {
                  const rect = range.getBoundingClientRect();
                  if (
                    rect.bottom >= safeBorderPx &&
                    rect.top <= cssH - safeBorderPx &&
                    rect.right >= safeBorderPx &&
                    rect.left <= cssW - safeBorderPx
                  ) {
                    this.renderWrappedTextByLines(
                      ctx,
                      currentNode as Text,
                      style,
                      cssW,
                      cssH,
                      range,
                    );
                  }
                }

                ctx.restore();
              }
            }
          }
        }
      }

      currentNode = walker.nextNode();
    }

    ctx.restore();
  }

  destroy(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.bodyResizeObserver) {
      this.bodyResizeObserver.disconnect();
      this.bodyResizeObserver = null;
    }
    if (this.scrollHandler && typeof window !== "undefined") {
      window.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = null;
    }
    if (
      this.fontLoadHandler &&
      typeof document !== "undefined" &&
      document.fonts
    ) {
      document.fonts.removeEventListener("loadingdone", this.fontLoadHandler);
      this.fontLoadHandler = null;
    }
  }
}
