// Auth state initializes via useAuth module-level side effect (getSession + onAuthStateChange).
// Importing it here ensures the singleton is set up before the app mounts.
import '../../features/auth/composables/useAuth'

export function bootstrap(): void {}
