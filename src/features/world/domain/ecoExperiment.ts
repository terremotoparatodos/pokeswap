// ECO-GAMEPLAY-1 (experimental): whether this build takes part in the ECO population experiment.
//
// Build constants: development opt-in, or the separately validated limited production release.
// Normal production still folds ECO to false, even with the old experiment flag enabled.
// The server decides the population either way; this only says whether to ask for it.

export const ECO_LIMITED: boolean = import.meta.env.PROD && import.meta.env.VITE_ECO_RELEASE === 'limited'
export const ECO_EXPERIMENT: boolean = (import.meta.env.DEV || ECO_LIMITED) && import.meta.env.VITE_ECO_EXPERIMENT === 'on'
