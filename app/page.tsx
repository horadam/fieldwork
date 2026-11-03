import { connection } from "next/server";
import Workspace from "@/components/workspace";
// Rendered per request so each page gets its own CSP nonce (see proxy.ts).
export default async function Page() {
  await connection();
  return <Workspace />;
}
