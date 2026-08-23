export type DemoShell = 'ios' | 'android';

export function defaultShellFromUserAgent(ua: string): DemoShell {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod|ios/i.test(ua)) return 'ios';
  return 'ios';
}

export function toggleShell(shell: DemoShell): DemoShell {
  return shell === 'ios' ? 'android' : 'ios';
}
