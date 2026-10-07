// ECO-GAMEPLAY-1 (experimental): whether this build takes part in the ECO population experiment.
//
// A build-time constant: true only in a development build (`import.meta.env.DEV`) with
// VITE_ECO_EXPERIMENT=on. A production build replaces it with `false`, so every branch it guards —
// the `ecoProtocol` declaration, the ECO receivers and the dev retirement panel — is dead code there.
// The server decides the population either way; this only says whether to ask for it.

export const ECO_EXPERIMENT: boolean = import.meta.env.DEV && import.meta.env.VITE_ECO_EXPERIMENT === 'on'
