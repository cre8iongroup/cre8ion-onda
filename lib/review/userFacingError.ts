export function userFacingError(err: unknown, fallback: string): string {
  console.error(err)
  return fallback
}
