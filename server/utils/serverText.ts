import en from "../../i18n/locales/en.json";
import de from "../../i18n/locales/de.json";
import fr from "../../i18n/locales/fr.json";
import es from "../../i18n/locales/es.json";
import it from "../../i18n/locales/it.json";
import nl from "../../i18n/locales/nl.json";
import pl from "../../i18n/locales/pl.json";
import uk from "../../i18n/locales/uk.json";
import pt from "../../i18n/locales/pt.json";
import cs from "../../i18n/locales/cs.json";

// The interface's own words, for text the server writes itself — a file to
// download, say — in the instance's language. The same files the browser
// translates from, so a column in a spreadsheet is called what the menu calls
// it. English fills in anything a language is missing.

const LOCALES: Record<string, Record<string, string>> = {
  en, de, fr, es, it, nl, pl, uk, pt, cs,
};

export function serverText(language: string) {
  const strings = LOCALES[String(language || "en").slice(0, 2)] ?? LOCALES.en;
  return (key: string, params: Record<string, unknown> = {}): string => {
    const template = strings[key] ?? LOCALES.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (whole, name) =>
      params[name] !== undefined ? String(params[name]) : whole,
    );
  };
}
