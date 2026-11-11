/** C8-T01 alias map: fixture aliases never mint durable ids. */
export const ALIAS_PREFIXES: Record<string, string> = {
  PLAN: 'sp_', SPV: 'spv_', N: 'spn_', SSR: 'ssr_', A: 'ab_',
  ABR: 'abr_', Q: 'aq_', AQR: 'aqr_', EA: 'ea_', ER: 'er_',
  ERS: 'ers_', EG: 'eg_', SGJ: 'sgj_', LE: 'le_', LG: 'lg_',
};
export function assertAliasScope(alias: string, id: string): boolean {
  for (const [a, p] of Object.entries(ALIAS_PREFIXES)) {
    if (alias.startsWith(a) && !id.startsWith(p)) return false;
  }
  return true;
}
/** Normalize volatile fields (ids, timestamps, slotKeys) for double-run comparison. */
export function normalizeSnapshot(value: unknown, aliasMap: Record<string, string>): unknown {
  const raw = JSON.stringify(value);
  let out = raw;
  for (const [alias, id] of Object.entries(aliasMap)) {
    out = out.split(id).join(`<${alias}>`);
  }
  return JSON.parse(out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIMESTAMP>'));
}
