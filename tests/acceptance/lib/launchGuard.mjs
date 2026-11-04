// Launcher preconditions that must stop run.mjs BEFORE it copies the save or plays a turn (2026-11-04: a 5-run --finds gate ran 75 min with
// RISU_SHARED_DIR unset and only then failed finds.saved with "no-store"). Pure: run.mjs passes its flags and env.
/** the message to print and exit 1 on, or '' when the launch may go on */
export function launchProblem({ finds, gate, env }) {
    if (finds && gate && !String(env?.RISU_SHARED_DIR ?? '').trim()) {
        return 'run.mjs: --finds needs RISU_SHARED_DIR (the store dir of a TEST asset manager, the same one the copy posts to via RISU_ASSETS_URL): finds.saved reads it at the end. Stopping before anything is copied or played.'
    }
    return ''
}
