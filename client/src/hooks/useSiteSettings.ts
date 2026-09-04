/**
 * Shared hook for public site settings — the three editable copy fields plus
 * director contact info. All client pages that reference these values call
 * this hook rather than hardcoding the strings.
 */
import { useQuery } from "@tanstack/react-query";

export type SiteSettings = {
  siteName: string;
  contactEmail: string;
  responseTimeLanguage: string;
  imageGenerationEnabled: boolean;
  directorName: string;
  directorEmail: string;
};

const SITE_SETTINGS_DEFAULTS: SiteSettings = {
  siteName: "Love in Action Database",
  contactEmail: "info@defendingthecause.org",
  responseTimeLanguage: "1-3 business days",
  imageGenerationEnabled: false,
  directorName: "Christina Moe",
  directorEmail: "christina@defendingthecause.org",
};

export function useSiteSettings(): { settings: SiteSettings; isLoading: boolean } {
  const { data, isLoading } = useQuery<SiteSettings>({
    queryKey: ["/api/site-settings"],
    // These values rarely change; a long stale time avoids unnecessary refetches.
    staleTime: 5 * 60 * 1000,
  });
  return { settings: data ?? SITE_SETTINGS_DEFAULTS, isLoading };
}
