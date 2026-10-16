// Which app this is. The four apps (user, agent, admin, superadmin) are separate copies, each built and hosted
// on its own; shared helpers still ask has('customer') / has('agent') … to show only what belongs to this app.
//   customer → customers · agent → delivery agents & partners · admin → franchise admins · super → HQ
export const APP = 'super';
export const has = (app) => APP === app;

// Where each kind of account belongs, and the login "portal" of this app.
export const HOME_OF = { superadmin: '/super', admin: '/admin', agent: '/agent', customer: '/' };
export const PORTALS_OF = ["superadmin"];
// The landing page of this app.
export const START = '/super';
