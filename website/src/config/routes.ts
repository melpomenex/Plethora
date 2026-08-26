export interface SiteRoute {
  path: string;
  title: string;
  description: string;
  owner: 'A' | 'B' | 'D' | 'E';
  navLabel: string;
  inPrimaryNav: boolean;
}

export const SITE_ROUTES: SiteRoute[] = [
  {
    path: '/',
    title: 'Plethora',
    description: 'Everything you read. Remembered.',
    owner: 'B',
    navLabel: 'Home',
    inPrimaryNav: true,
  },
  {
    path: '/features',
    title: 'Features — Plethora',
    description: 'What Plethora does for reading, understanding, and recall.',
    owner: 'E',
    navLabel: 'Features',
    inPrimaryNav: true,
  },
  {
    path: '/how-it-works',
    title: 'How it works — Plethora',
    description: 'Capture, read, understand, connect, remember.',
    owner: 'E',
    navLabel: 'How it works',
    inPrimaryNav: true,
  },
  {
    path: '/pricing',
    title: 'Pricing — Plethora',
    description: 'Free and Plethora Pro. Storefronts set local prices.',
    owner: 'E',
    navLabel: 'Pricing',
    inPrimaryNav: true,
  },
  {
    path: '/downloads',
    title: 'Downloads — Plethora',
    description: 'Desktop and mobile downloads for Plethora.',
    owner: 'E',
    navLabel: 'Downloads',
    inPrimaryNav: false,
  },
  {
    path: '/demo',
    title: 'Demo — Plethora',
    description: 'A short walkthrough of capture through recall.',
    owner: 'D',
    navLabel: 'Demo',
    inPrimaryNav: true,
  },
  {
    path: '/docs',
    title: 'Docs — Plethora',
    description: 'Help and product documentation.',
    owner: 'E',
    navLabel: 'Docs',
    inPrimaryNav: true,
  },
  {
    path: '/changelog',
    title: 'Changelog — Plethora',
    description: 'Product changes over time.',
    owner: 'E',
    navLabel: 'Changelog',
    inPrimaryNav: false,
  },
  {
    path: '/support',
    title: 'Support — Plethora',
    description: 'Get help with Plethora.',
    owner: 'E',
    navLabel: 'Support',
    inPrimaryNav: false,
  },
  {
    path: '/contact',
    title: 'Contact — Plethora',
    description: 'Contact Plethora.',
    owner: 'E',
    navLabel: 'Contact',
    inPrimaryNav: false,
  },
  {
    path: '/privacy',
    title: 'Privacy — Plethora',
    description: 'How Plethora treats your knowledge and data.',
    owner: 'E',
    navLabel: 'Privacy',
    inPrimaryNav: false,
  },
  {
    path: '/security',
    title: 'Security — Plethora',
    description: 'Verified security statements for Plethora.',
    owner: 'E',
    navLabel: 'Security',
    inPrimaryNav: false,
  },
  {
    path: '/terms',
    title: 'Terms — Plethora',
    description: 'Terms of use for Plethora.',
    owner: 'E',
    navLabel: 'Terms',
    inPrimaryNav: false,
  },
  {
    path: '/refunds',
    title: 'Refunds — Plethora',
    description: 'Refund policy for Plethora.',
    owner: 'E',
    navLabel: 'Refunds',
    inPrimaryNav: false,
  },
  {
    path: '/students',
    title: 'Plethora for students',
    description: 'Retain what you study.',
    owner: 'E',
    navLabel: 'Students',
    inPrimaryNav: false,
  },
  {
    path: '/readers',
    title: 'Plethora for readers',
    description: 'Remember what you read.',
    owner: 'E',
    navLabel: 'Readers',
    inPrimaryNav: false,
  },
  {
    path: '/researchers',
    title: 'Plethora for researchers',
    description: 'Keep sources connected and recallable.',
    owner: 'E',
    navLabel: 'Researchers',
    inPrimaryNav: false,
  },
  {
    path: '/spaced-repetition',
    title: 'Spaced repetition — Plethora',
    description: 'Review that compounds.',
    owner: 'E',
    navLabel: 'Spaced repetition',
    inPrimaryNav: false,
  },
  {
    path: '/incremental-reading',
    title: 'Incremental reading — Plethora',
    description: 'Work through a library without losing the thread.',
    owner: 'E',
    navLabel: 'Incremental reading',
    inPrimaryNav: false,
  },
  {
    path: '/read-it-later',
    title: 'Beyond read-it-later — Plethora',
    description: 'Saving is not remembering.',
    owner: 'E',
    navLabel: 'Read-it-later',
    inPrimaryNav: false,
  },
  {
    path: '/anki',
    title: 'Anki and Plethora',
    description: 'Anki package import and export.',
    owner: 'E',
    navLabel: 'Anki',
    inPrimaryNav: false,
  },
];

export function routeByPath(path: string): SiteRoute | undefined {
  return SITE_ROUTES.find((route) => route.path === path);
}
