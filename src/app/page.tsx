import { redirect } from "next/navigation";

/**
 * The landing experience lives at /welcome (Obsidian-glass hero + interest
 * tagging). The root falls through to it for both signed-in and new visitors;
 * /welcome bounces authenticated users on to /home.
 */
export default function RootPage() {
  redirect("/welcome");
}
