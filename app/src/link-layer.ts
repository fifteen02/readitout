import type { PdfDocument, PdfPage, PdfViewport } from "./types";
import type { LinkPreview } from "./link-preview";

export async function buildLinkLayer(
  page: PdfPage,
  viewport: PdfViewport,
  pdf: PdfDocument,
  goToPage: (n: number) => void,
  preview?: LinkPreview
): Promise<HTMLDivElement> {
  const layer = document.createElement("div");
  layer.className = "link-layer";
  const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
  annotations
    .filter((anno) => anno.subtype === "Link" && anno.rect)
    .forEach((anno) => {
      const rect = anno.rect as number[];
      const link = document.createElement("a");
      link.className = "pdf-link";
      link.title = anno.url || "Go to linked page";
      const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
      Object.assign(link.style, {
        left: `${Math.min(x1, x2)}px`,
        top: `${Math.min(y1, y2)}px`,
        width: `${Math.abs(x2 - x1)}px`,
        height: `${Math.abs(y2 - y1)}px`
      });
      if (anno.url) {
        link.href = anno.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else if (anno.dest) {
        link.href = "#";
        link.addEventListener("click", async (event) => {
          event.preventDefault();
          const dest = Array.isArray(anno.dest) ? anno.dest : await pdf.getDestination(anno.dest as string);
          if (dest?.[0]) goToPage((await pdf.getPageIndex(dest[0])) + 1);
        });
        if (preview) {
          const dest = anno.dest;
          link.addEventListener("mouseenter", () => preview.show(link, dest));
          link.addEventListener("mouseleave", () => preview.hide());
        }
      }
      layer.appendChild(link);
    });
  return layer;
}
