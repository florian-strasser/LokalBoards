// Starts a download from an address on this instance, without leaving the page.
//
// The response says `Content-Disposition: attachment`, so following a link to it
// saves the file rather than navigating. A click on a real link does that in
// every browser; a `window.open` is treated as a popup and, in Safari, asked
// about first.
export function startDownload(url: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
}
