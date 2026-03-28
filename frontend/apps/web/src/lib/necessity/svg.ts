export function toSvgDataUri(svgMarkup: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}
