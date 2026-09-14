// Whether the server has finished starting.
//
// Nitro calls its plugins without waiting for the async ones, so the server
// listens — and answers requests, /api/health among them — while the migrations
// are still being applied and before the first administrator exists. The NixOS
// test measured it: listening at 16.5 s, migration 0006 still running when the
// first request arrived.
//
// The startup plugins report here as they finish, and /api/health answers 503
// until they all have. Whatever waits for it — Docker's healthcheck, Compose,
// the NixOS test — then waits for a server that can actually serve.

export type StartupStep = "migrations" | "admin";
export type StartupState = "starting" | "ready" | "failed";

export function createStartupTracker(steps: StartupStep[] = ["migrations", "admin"]) {
  const pending = new Set<StartupStep>(steps);
  let failed = false;
  return {
    done(step: StartupStep) {
      pending.delete(step);
    },
    fail() {
      failed = true;
    },
    state(): StartupState {
      if (failed) return "failed";
      return pending.size === 0 ? "ready" : "starting";
    },
  };
}

const tracker = createStartupTracker();

export const startupStepDone = (step: StartupStep) => tracker.done(step);
export const startupFailed = () => tracker.fail();
export const startupState = () => tracker.state();
