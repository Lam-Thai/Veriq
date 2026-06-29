type BrowserChromeProps = {
  url: string;
};

/** The faux browser address bar used atop every product-screenshot mockup. */
export function BrowserChrome({ url }: BrowserChromeProps) {
  return (
    <div className="flex items-center gap-2 rounded-t-lg border-b border-hairline px-4 py-3">
      <span className="flex gap-1.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
      </span>
      <span className="ml-2 truncate text-(length:--type-fine-print-size) text-ink-muted-48">{url}</span>
    </div>
  );
}
