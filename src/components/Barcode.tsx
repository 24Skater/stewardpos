import { bars, sanitize, type BarcodeOptions } from '@/lib/code39';

interface BarcodeProps extends BarcodeOptions {
  /** The payload. Non-encodable characters are dropped; see `sanitize`. */
  value: string;
  className?: string;
}

/**
 * A scannable Code 39 barcode.
 *
 * Replaces a `<div className="barcode-placeholder bg-black">` — a solid black
 * rectangle that had been printing on every receipt above the text
 * `*38A509AC*`. It looked like a barcode, cost the same thermal paper, and could
 * not be scanned, so the returns desk read the order id off the receipt and
 * typed it in.
 *
 * Rendered as SVG rather than an image so it prints at the printer's own
 * resolution: the receipt's print view reuses this DOM, and a rasterised
 * barcode scaled to thermal-printer dots is exactly the kind that reads
 * intermittently.
 */
export default function Barcode({ value, className, narrow, ratio, height = 40 }: BarcodeProps) {
  const text = sanitize(value);
  const { bars: drawn, width } = bars(value, { narrow, ratio, height });

  // Nothing encodable means no symbol. Printing the delimiters alone would be a
  // barcode that scans as an empty string, which is worse than a blank space.
  if (!text) return null;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      // Antialiased bar edges are what makes a scanner hesitate.
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${text}`}
    >
      {drawn.map((bar) => (
        <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}
