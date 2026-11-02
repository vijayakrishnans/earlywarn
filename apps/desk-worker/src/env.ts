export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  /** Base64 of 32 random bytes. Seals report contents at rest. */
  DESK_ENCRYPTION_KEY?: string;
  ENVIRONMENT: string;
}
