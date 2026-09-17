export function resolveItemDropoffLocation(
  dropoffLocation: string | null,
  organizationCity: string | null,
): string {
  return [dropoffLocation, organizationCity].find((value) => value?.trim()) ?? "";
}