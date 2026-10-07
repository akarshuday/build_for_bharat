export const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'product', label: 'How it works' },
  { id: 'case-studies', label: 'Features' },
  { id: 'contact', label: 'Start' },
] as const;

export const STATS = [
  { target: 2, suffix: '', label: 'Portals: Manager & Contributor' },
  { target: 100, suffix: '%', label: 'Tasks come with a how-to guide' },
  { target: 1, suffix: '-click', label: 'Re-plan when someone leaves' },
  { target: 3, suffix: '-step', label: 'From idea to finished project' },
];

export const STEPS = [
  { icon: 'fa-folder-plus', title: '1. Create a project', text: 'Managers set a title, a theme and what they are building, then add teammates by their unique ID.' },
  { icon: 'fa-wand-magic-sparkles', title: '2. AI splits the work', text: 'A draft task list is balanced by skills. Only the manager sees it until they review and publish.' },
  { icon: 'fa-circle-check', title: '3. Team ticks it off', text: 'Each person sees only their tasks, ticks them done, and the manager approves. Progress updates live.' },
];

export const FEATURES = [
  { icon: 'fa-book-open', title: 'Guides and alternatives', text: 'Every task explains how to do it and offers a second way if the first is blocked.' },
  { icon: 'fa-comments', title: 'Real-time team chat', text: 'Talk inside the project, only with the people on that team.' },
  { icon: 'fa-arrows-rotate', title: 'Automatic re-planning', text: 'If a member leaves, their unfinished tasks are reassigned in one click.' },
  { icon: 'fa-shield-halved', title: 'Secure by default', text: 'Hashed passwords, rate limiting and role-based access for managers and contributors.' },
];
