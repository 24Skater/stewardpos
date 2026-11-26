/**
 * Print a receipt on an 80mm thermal printer (tuned on an Adesso NuPrint 210).
 *
 * The receipt's markup is copied into a bare window carrying only the styles
 * below, so the printout is the receipt alone. Printing the app page itself
 * (`window.print()`) sent the whole admin screen and fed ~2ft of paper.
 *
 * The copied markup keeps its Tailwind classes, but Tailwind is not loaded in
 * the print window, so the few layout utilities receipt markup relies on are
 * restated here at thermal sizes.
 */
export const RECEIPT_PRINT_CSS = `
  @page {
    size: 80mm auto;
    /* The printer already keeps its own unprintable edge; adding more here wasted ~8mm a side. */
    margin: 0;
  }
  body {
    font-family: 'Courier New', monospace;
    /* Thermal heads cannot print grey (it dithers to faint dots) and thin strokes fade, so print solid black bold. */
    color: #000;
    font-weight: bold;
    font-size: 13px;
    margin: 0;
    /* NuPrint 210 fades past its right edge: keep ~5/16in (8mm) clear on the right only. */
    padding: 1mm 8mm 1mm 0;
  }
  p { margin: 0; }
  img { max-height: 60px; max-width: 200px; }
  .header { text-align: center; margin-bottom: 15px; }
  .logo { margin-bottom: 10px; }
  .store-name { font-size: 16px; }
  .store-info { font-size: 12px; }
  .header-text { font-style: italic; margin-top: 10px; font-size: 13px; }
  .separator { border-top: 1px dashed #000; margin: 10px 0; }
  .item { display: flex; justify-content: space-between; margin: 5px 0; }
  .item-details { font-size: 12px; margin-left: 10px; }
  .totals { margin-top: 10px; }
  .total-line { display: flex; justify-content: space-between; }
  .grand-total { font-size: 15px; margin-top: 5px; }
  .footer { text-align: center; margin-top: 15px; font-size: 13px; }
  .barcode { text-align: center; margin: 15px 0; }
  /* The barcode is an inline SVG in the copied markup; never paint a box over it. */
  .barcode svg { height: 40px; width: auto; }
  .barcode-text { font-size: 12px; margin-top: 5px; }
  .footer-message { white-space: pre-line; }

  /* Tailwind utilities used by receipt markup (not loaded in this window). */
  .flex { display: flex; }
  .justify-between { justify-content: space-between; }
  .text-center { text-align: center; }
  .mx-auto { margin-left: auto; margin-right: auto; display: block; }
  .italic { font-style: italic; }
  .whitespace-pre-line { white-space: pre-line; }
  .text-xs { font-size: 12px; }
  .text-lg { font-size: 16px; }
  .border-t { border-top: 1px dashed #000; }
  .pt-2, .pt-4 { padding-top: 6px; }
  .mt-1, .mt-2 { margin-top: 4px; }
  .mt-4 { margin-top: 8px; }
  .mb-4 { margin-bottom: 8px; }
  .mb-2 { margin-bottom: 4px; }
`;

/**
 * Open a print window for `receipt` and print it.
 * Returns false when the browser blocked the pop-up, so the caller can say so.
 */
export function printReceipt(receipt: HTMLElement, title: string): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.document.write(
    `<!DOCTYPE html><html><head><title></title><style>${RECEIPT_PRINT_CSS}</style></head>` +
      `<body>${receipt.innerHTML}</body></html>`
  );
  // Set as text, not interpolated into the HTML above.
  printWindow.document.title = title;
  printWindow.document.close();
  printWindow.focus();

  // Give the copied images (logo) a moment to load before the dialog opens.
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
  return true;
}
