import { buildFaviconSvg } from "../utils/favicon";

// Favicon, served dynamically so it picks up the instance's configured primary
// colour at runtime (NUXT_PUBLIC_COLOR_PRIMARY) instead of a build-time default.
// A single colour is used for both light and dark tabs — Safari doesn't switch
// favicons by prefers-color-scheme, so a dark-specific variant only broke the
// other theme. The logo in the app is drawn with the same `text-primary` colour.
export default defineEventHandler((event) => {
  const { colorPrimary } = useRuntimeConfig(event).public;

  setHeader(event, "content-type", "image/svg+xml; charset=utf-8");
  // Favicons are cached hard by browsers anyway; a modest TTL lets a colour
  // change (env + restart) propagate on the next visit without a hard refresh.
  setHeader(event, "cache-control", "public, max-age=3600");
  // The default for a setting that is not a colour (see `cssColour`).
  return buildFaviconSvg(cssColour(colorPrimary) ?? "#0066CC");
});
