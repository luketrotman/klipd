import { redirect } from "next/navigation";
import { getViewer } from "./session";

export async function requireAdmin() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/admin");
  if (!viewer.user.isAdmin) redirect("/home");
  return viewer;
}

/** For server actions and API handlers: throw instead of redirecting. Every admin action must call this first. */
export async function assertAdmin() {
  const viewer = await getViewer();
  if (!viewer?.user.isAdmin) throw new Error("Admin only");
  return viewer;
}
