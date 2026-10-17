import type { ResolvedPaper, ResolvedThemeAppearance } from "./resolveThemeAppearance";

/** Source-over background paint only; never wraps anchored text or adds a compositor. */
export function paperMaterialCss(paper: ResolvedPaper | null): string {
  if (!paper) return "";
  const grain = `url(${JSON.stringify(paper.grainUrl)})`;
  const variation = `url(${JSON.stringify(paper.variationUrl)})`;
  const rule = paper.ruling
    ? "repeating-linear-gradient(to bottom,transparent 0px,transparent calc(var(--paper-rule-spacing,32px) - 1px),rgb(129 153 160 / 0.18) calc(var(--paper-rule-spacing,32px) - 1px),rgb(129 153 160 / 0.18) var(--paper-rule-spacing,32px))"
    : "none";
  const margin = paper.margin
    ? "linear-gradient(to right,transparent var(--paper-margin-offset,8px),rgb(187 121 114 / 0.35) var(--paper-margin-offset,8px),rgb(187 121 114 / 0.35) calc(var(--paper-margin-offset,8px) + 1px),transparent calc(var(--paper-margin-offset,8px) + 1px))"
    : "none";
  return `--paper-grain:${grain};--paper-variation:${variation};--paper-rule:${rule};--paper-margin:${margin};`;
}

/** App-owned CSS is appended to the existing nonce-authorized reader stylesheet. */
export function paperReaderCss(appearance: ResolvedThemeAppearance | null): string {
  if (!appearance) return "";
  if (appearance.accessibility.eink || appearance.accessibility.forcedColors)
    return `
    html,body{background:#fff!important;color:#000!important;background-image:none!important;color-scheme:light!important}
    @media(forced-colors:active){html,body{background:Canvas!important;color:CanvasText!important}}
  `;
  if (!appearance.paper) return "";
  return `
    :root{${paperMaterialCss(appearance.paper)}color-scheme:light!important;}
    html{background-color:${appearance.readerTokens.background}!important;background-image:var(--paper-margin),var(--paper-rule),var(--paper-variation),var(--paper-grain)!important;background-size:100% 100%,100% var(--paper-rule-spacing,32px),1536px 1536px,512px 512px!important;background-position:0 0,0 24px,0 0,0 0!important;background-repeat:no-repeat,repeat,repeat,repeat!important;background-attachment:scroll!important;}
    body{background:transparent!important;}
    @media(min-width:600px){html{--paper-rule-spacing:36px;--paper-margin-offset:24px;}}
    @media(max-width:359px){html{--paper-margin:none;}}
    html:dir(rtl){--paper-margin:none;}
    @media(forced-colors:active),(prefers-contrast:more){html,body{background-image:none!important;}}
  `;
}
