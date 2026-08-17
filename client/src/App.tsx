import type { ReactElement } from "react";
import { Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { useSession } from "./hooks/useSession";
import { SURFACE_ROUTES, STAFF_ADMIN_ONLY_SURFACES, type SurfaceRoute } from "@shared/routes";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { NotFound } from "./pages/NotFound";
import { ItemsBrowsePage } from "./pages/public/ItemsBrowsePage";
import { ItemDetailPage } from "./pages/public/ItemDetailPage";
import { VolunteerBrowsePage } from "./pages/public/VolunteerBrowsePage";
import { VolunteerDetailPage } from "./pages/public/VolunteerDetailPage";
import { DigestPage } from "./pages/public/DigestPage";
import { HomePage } from "./pages/public/HomePage";
import { LoginPage } from "./pages/member/LoginPage";
import { SignupPage } from "./pages/member/SignupPage";
import { DashboardPage } from "./pages/member/DashboardPage";
import { OrganizationSettingsPage } from "./pages/member/OrganizationSettingsPage";
import { MembersNewPage } from "./pages/member/MembersNewPage";
import { ItemsNewPage } from "./pages/member/ItemsNewPage";
import { ItemsAddPage } from "./pages/member/ItemsAddPage";
import { ItemsEditPage } from "./pages/member/ItemsEditPage";
import { VolunteersNewPage } from "./pages/member/VolunteersNewPage";
import { VolunteersAddPage } from "./pages/member/VolunteersAddPage";
import { VolunteersEditPage } from "./pages/member/VolunteersEditPage";
import { SupportersPage } from "./pages/member/SupportersPage";
import { NavBar } from "./components/NavBar";
import { DashboardGate } from "./components/member/DashboardGate";
import { AdminShell } from "./components/admin/AdminShell";
import { OrganizationsPage as AdminOrganizationsPage } from "./pages/admin/OrganizationsPage";
import { RequestsPage as AdminRequestsPage } from "./pages/admin/RequestsPage";
import { MembersPage as AdminMembersPage } from "./pages/admin/MembersPage";
import { PeopleReviewPage as AdminPeopleReviewPage } from "./pages/admin/PeopleReviewPage";
import { PopulationsPage as AdminPopulationsPage } from "./pages/admin/PopulationsPage";
import { EmailLogPage as AdminEmailLogPage } from "./pages/admin/EmailLogPage";
import { ActivityPage as AdminActivityPage } from "./pages/admin/ActivityPage";
import { SubscribersPage as AdminSubscribersPage } from "./pages/admin/SubscribersPage";

/** Built surfaces, by surface ID. Everything else renders its placeholder. */
const SURFACE_PAGES: Partial<Record<string, () => ReactElement>> = {
  "MP-01": () => <LoginPage />,
  "MP-03": () => <SignupPage />,
  "MP-04": () => <DashboardPage />,
  "MP-05": () => <OrganizationSettingsPage />,
  "MP-06": () => <MembersNewPage />,
  "MP-07": () => <ItemsNewPage />,
  "MP-08": () => <ItemsAddPage />,
  "MP-09": () => <ItemsEditPage />,
  "MP-10": () => <VolunteersNewPage />,
  "MP-11": () => <VolunteersAddPage />,
  "MP-12": () => <VolunteersEditPage />,
  "MP-13": () => <SupportersPage />,
  "PB-00": () => <HomePage />,
  "PB-01": () => <ItemsBrowsePage />,
  "PB-02": () => <ItemDetailPage />,
  "PB-03": () => <VolunteerBrowsePage />,
  "PB-04": () => <VolunteerDetailPage />,
  "PB-05": () => <DigestPage />,
};

/** Built admin surfaces, by surface ID; the rest render placeholders inside the shell. */
const ADMIN_PAGES: Partial<Record<string, () => ReactElement>> = {
  "ADMIN-01": () => <AdminOrganizationsPage />,
  "ADMIN-02": () => <AdminRequestsPage />,
  "ADMIN-03": () => <AdminMembersPage />,
  "ADMIN-04": () => <AdminPeopleReviewPage />,
  "ADMIN-05": () => <AdminPopulationsPage />,
  "ADMIN-06": () => <AdminEmailLogPage />,
  "ADMIN-07": () => <AdminActivityPage />,
  "ADMIN-08": () => <AdminSubscribersPage />,
};

/**
 * Admin gate: non-staff sessions see exactly the not-found page, so admin
 * routes are indistinguishable from routes that do not exist. Staff-admin-only
 * surfaces (ADMIN-04/05/08) apply the same rule to mere approvers. The server
 * enforces the real boundary (requireStaff / requireStaffAdmin on /api/admin);
 * this mirrors it with the identical NotFound the router catch-all renders.
 */
function AdminGate({ route }: { route: SurfaceRoute }): ReactElement | null {
  const { session, isLoading } = useSession();
  if (isLoading) return null;
  if (!session?.isStaff) return <NotFound />;
  if (STAFF_ADMIN_ONLY_SURFACES.has(route.id) && session.staffRole !== "staff_admin") return <NotFound />;
  return <AdminShell>{ADMIN_PAGES[route.id]?.() ?? <PlaceholderPage route={route} />}</AdminShell>;
}

function AppRoutes(): ReactElement {
  return (
    <Switch>
      {SURFACE_ROUTES.map((route) => (
        <Route key={`${route.id}-${route.path}`} path={route.path}>
          {route.area === "admin" ? (
            <AdminGate route={route} />
          ) : route.area === "member" && route.path.startsWith("/dashboard") ? (
            // MP-02: every dashboard route sits behind the membership gate.
            <DashboardGate>
              {SURFACE_PAGES[route.id]?.() ?? <PlaceholderPage route={route} />}
            </DashboardGate>
          ) : (
            SURFACE_PAGES[route.id]?.() ?? <PlaceholderPage route={route} />
          )}
        </Route>
      ))}
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

export default function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      {/* MP-02: the navigation bar is present on every page, both states. */}
      <NavBar />
      <AppRoutes />
    </QueryClientProvider>
  );
}
