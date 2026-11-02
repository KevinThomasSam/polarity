import { cookies } from "next/headers";
import { db } from "@/lib/db";
export async function currentUser() { const token = (await cookies()).get("polarity_session")?.value; if (!token) return null; const result = await (await db()).query<{ id:string; username:string; display_name:string }>("SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1", [token]); return result.rows[0] ?? null; }
