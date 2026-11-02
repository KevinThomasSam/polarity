import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
export async function GET() { const user = await currentUser(); const result = await (await db()).query(`SELECT p.id,p.body,p.community,p.created_at,u.username,u.display_name, (SELECT count(*)::int FROM likes l WHERE l.post_id=p.id) likes, (SELECT count(*)::int FROM comments c WHERE c.post_id=p.id) replies, ${user ? "EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1)" : "false"} liked FROM posts p JOIN users u ON u.id=p.author_id ORDER BY p.created_at DESC LIMIT 30`, user ? [user.id] : []); return NextResponse.json({ posts: result.rows, user }); }
