/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** Set by middleware on /admin routes. */
    admin?: import('./lib/auth').AdminUser;
  }
}
