import { redirect } from "next/navigation";
import { getViewer } from "./session";

export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/admin");
  if (!viewer.user.isAdmin) redirect("/home");
  return viewer;
}
